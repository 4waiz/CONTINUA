"""
Surface-building helpers for the Mk2 CONTINUA assets.

`continua_lib.py` builds from boxes and cylinders, which is why the Mk1 rover
read as a stack of primitives. These helpers build the other way round - from
cross-sections - so a body panel is one continuous surface with real fillets
instead of a box with a bevel:

    profile()   a 2-D outline from key points, each corner filleted with its
                own radius, every span subdivided a fixed number of times. The
                vertex count never depends on the shape, so consecutive
                sections of a loft always line up.
    loft()      skins a list of equal-length rings into a quad grid, with
                optional n-gon caps.
    sweep()     carries a closed profile along a path (flares, tubes, rails).
    bake_ao()   Cycles ambient occlusion baked into a linear colour attribute,
                which the glTF exporter writes as COLOR_0. glTF multiplies
                COLOR_0 into base colour, so the browser gets baked contact
                shading for free - no texture files, no post-processing pass.

Same conventions as continua_lib: metres, Z-up, vehicle forward +X.
"""

from __future__ import annotations

import math
from typing import Callable, Iterable, Sequence

import bmesh
import bpy
from mathutils import Matrix, Vector

Point2 = tuple[float, float]


# --------------------------------------------------------------------------
# 2-D profiles
# --------------------------------------------------------------------------


def _fillet(prev: Point2, corner: Point2, nxt: Point2, radius: float,
            segments: int) -> list[Point2]:
    """Replace `corner` by `segments + 1` points on a tangent arc.

    The radius is clamped so the arc never eats more than 45 % of either
    adjacent span; a straight corner degenerates to evenly spaced points on the
    line, so the point count is always the same.
    """
    p = Vector(corner)
    a = Vector(prev) - p
    b = Vector(nxt) - p
    la, lb = a.length, b.length
    if radius <= 0.0 or segments <= 0 or la < 1e-9 or lb < 1e-9:
        return [corner] * (segments + 1)
    u, v = a / la, b / lb
    cos_theta = max(-1.0, min(1.0, u.dot(v)))
    theta = math.acos(cos_theta)
    if theta > math.pi - 1e-4:        # collinear: no corner to round
        d = min(radius, 0.45 * la, 0.45 * lb) * 0.25
        return [tuple(p + u * d * (1.0 - 2.0 * i / segments)) for i in range(segments + 1)]
    if theta < 1e-4:                  # folded back on itself
        return [corner] * (segments + 1)
    d = radius / math.tan(theta / 2.0)
    d = min(d, 0.45 * la, 0.45 * lb)
    r = d * math.tan(theta / 2.0)
    t1 = p + u * d
    t2 = p + v * d
    bisector = (u + v).normalized()
    center = p + bisector * (r / math.sin(theta / 2.0))
    a1 = math.atan2(t1.y - center.y, t1.x - center.x)
    a2 = math.atan2(t2.y - center.y, t2.x - center.x)
    delta = a2 - a1
    while delta > math.pi:
        delta -= 2.0 * math.pi
    while delta < -math.pi:
        delta += 2.0 * math.pi
    out = []
    for i in range(segments + 1):
        angle = a1 + delta * i / segments
        out.append((center.x + r * math.cos(angle), center.y + r * math.sin(angle)))
    return out


def profile(keys: Sequence[dict], labels: bool = False):
    """Build an open polyline from key points.

    Each key: ``{"p": (u, v), "r": fillet_radius, "seg": fillet_segments,
    "sub": subdivisions_of_the_span_to_the_next_key}`` - or ``"fracs"``, an
    explicit list of 0..1 positions for the span's interior points, which is
    how a window gets a thin frame band without densifying the whole span.
    The first and last keys are never filleted. The number of points returned
    depends only on the `seg` / `sub` / `fracs` values, never on positions.

    With ``labels=True`` also returns one label per segment between
    consecutive points: ``(kind, key_index, interval, intervals)`` where kind
    is ``"arc"`` (inside key_index's fillet) or ``"span"`` (on the span that
    starts at key_index). Callers paint materials by label, not by height.
    """
    n = len(keys)
    corners: list[list[Point2]] = []
    for i, key in enumerate(keys):
        if i == 0 or i == n - 1:
            corners.append([key["p"]])
        else:
            corners.append(_fillet(keys[i - 1]["p"], key["p"], keys[i + 1]["p"],
                                   key.get("r", 0.0), key.get("seg", 0)))
    out: list[Point2] = []
    tags: list[tuple[str, int, int]] = []        # per point: (kind, key, position)
    for i in range(n):
        if i > 0:
            start = Vector(corners[i - 1][-1])
            end = Vector(corners[i][0])
            fracs = keys[i - 1].get("fracs")
            if fracs is None:
                sub = max(1, keys[i - 1].get("sub", 1))
                fracs = [s / sub for s in range(1, sub)]
            # `bow` bends the span outward (to its left) by a parabola. With a
            # key raised by `crown` and bow = crown / 4 the span becomes
            # z = top - crown * f^2: a dome with no ridge at its centre.
            bow = keys[i - 1].get("bow", 0.0)
            chord = end - start
            normal = Vector((-chord.y, chord.x))
            if normal.length > 1e-9:
                normal.normalize()
            for f in fracs:
                q = start.lerp(end, f) + normal * (bow * 4.0 * f * (1.0 - f))
                out.append((q.x, q.y))
                tags.append(("span", i - 1, 0))
        for k, point in enumerate(corners[i]):
            out.append(point)
            tags.append(("arc", i, k))
    if not labels:
        return out
    face_labels = []
    span_counter: dict[int, int] = {}
    span_sizes: dict[int, int] = {}
    # A segment that is not inside one fillet lies on the span that starts at
    # its first point's key. First pass: how many intervals each span has.
    for a, b in zip(tags, tags[1:]):
        if not (a[0] == "arc" and b[0] == "arc" and a[1] == b[1]):
            span_sizes[a[1]] = span_sizes.get(a[1], 0) + 1
    for a, b in zip(tags, tags[1:]):
        if a[0] == "arc" and b[0] == "arc" and a[1] == b[1]:
            count = len(corners[a[1]]) - 1
            face_labels.append(("arc", a[1], a[2], count))
        else:
            key = a[1]
            index = span_counter.get(key, 0)
            span_counter[key] = index + 1
            face_labels.append(("span", key, index, span_sizes.get(key, 1)))
    return out, face_labels


def mirror_ring(half: Sequence[Point2]) -> list[Point2]:
    """Close a half-section (u >= 0, from top centre round to bottom centre)
    into a full ring by mirroring u. The two centre points are shared."""
    mirrored = [(-u, v) for (u, v) in reversed(half[1:-1])]
    return list(half) + mirrored


def rounded_rect(width: float, height: float, radius: float, segments: int = 4,
                 sub: int = 1) -> list[Point2]:
    """Closed rounded rectangle centred on the origin, counter-clockwise."""
    w, h = width / 2.0, height / 2.0
    keys = [
        {"p": (0.0, -h), "sub": sub},
        {"p": (w, -h), "r": radius, "seg": segments, "sub": sub},
        {"p": (w, h), "r": radius, "seg": segments, "sub": sub},
        {"p": (-w, h), "r": radius, "seg": segments, "sub": sub},
        {"p": (-w, -h), "r": radius, "seg": segments, "sub": sub},
        {"p": (0.0, -h)},
    ]
    pts = profile(keys)
    return pts[:-1]


def circle(radius: float, segments: int) -> list[Point2]:
    return [(radius * math.cos(2 * math.pi * i / segments),
             radius * math.sin(2 * math.pi * i / segments)) for i in range(segments)]


# --------------------------------------------------------------------------
# Lofting and sweeping
# --------------------------------------------------------------------------


def loft(bm: bmesh.types.BMesh, rings: Sequence[Sequence[Sequence[float]]], *,
         closed: bool = True, cap_start: bool = False, cap_end: bool = False,
         wrap: bool = False):
    """Skin equal-length rings of 3-D points into quads.

    Returns ``(grid, faces, caps)`` where ``faces[i][j]`` is the quad between
    ring i and i+1 starting at ring vertex j - which is what lets callers paint
    materials by (station, ring index) instead of guessing from positions.
    ``wrap`` joins the last ring back to the first (a revolved or closed
    sweep) without duplicating vertices, so there is no shading seam.
    """
    count = len(rings[0])
    for ring in rings:
        if len(ring) != count:
            raise ValueError(f"ring sizes differ: {len(ring)} != {count}")
    grid = [[bm.verts.new(tuple(p)) for p in ring] for ring in rings]
    faces: list[list[bmesh.types.BMFace | None]] = []
    span = count if closed else count - 1
    pairs = [(i, i + 1) for i in range(len(rings) - 1)]
    if wrap:
        pairs.append((len(rings) - 1, 0))
    for i, i2 in pairs:
        row: list[bmesh.types.BMFace | None] = []
        for j in range(span):
            k = (j + 1) % count
            quad = (grid[i][j], grid[i][k], grid[i2][k], grid[i2][j])
            try:
                row.append(bm.faces.new(quad))
            except ValueError:
                row.append(None)
        faces.append(row)
    caps = []
    if cap_start:
        caps.append(bm.faces.new(list(reversed(grid[0]))))
    if cap_end:
        caps.append(bm.faces.new(grid[-1]))
    return grid, faces, caps


def frames_along(points: Sequence[Sequence[float]], up_hint=(0.0, 0.0, 1.0)):
    """Rotation-minimising-ish frames along a polyline: (origin, tangent, normal, binormal)."""
    pts = [Vector(p) for p in points]
    frames = []
    up = Vector(up_hint)
    for i, p in enumerate(pts):
        if i == 0:
            t = (pts[1] - pts[0])
        elif i == len(pts) - 1:
            t = (pts[-1] - pts[-2])
        else:
            t = (pts[i + 1] - pts[i - 1])
        t.normalize()
        n = up - t * up.dot(t)
        if n.length < 1e-6:
            n = Vector((1.0, 0.0, 0.0)) - t * t.x
        n.normalize()
        b = t.cross(n)
        frames.append((p, t, n, b))
    return frames


def sweep(bm: bmesh.types.BMesh, section: Sequence[Point2], path: Sequence[Sequence[float]], *,
          up_hint=(0.0, 0.0, 1.0), cap: bool = True, scale: Callable[[float], float] | None = None,
          closed_path: bool = False):
    """Carry a closed 2-D section along a 3-D path. Section u -> frame normal,
    v -> frame binormal."""
    frames = frames_along(path, up_hint)
    rings = []
    total = len(frames) - 1 or 1
    for index, (origin, _t, n, b) in enumerate(frames):
        s = scale(index / total) if scale else 1.0
        rings.append([origin + n * (u * s) + b * (v * s) for (u, v) in section])
    return loft(bm, rings, closed=True, cap_start=cap and not closed_path,
                cap_end=cap and not closed_path, wrap=closed_path)


def tube(bm: bmesh.types.BMesh, path: Sequence[Sequence[float]], radius: float,
         segments: int = 10, up_hint=(0.0, 0.0, 1.0), cap: bool = True):
    return sweep(bm, circle(radius, segments), path, up_hint=up_hint, cap=cap)


def revolve_profile(bm: bmesh.types.BMesh, section: Sequence[Point2], segments: int,
                    center=(0.0, 0.0, 0.0), axis: str = "Y", closed_section: bool = True):
    """Revolve (radius, axial) points about an axis by building rings - unlike
    `bmesh.ops.spin` this gives the caller the face grid."""
    rings = []
    cx, cy, cz = center
    for s in range(segments):
        angle = 2.0 * math.pi * s / segments
        ca, sa = math.cos(angle), math.sin(angle)
        ring = []
        for (r, a) in section:
            if axis == "Y":
                ring.append((cx + r * ca, cy + a, cz + r * sa))
            elif axis == "Z":
                ring.append((cx + r * ca, cy + r * sa, cz + a))
            else:
                ring.append((cx + a, cy + r * ca, cz + r * sa))
        rings.append(ring)
    # One ring per angle, each holding the whole section; `wrap` closes the
    # revolution without a duplicated seam.
    grid, faces, _ = loft(bm, rings, closed=closed_section, wrap=True)
    return grid, faces


# --------------------------------------------------------------------------
# Objects, materials, shading
# --------------------------------------------------------------------------


def to_object(name: str, bm: bmesh.types.BMesh, materials: Sequence[bpy.types.Material],
              collection: bpy.types.Collection | None = None, recalc: bool = True) -> bpy.types.Object:
    """Create an object from a bmesh whose faces already carry material indices."""
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for material in materials:
        mesh.materials.append(material)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def set_material(faces: Iterable, index: int) -> None:
    for face in faces:
        if face is not None:
            face.material_index = index


def smooth(obj: bpy.types.Object, angle_deg: float = 40.0) -> None:
    """Smooth shading with angle-based sharp edges (Blender 4.1+ data API)."""
    mesh = obj.data
    if not mesh.polygons:
        return
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    threshold = math.radians(angle_deg)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for edge in bm.edges:
        sharp = len(edge.link_faces) != 2 or edge.calc_face_angle(0.0) >= threshold
        if not sharp and len(edge.link_faces) == 2:
            a, b = edge.link_faces
            sharp = a.material_index != b.material_index
        edge.smooth = not sharp
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def bevel(obj: bpy.types.Object, width: float, segments: int = 3, angle_deg: float = 35.0,
          weighted: bool = True) -> None:
    """Rounded edges plus weighted normals, applied as real geometry."""
    modifier = obj.modifiers.new("Bevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    modifier.angle_limit = math.radians(angle_deg)
    modifier.miter_outer = "MITER_ARC"
    modifier.use_clamp_overlap = True
    modifier.harden_normals = False
    if weighted:
        wn = obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
        wn.keep_sharp = True
        wn.weight = 50
    apply_all(obj)


def apply_all(obj: bpy.types.Object) -> None:
    if not obj.modifiers:
        return
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        except RuntimeError as exc:
            print(f"  ! could not apply {modifier.name} on {obj.name}: {exc}")


def join(objects: Sequence[bpy.types.Object], name: str) -> bpy.types.Object:
    objects = [o for o in objects if o is not None]
    target = objects[0]
    if len(objects) > 1:
        bpy.ops.object.select_all(action="DESELECT")
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = target
        bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


def tri_count(obj: bpy.types.Object) -> int:
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


# --------------------------------------------------------------------------
# Baked ambient occlusion
# --------------------------------------------------------------------------

AO_ATTRIBUTE = "AO"


def _ensure_cycles(samples: int) -> None:
    scene = bpy.context.scene
    try:
        scene.render.engine = "CYCLES"
    except TypeError as exc:  # pragma: no cover - reported, not swallowed
        raise RuntimeError(f"Cycles is required for the AO bake: {exc}") from exc
    scene.cycles.samples = samples
    scene.cycles.device = "CPU"
    if scene.world is None:
        scene.world = bpy.data.worlds.new("CONTINUA_BakeWorld")


def bake_ao(objects: Sequence[bpy.types.Object], *, distance: float, samples: int = 96,
            floor: float = 0.32, gamma: float = 0.9, occluders_only_self: bool = False,
            also_visible: Sequence[bpy.types.Object] = ()) -> None:
    """Bake AO into a linear float corner attribute and remap it.

    The raw bake runs 0..1 with true black in crevices, which as a base-colour
    multiplier reads as dirt. It is remapped to ``floor + (1 - floor) * ao^gamma``
    so a fully occluded corner keeps a third of its colour.

    ``occluders_only_self`` hides every other mesh during each object's bake -
    used for parts that move (wheels), whose occlusion must not depend on
    where they happened to be parked when baked. ``also_visible`` keeps a few
    occluders in view anyway: world props are all authored at the origin, so
    each is baked alone but against a shared ground plane.
    """
    _ensure_cycles(samples)
    scene = bpy.context.scene
    scene.world.light_settings.distance = distance
    scene.render.bake.target = "VERTEX_COLORS"
    all_meshes = [o for o in scene.objects if o.type == "MESH"]
    for obj in objects:
        if obj.type != "MESH" or not obj.data.polygons:
            continue
        mesh = obj.data
        attribute = mesh.color_attributes.get(AO_ATTRIBUTE)
        if attribute is None:
            attribute = mesh.color_attributes.new(AO_ATTRIBUTE, "FLOAT_COLOR", "CORNER")
        mesh.color_attributes.active_color = attribute
        mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index
        hidden = []
        if occluders_only_self:
            for other in all_meshes:
                if other is not obj and other not in also_visible and not other.hide_render:
                    other.hide_render = True
                    hidden.append(other)
        bpy.ops.object.select_all(action="DESELECT")
        obj.hide_render = False
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        try:
            bpy.ops.object.bake(type="AO")
        finally:
            for other in hidden:
                other.hide_render = False
        values = [0.0] * (len(attribute.data) * 4)
        attribute.data.foreach_get("color", values)
        for i in range(0, len(values), 4):
            ao = max(0.0, min(1.0, values[i]))
            shade = floor + (1.0 - floor) * (ao ** gamma)
            values[i] = values[i + 1] = values[i + 2] = shade
            values[i + 3] = 1.0
        attribute.data.foreach_set("color", values)
        mesh.update()


def ensure_white_ao(objects: Sequence[bpy.types.Object]) -> None:
    """Give unbaked meshes a neutral AO attribute so every primitive has COLOR_0."""
    for obj in objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        if mesh.color_attributes.get(AO_ATTRIBUTE) is not None:
            continue
        attribute = mesh.color_attributes.new(AO_ATTRIBUTE, "FLOAT_COLOR", "CORNER")
        values = [1.0] * (len(attribute.data) * 4)
        attribute.data.foreach_set("color", values)
        mesh.color_attributes.active_color = attribute
        mesh.color_attributes.render_color_index = mesh.color_attributes.active_color_index


def wire_ao_into_materials(materials: Iterable[bpy.types.Material]) -> None:
    """Multiply base colour by the AO attribute so Blender renders match the
    browser (glTF multiplies COLOR_0 into base colour on its own)."""
    for material in materials:
        if material is None or not material.use_nodes:
            continue
        tree = material.node_tree
        bsdf = next((n for n in tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
        if bsdf is None or any(n.type == "VERTEX_COLOR" for n in tree.nodes):
            continue
        base = bsdf.inputs["Base Color"]
        colour = tuple(base.default_value)
        attr = tree.nodes.new("ShaderNodeVertexColor")
        attr.layer_name = AO_ATTRIBUTE
        mix = tree.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs["Factor"].default_value = 1.0
        mix.inputs[6].default_value = colour          # A
        tree.links.new(attr.outputs["Color"], mix.inputs[7])  # B
        tree.links.new(mix.outputs[2], base)


def look_at(obj: bpy.types.Object, target: Sequence[float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def matrix_from(location=(0.0, 0.0, 0.0), rotation_z: float = 0.0) -> Matrix:
    return Matrix.Translation(Vector(location)) @ Matrix.Rotation(rotation_z, 4, "Z")
