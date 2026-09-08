"""
Shared helpers for the CONTINUA Blender generation scripts.

Conventions (also documented in docs/ASSET_MANIFEST.md):

    * Units are metres.
    * Blender is Z-up. Vehicle forward is **+X**, left is **+Y**, up is **+Z**.
    * The glTF exporter converts Z-up -> Y-up, mapping
          gltf.x =  blender.x
          gltf.y =  blender.z
          gltf.z = -blender.y
      so in the runtime asset: forward **+X**, up **+Y**, wheel spin axis
      **local Z**, steering axis **local Y**.
    * Everything is built from primitives and explicit bmesh geometry — no
      booleans, no procedural-only shaders, so the export is faithful.
"""

from __future__ import annotations

import math
import os
import sys
from typing import Iterable, Sequence

import bmesh
import bpy
from mathutils import Matrix, Vector

# --------------------------------------------------------------------------
# Paths
# --------------------------------------------------------------------------


def repo_root() -> str:
    env = os.environ.get("CONTINUA_REPO_ROOT")
    if env and os.path.isdir(env):
        return env
    return os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))


def out_path(*parts: str) -> str:
    path = os.path.join(repo_root(), *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    return path


def banner(title: str) -> None:
    print(f"\n{'=' * 68}\n  {title}\n{'=' * 68}", flush=True)


# --------------------------------------------------------------------------
# Scene bootstrap
# --------------------------------------------------------------------------


def reset_scene(scene_name: str = "CONTINUA") -> bpy.types.Scene:
    """Start from a genuinely empty, uniquely named CONTINUA scene.

    Never reuses whatever happened to be in the file, so the build is
    reproducible from `--factory-startup`.
    """
    for collection in (
        bpy.data.objects, bpy.data.meshes, bpy.data.materials, bpy.data.curves,
        bpy.data.cameras, bpy.data.lights, bpy.data.images, bpy.data.node_groups,
        bpy.data.collections, bpy.data.worlds,
    ):
        for item in list(collection):
            try:
                collection.remove(item)
            except (RuntimeError, ReferenceError):
                pass

    scene = bpy.context.scene
    scene.name = scene_name
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene.unit_settings.length_unit = "METERS"
    return scene


def enable_addon(module: str) -> bool:
    try:
        bpy.ops.preferences.addon_enable(module=module)
        return True
    except Exception as exc:  # noqa: BLE001 - reported, not swallowed
        print(f"  ! could not enable addon '{module}': {exc}")
        return False


# --------------------------------------------------------------------------
# Materials
# --------------------------------------------------------------------------


def srgb(hex_code: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    """Hex sRGB -> linear RGBA, which is what Blender sockets expect."""
    hex_code = hex_code.lstrip("#")
    channels = [int(hex_code[i:i + 2], 16) / 255.0 for i in (0, 2, 4)]
    linear = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels]
    return (linear[0], linear[1], linear[2], alpha)


def pbr(
    name: str,
    base: str,
    *,
    metallic: float = 0.0,
    roughness: float = 0.5,
    alpha: float = 1.0,
    emission: str | None = None,
    emission_strength: float = 0.0,
    coat: float = 0.0,
    coat_roughness: float = 0.05,
    ior: float = 1.45,
) -> bpy.types.Material:
    """Create (or fetch) an export-safe Principled BSDF material."""
    if name in bpy.data.materials:
        return bpy.data.materials[name]

    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    inputs = bsdf.inputs

    inputs["Base Color"].default_value = srgb(base)
    inputs["Metallic"].default_value = metallic
    inputs["Roughness"].default_value = roughness
    inputs["IOR"].default_value = ior
    inputs["Alpha"].default_value = alpha
    if "Coat Weight" in inputs:
        inputs["Coat Weight"].default_value = coat
        inputs["Coat Roughness"].default_value = coat_roughness
    if emission is not None:
        inputs["Emission Color"].default_value = srgb(emission)
        inputs["Emission Strength"].default_value = emission_strength

    if alpha < 1.0:
        material.surface_render_method = "BLENDED"
        material.use_backface_culling = False
    material.diffuse_color = srgb(base, alpha)  # viewport / Workbench fallback
    return material


def continua_materials() -> dict[str, bpy.types.Material]:
    """The shared CONTINUA material set. Reused by vehicle and world props."""
    return {
        # --- vehicle -------------------------------------------------------
        "paint": pbr("CONTINUA_Paint_White", "#EDF1F8", metallic=0.0, roughness=0.34, coat=0.55),
        "paint_lower": pbr("CONTINUA_Paint_Lower", "#93A0B4", metallic=0.05, roughness=0.48,
                           coat=0.25),
        "paint_grey": pbr("CONTINUA_Paint_Grey", "#B9C2D2", metallic=0.05, roughness=0.42, coat=0.3),
        "trim": pbr("CONTINUA_Trim_Black", "#171B22", metallic=0.05, roughness=0.58),
        "interior": pbr("CONTINUA_Interior", "#1E242F", metallic=0.05, roughness=0.72),
        "interior_soft": pbr("CONTINUA_Interior_Soft", "#141920", metallic=0.0, roughness=0.85),
        "rubber": pbr("CONTINUA_Rubber", "#15181E", metallic=0.0, roughness=0.88),
        "rim": pbr("CONTINUA_Rim_Alloy", "#C4CBD6", metallic=0.88, roughness=0.28),
        "metal_dark": pbr("CONTINUA_Metal_Dark", "#39404E", metallic=0.75, roughness=0.42),
        "glass": pbr("CONTINUA_Glass_Tint", "#0C111C", metallic=0.0, roughness=0.05,
                     alpha=0.84, ior=1.5, coat=0.9),
        "light_front": pbr("CONTINUA_Light_Front", "#E6EFFF", metallic=0.0, roughness=0.10,
                           emission="#FFFFFF", emission_strength=1.1),
        "light_amber": pbr("CONTINUA_Light_Amber", "#B45309", metallic=0.0, roughness=0.16,
                           emission="#FF9D0A", emission_strength=1.5),
        "light_rear": pbr("CONTINUA_Light_Rear", "#8E0F12", metallic=0.0, roughness=0.16,
                          emission="#E01A16", emission_strength=1.4),
        "accent_blue": pbr("CONTINUA_Accent_Blue", "#176BFF", metallic=0.0, roughness=0.35,
                           emission="#176BFF", emission_strength=0.6),
        "accent_cyan": pbr("CONTINUA_Accent_Cyan", "#12B9E8", metallic=0.0, roughness=0.35,
                           emission="#12B9E8", emission_strength=0.8),
        "accent_violet": pbr("CONTINUA_Accent_Violet", "#7C3CFF", metallic=0.0, roughness=0.35,
                             emission="#7C3CFF", emission_strength=0.7),
        "sensor": pbr("CONTINUA_Sensor_Housing", "#2B3242", metallic=0.55, roughness=0.34),
        "sensor_lens": pbr("CONTINUA_Sensor_Lens", "#0E1422", metallic=0.2, roughness=0.08),
        # --- world ---------------------------------------------------------
        "concrete": pbr("CONTINUA_Concrete", "#C4CEDD", metallic=0.0, roughness=0.84),
        "concrete_dark": pbr("CONTINUA_Concrete_Dark", "#C3CBD9", metallic=0.0, roughness=0.86),
        "building": pbr("CONTINUA_Building", "#DDE4EF", metallic=0.0, roughness=0.62),
        "building_glass": pbr("CONTINUA_Building_Glass", "#9FB6D6", metallic=0.1, roughness=0.12,
                              alpha=0.8),
        "steel": pbr("CONTINUA_Steel", "#AAB4C4", metallic=0.85, roughness=0.36),
        "steel_white": pbr("CONTINUA_Steel_White", "#D3DBE7", metallic=0.35, roughness=0.42),
        "asphalt": pbr("CONTINUA_Asphalt", "#9BA7B9", metallic=0.0, roughness=0.9),
        "sand": pbr("CONTINUA_Sand", "#AEA48F", metallic=0.0, roughness=0.95),
    }


# --------------------------------------------------------------------------
# Mesh construction helpers
# --------------------------------------------------------------------------


def new_mesh_object(name: str, bm: bmesh.types.BMesh, material: bpy.types.Material | None = None,
                    collection: bpy.types.Collection | None = None) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    if material is not None:
        mesh.materials.append(material)
    (collection or bpy.context.scene.collection).objects.link(obj)
    return obj


def bm_box(bm: bmesh.types.BMesh, center: Sequence[float], size: Sequence[float],
           rotation: Matrix | None = None) -> list[bmesh.types.BMVert]:
    """Add an axis-aligned (optionally rotated) box to an existing bmesh."""
    matrix = Matrix.Translation(Vector(center))
    if rotation is not None:
        matrix = matrix @ rotation
    matrix = matrix @ Matrix.Diagonal(Vector(size)).to_4x4()
    result = bmesh.ops.create_cube(bm, size=1.0, matrix=matrix)
    return result["verts"]


def bm_cylinder(bm: bmesh.types.BMesh, center: Sequence[float], radius: float, depth: float,
                segments: int = 24, axis: str = "Z", rotation: Matrix | None = None) -> None:
    """Add a capped cylinder. `axis` is the cylinder's long axis."""
    align = {"Z": Matrix.Identity(4),
             "X": Matrix.Rotation(math.radians(90), 4, "Y"),
             "Y": Matrix.Rotation(math.radians(-90), 4, "X")}[axis]
    matrix = Matrix.Translation(Vector(center)) @ (rotation or Matrix.Identity(4)) @ align
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=radius, radius2=radius, depth=depth, matrix=matrix,
    )


def bm_cone(bm: bmesh.types.BMesh, center: Sequence[float], radius1: float, radius2: float,
            depth: float, segments: int = 24, axis: str = "Z") -> None:
    align = {"Z": Matrix.Identity(4),
             "X": Matrix.Rotation(math.radians(90), 4, "Y"),
             "Y": Matrix.Rotation(math.radians(-90), 4, "X")}[axis]
    bmesh.ops.create_cone(
        bm, cap_ends=True, cap_tris=False, segments=segments,
        radius1=radius1, radius2=radius2, depth=depth,
        matrix=Matrix.Translation(Vector(center)) @ align,
    )


def bm_bar(bm: bmesh.types.BMesh, p0: Sequence[float], p1: Sequence[float],
           width: float, height: float) -> None:
    """A box whose local +X runs from `p0` to `p1`.

    `width` is the extent along the bar's local Y, `height` along its local Z.
    For bars lying in the X-Z plane the rotation is a pure Y-axis turn, so
    `width` stays the global-Y thickness — which is what every pillar, rail and
    wheel-arch segment in this project relies on.
    """
    start, end = Vector(p0), Vector(p1)
    direction = end - start
    length = direction.length
    if length < 1e-6:
        return
    rotation = Vector((1.0, 0.0, 0.0)).rotation_difference(direction.normalized()).to_matrix().to_4x4()
    matrix = (Matrix.Translation((start + end) * 0.5) @ rotation
              @ Matrix.Diagonal(Vector((length, width, height))).to_4x4())
    bmesh.ops.create_cube(bm, size=1.0, matrix=matrix)


def bm_sphere(bm: bmesh.types.BMesh, center: Sequence[float], radius: float,
              segments: int = 16, rings: int = 8,
              scale: Sequence[float] = (1.0, 1.0, 1.0)) -> None:
    matrix = (Matrix.Translation(Vector(center))
              @ Matrix.Diagonal(Vector(scale)).to_4x4())
    try:
        bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings,
                                  radius=radius, matrix=matrix)
    except TypeError:  # pre-3.0 argument name
        bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings,
                                  diameter=radius, matrix=matrix)


def bm_arc_band(bm: bmesh.types.BMesh, center_xz: Sequence[float], y: float, radius: float,
                start_deg: float, end_deg: float, steps: int,
                band_width: float, band_thickness: float) -> None:
    """A swept band following an arc in the X-Z plane — used for wheel arches."""
    points = arc_points(center_xz[0], center_xz[1], radius, start_deg, end_deg, steps)
    for index in range(len(points) - 1):
        (x0, z0), (x1, z1) = points[index], points[index + 1]
        bm_bar(bm, (x0, y, z0), (x1, y, z1), band_width, band_thickness)


def bm_prism(bm: bmesh.types.BMesh, profile_xz: Sequence[tuple[float, float]],
             y_min: float, y_max: float) -> None:
    """Extrude a closed 2-D profile (in the X-Z plane) along Y.

    The profile may be concave — that is how the wheel arches are cut out of
    the body side. Vertices must be ordered around the outline.
    """
    verts = [bm.verts.new((x, y_min, z)) for x, z in profile_xz]
    bm.verts.ensure_lookup_table()
    face = bm.faces.new(verts)
    extruded = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [element for element in extruded["geom"] if isinstance(element, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0.0, y_max - y_min, 0.0))
    # The original face now points inward after the extrusion; fix winding.
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


def arc_points(cx: float, cz: float, radius: float, start_deg: float, end_deg: float,
               steps: int) -> list[tuple[float, float]]:
    points = []
    for index in range(steps + 1):
        t = start_deg + (end_deg - start_deg) * index / steps
        angle = math.radians(t)
        points.append((cx + radius * math.cos(angle), cz + radius * math.sin(angle)))
    return points


def bm_revolve(bm: bmesh.types.BMesh, profile: Sequence[tuple[float, float]],
               segments: int = 48, axis: str = "Y", center: Sequence[float] = (0, 0, 0)) -> None:
    """Revolve a closed profile of (radius, axial) pairs around `axis`."""
    if axis != "Y":
        raise ValueError("only the Y axis is used by CONTINUA parts")
    ring = []
    for radius, axial in profile:
        vert = bm.verts.new((center[0] + radius, center[1] + axial, center[2]))
        ring.append(vert)
    bm.verts.ensure_lookup_table()
    edges = []
    for index, vert in enumerate(ring):
        edges.append(bm.edges.new((vert, ring[(index + 1) % len(ring)])))
    bmesh.ops.spin(
        bm, geom=edges + ring, axis=(0, 1, 0), steps=segments,
        angle=math.radians(360), dvec=(0, 0, 0), cent=center, use_merge=True,
    )
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])


# --------------------------------------------------------------------------
# Shading, modifiers, hierarchy
# --------------------------------------------------------------------------


def shade_auto(obj: bpy.types.Object, angle_deg: float = 34.0) -> None:
    """Smooth shading with sharp edges above `angle_deg`.

    Blender 4.1 removed `mesh.use_auto_smooth`; the modern equivalent is the
    per-edge sharp flag, which is what this writes. Pure data API, so it is
    deterministic and survives export.
    """
    mesh = obj.data
    if not mesh.polygons:
        return
    mesh.polygons.foreach_set("use_smooth", [True] * len(mesh.polygons))
    threshold = math.radians(angle_deg)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    for edge in bm.edges:
        edge.smooth = len(edge.link_faces) != 2 or edge.calc_face_angle(0.0) < threshold
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def add_bevel(obj: bpy.types.Object, width: float = 0.012, segments: int = 2,
              angle_deg: float = 42.0) -> None:
    modifier = obj.modifiers.new("Bevel", "BEVEL")
    modifier.width = width
    modifier.segments = segments
    modifier.limit_method = "ANGLE"
    modifier.angle_limit = math.radians(angle_deg)
    modifier.miter_outer = "MITER_ARC"
    modifier.harden_normals = False


def apply_modifiers(obj: bpy.types.Object) -> None:
    if not obj.modifiers:
        return
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        try:
            bpy.ops.object.modifier_apply(modifier=modifier.name)
        except RuntimeError as exc:
            print(f"  ! could not apply {modifier.name} on {obj.name}: {exc}")


def select_only(objects: Iterable[bpy.types.Object]) -> list[bpy.types.Object]:
    objects = list(objects)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    if objects:
        bpy.context.view_layer.objects.active = objects[0]
    return objects


def join_objects(objects: Sequence[bpy.types.Object], name: str) -> bpy.types.Object:
    """Join into the first object and rename. Material slots are merged."""
    objects = [o for o in objects if o is not None]
    target = objects[0]
    if len(objects) > 1:
        select_only([target] + list(objects[1:]))
        bpy.ops.object.join()
    target.name = name
    target.data.name = name
    return target


def set_origin(obj: bpy.types.Object, location: Sequence[float]) -> None:
    """Move the object origin to a world location without moving geometry."""
    offset = Vector(location) - obj.matrix_world.translation
    obj.data.transform(Matrix.Translation(-offset))
    obj.matrix_world.translation = Vector(location)


def parent_to(child: bpy.types.Object, parent: bpy.types.Object,
              local_location: Sequence[float] = (0.0, 0.0, 0.0)) -> None:
    """Parent with an explicit local offset and an identity parent-inverse.

    Deliberately does *not* use `matrix_parent_inverse = parent.matrix_world
    .inverted()`: in background mode `matrix_world` is stale until the
    depsgraph is evaluated, so that idiom silently doubles the child's offset.
    Stating the local transform outright is both correct and readable, and it
    keeps the exported glTF node transforms clean.
    """
    child.parent = parent
    child.matrix_parent_inverse = Matrix.Identity(4)
    child.location = Vector(local_location)
    child.rotation_euler = (0.0, 0.0, 0.0)


def new_empty(name: str, location: Sequence[float], size: float = 0.18,
              display: str = "PLAIN_AXES") -> bpy.types.Object:
    empty = bpy.data.objects.new(name, None)
    empty.empty_display_type = display
    empty.empty_display_size = size
    empty.location = Vector(location)
    bpy.context.scene.collection.objects.link(empty)
    return empty


def triangle_count(objects: Iterable[bpy.types.Object]) -> int:
    depsgraph = bpy.context.evaluated_depsgraph_get()
    total = 0
    for obj in objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        total += sum(len(polygon.vertices) - 2 for polygon in mesh.polygons)
        evaluated.to_mesh_clear()
    return total


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------


def export_glb(filepath: str, objects: Sequence[bpy.types.Object], *, draco: bool = False) -> str:
    """Export the given objects to a .glb, filtering kwargs to this build's API."""
    enable_addon("io_scene_gltf2")
    select_only(objects)
    os.makedirs(os.path.dirname(filepath), exist_ok=True)

    wanted = {
        "filepath": filepath,
        "export_format": "GLB",
        "use_selection": True,
        "export_apply": True,
        "export_yup": True,
        "export_materials": "EXPORT",
        "export_image_format": "AUTO",
        "export_texcoords": True,
        "export_normals": True,
        "export_tangents": False,
        "export_cameras": False,
        "export_lights": False,
        "export_extras": True,
        "export_animations": False,
        "export_skins": False,
        "export_morph": False,
        "export_draco_mesh_compression_enable": draco,
        "export_draco_mesh_compression_level": 6,
    }
    # Read the *live* operator's RNA. `bpy.types.EXPORT_SCENE_OT_gltf` can
    # still resolve to a stub when the add-on was enabled during this run,
    # which silently drops every keyword — including `filepath`.
    valid = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    if "filepath" not in valid:
        raise RuntimeError(
            "the glTF exporter did not register its properties; "
            "cannot export safely (io_scene_gltf2 add-on unavailable?)"
        )
    kwargs = {k: v for k, v in wanted.items() if k in valid}
    kwargs["filepath"] = filepath  # never optional
    dropped = sorted(set(wanted) - set(kwargs))
    if dropped:
        print(f"  · exporter ignored unsupported options: {', '.join(dropped)}")
    bpy.ops.export_scene.gltf(**kwargs)
    size = os.path.getsize(filepath)
    print(f"  · exported {os.path.relpath(filepath, repo_root())}  ({size / 1024:.0f} KB)")
    return filepath


def save_blend(filepath: str) -> str:
    os.makedirs(os.path.dirname(filepath), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=filepath, compress=True)
    size = os.path.getsize(filepath)
    print(f"  · saved {os.path.relpath(filepath, repo_root())}  ({size / 1024:.0f} KB)")
    return filepath
