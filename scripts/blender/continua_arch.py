"""
Architecture kit for the CONTINUA world props.

Small, composable builders that write into a set of per-material bmeshes - a
`Kit` - so a building is assembled the way an architect describes one: a
volume, a curtain wall on this face, fins every 1.5 m, a parapet, a roof plant
enclosure, a sign. When the kit is finished it becomes ONE object with one
material slot per finish, which the runtime turns into one draw call per finish
however many windows the building has.

Conventions (shared with continua_lib / continua_geo):
    metres, Z-up, every prop authored at the origin with its base on z = 0.
    A building's FRONT faces +X unless its docstring says otherwise.
"""

from __future__ import annotations

import math
import random
from typing import Iterable, Sequence

import bmesh
import bpy
from mathutils import Matrix, Vector

import continua_geo as geo
import continua_lib as lib


# --------------------------------------------------------------------------
# Materials for the world
# --------------------------------------------------------------------------


def world_materials() -> dict[str, bpy.types.Material]:
    """Daylight palette: pale panels, graphite structure, blue-grey glass,
    restrained CONTINUA accents - and a green coastal island's planting, lush
    leaf and flowering trees, so the landscape carries the colour and the
    white rover stays the cleanest object in frame."""
    pbr = lib.pbr
    return {
        "panel": pbr("W_Panel_White", "#E6EBF2", roughness=0.55),
        "panel_warm": pbr("W_Panel_Warm", "#E9E4DA", roughness=0.62),
        "panel_grey": pbr("W_Panel_Grey", "#AEB8C6", roughness=0.58),
        "graphite": pbr("W_Graphite", "#3A414C", metallic=0.35, roughness=0.5),
        "steel": pbr("W_Steel", "#9AA5B4", metallic=0.75, roughness=0.38),
        "steel_dark": pbr("W_Steel_Dark", "#4A5361", metallic=0.6, roughness=0.45),
        "galv": pbr("W_Galvanised", "#B9C2CD", metallic=0.7, roughness=0.42),
        "glass": pbr("W_Glass", "#33475F", metallic=0.25, roughness=0.10),
        "glass_dark": pbr("W_Glass_Dark", "#1F2B3D", metallic=0.3, roughness=0.08),
        "concrete": pbr("W_Concrete", "#C9CDD3", roughness=0.86),
        "concrete_warm": pbr("W_Concrete_Warm", "#D3CCBF", roughness=0.88),
        "asphalt": pbr("W_Asphalt", "#5B6170", roughness=0.92),
        "paint_line": pbr("W_Line_White", "#F2F4F7", roughness=0.7),
        "accent": pbr("W_Accent_Blue", "#176BFF", roughness=0.45),
        "accent_cyan": pbr("W_Accent_Cyan", "#12B9E8", roughness=0.45),
        "accent_violet": pbr("W_Accent_Violet", "#7C3CFF", roughness=0.45),
        "signal_red": pbr("W_Signal_Red", "#D9483B", roughness=0.5),
        "amber": pbr("W_Amber", "#F2A71B", roughness=0.5),
        "solar": pbr("W_Solar", "#1C2A44", metallic=0.5, roughness=0.18),
        "rubber": pbr("W_Rubber", "#22262D", roughness=0.85),
        "tank_white": pbr("W_Tank_White", "#EEF0F2", metallic=0.2, roughness=0.42),
        "rust": pbr("W_Rust", "#9A6B4A", metallic=0.3, roughness=0.75),
        "sand": pbr("W_Sand", "#E3D6B4", roughness=0.95),
        "rock": pbr("W_Rock", "#A3A59F", roughness=0.9),
        "rock_dark": pbr("W_Rock_Dark", "#7A7E79", roughness=0.92),
        "trunk": pbr("W_Trunk", "#6A5745", roughness=0.92),
        "leaf": pbr("W_Leaf", "#4C8C3A", roughness=0.82),
        "leaf_dark": pbr("W_Leaf_Dark", "#2E6930", roughness=0.84),
        "leaf_dry": pbr("W_Leaf_Dry", "#8DB64A", roughness=0.86),
        "soil": pbr("W_Soil", "#5E4A3A", roughness=0.96),
        # Flowering planting: bougainvillea, flame tree, jacaranda, bedding.
        "blossom_magenta": pbr("W_Blossom_Magenta", "#D93A8C", roughness=0.7),
        "blossom_coral": pbr("W_Blossom_Coral", "#F26A4B", roughness=0.7),
        "blossom_yellow": pbr("W_Blossom_Yellow", "#F2C12E", roughness=0.7),
        "blossom_white": pbr("W_Blossom_White", "#F5F2EA", roughness=0.7),
        "blossom_flame": pbr("W_Blossom_Flame", "#E5482C", roughness=0.7),
        "blossom_lilac": pbr("W_Blossom_Lilac", "#9B7ADB", roughness=0.7),
        # The waterfront.
        "roof_tile": pbr("W_Roof_Tile", "#C0573C", roughness=0.78),
        "hull_orange": pbr("W_Hull_Orange", "#F26B21", roughness=0.45, coat=0.4),
        "teak": pbr("W_Teak", "#A47148", roughness=0.75),
        "sail": pbr("W_Sail", "#F7F5EF", roughness=0.85),
        "fabric": pbr("W_Fabric", "#F4F6F9", roughness=0.8),
        "lamp": pbr("W_Lamp", "#FFF7E6", roughness=0.2, emission="#FFF2D6",
                    emission_strength=0.6),
        "mesh": pbr("W_Fence_Mesh", "#5A6575", metallic=0.4, roughness=0.6, alpha=0.32),
        "car_white": pbr("W_Car_White", "#E8ECF1", metallic=0.1, roughness=0.35, coat=0.6),
        "car_grey": pbr("W_Car_Grey", "#8D97A6", metallic=0.4, roughness=0.35, coat=0.6),
        "car_blue": pbr("W_Car_Blue", "#3D5A86", metallic=0.4, roughness=0.35, coat=0.6),
        "tower_glass": pbr("W_Tower_Glass", "#8FA6C4", metallic=0.4, roughness=0.12),
        "tower_panel": pbr("W_Tower_Panel", "#D7DEE8", roughness=0.6),
    }


# --------------------------------------------------------------------------
# The kit
# --------------------------------------------------------------------------


class Kit:
    """Per-material bmeshes for one prop. `kit["glass"]` is the glass bmesh."""

    def __init__(self, name: str, mats: dict[str, bpy.types.Material]) -> None:
        self.name = name
        self.mats = mats
        self.meshes: dict[str, bmesh.types.BMesh] = {}

    def __getitem__(self, key: str) -> bmesh.types.BMesh:
        if key not in self.meshes:
            if key not in self.mats:
                raise KeyError(f"unknown world material '{key}'")
            self.meshes[key] = bmesh.new()
        return self.meshes[key]

    def finish(self, smooth_angle: float = 35.0, keep: Iterable[str] = ()) -> bpy.types.Object:
        """One object, one slot per finish. Empty finishes are dropped."""
        objects = []
        for key, bm in self.meshes.items():
            if not bm.faces:
                bm.free()
                continue
            obj = geo.to_object(f"{self.name}__{key}", bm, [self.mats[key]])
            objects.append(obj)
        self.meshes = {}
        if not objects:
            raise RuntimeError(f"{self.name} produced no geometry")
        obj = geo.join(objects, self.name)
        geo.smooth(obj, smooth_angle)
        return obj


# --------------------------------------------------------------------------
# Primitives with enough subdivision for a vertex AO bake
# --------------------------------------------------------------------------


def box(bm, center, size, rotation: Matrix | None = None) -> None:
    lib.bm_box(bm, center, size, rotation)


def slab(bm, center, size, cell: float = 3.0) -> None:
    """A box whose large faces are split into roughly `cell`-sized quads.

    A 40 m wall with four vertices gives a vertex AO bake nothing to hold;
    split every few metres it carries a soft darkening toward the ground and
    into corners, which is most of what makes a building sit in a scene.
    """
    cx, cy, cz = center
    sx, sy, sz = size
    nx = max(1, int(math.ceil(sx / cell)))
    ny = max(1, int(math.ceil(sy / cell)))
    nz = max(1, int(math.ceil(sz / cell)))
    verts = {}

    def v(i, j, k):
        key = (i, j, k)
        if key not in verts:
            verts[key] = bm.verts.new((cx - sx / 2 + sx * i / nx,
                                       cy - sy / 2 + sy * j / ny,
                                       cz - sz / 2 + sz * k / nz))
        return verts[key]

    faces = []
    for i in range(nx):                       # bottom and top
        for j in range(ny):
            faces.append((v(i, j, 0), v(i, j + 1, 0), v(i + 1, j + 1, 0), v(i + 1, j, 0)))
            faces.append((v(i, j, nz), v(i + 1, j, nz), v(i + 1, j + 1, nz), v(i, j + 1, nz)))
    for i in range(nx):                       # front and back (y)
        for k in range(nz):
            faces.append((v(i, 0, k), v(i + 1, 0, k), v(i + 1, 0, k + 1), v(i, 0, k + 1)))
            faces.append((v(i, ny, k), v(i, ny, k + 1), v(i + 1, ny, k + 1), v(i + 1, ny, k)))
    for j in range(ny):                       # sides (x)
        for k in range(nz):
            faces.append((v(0, j, k), v(0, j, k + 1), v(0, j + 1, k + 1), v(0, j + 1, k)))
            faces.append((v(nx, j, k), v(nx, j + 1, k), v(nx, j + 1, k + 1), v(nx, j, k + 1)))
    for face in faces:
        bm.faces.new(face)


def cylinder(bm, center, radius, depth, segments=24, axis="Z") -> None:
    lib.bm_cylinder(bm, center, radius, depth, segments, axis)


def bar(bm, p0, p1, width, height) -> None:
    lib.bm_bar(bm, p0, p1, width, height)


def pipe(bm, p0, p1, radius, segments=10) -> None:
    geo.tube(bm, [p0, p1], radius, segments, up_hint=_up_for(p0, p1))


def _up_for(p0, p1):
    d = Vector(p1) - Vector(p0)
    if d.length < 1e-9:
        return (0.0, 0.0, 1.0)
    d.normalize()
    return (1.0, 0.0, 0.0) if abs(d.z) > 0.9 else (0.0, 0.0, 1.0)


# --------------------------------------------------------------------------
# Facade elements. All take a wall described by its outward axis.
# --------------------------------------------------------------------------


def _wall_frame(axis: str, offset: float):
    """(point(u, z, depth), along-axis index) for a vertical wall plane.

    axis '+x' : wall at x = offset, u runs along +y
    axis '-x' : wall at x = -offset, u runs along -y
    axis '+y' : wall at y = offset, u runs along -x
    axis '-y' : wall at y = -offset, u runs along +x
    `depth` is measured outward from the wall.
    """
    sign = 1.0 if axis[0] == "+" else -1.0
    if axis[1] == "x":
        return lambda u, z, d: (sign * (offset + d), sign * u, z)
    return lambda u, z, d: (-sign * u, sign * (offset + d), z)


def curtain_wall(kit: Kit, axis: str, offset: float, u0: float, u1: float, z0: float, z1: float,
                 mullion: float = 1.5, transom: float | None = None, glass: str = "glass",
                 frame: str = "graphite", recess: float = 0.12, mullion_depth: float = 0.18,
                 mullion_w: float = 0.08) -> None:
    """A glazed band set back into a wall, with mullions (and transoms)."""
    point = _wall_frame(axis, offset)
    span = u1 - u0
    # Glass plane: a thin slab, recessed.
    c0 = Vector(point(u0, z0, -recess))
    c1 = Vector(point(u1, z1, -recess + 0.03))
    centre = (c0 + c1) / 2
    size = Vector((abs(c1.x - c0.x), abs(c1.y - c0.y), abs(c1.z - c0.z)))
    size = Vector((max(size.x, 0.03), max(size.y, 0.03), size.z))
    box(kit[glass], centre, size)
    count = max(1, int(round(span / mullion)))
    for i in range(count + 1):
        u = u0 + span * i / count
        a = Vector(point(u, z0, -recess))
        b = Vector(point(u, z1, -recess))
        mid = (a + b) / 2
        out = Vector(point(u, 0.0, mullion_depth - recess)) - Vector(point(u, 0.0, -recess))
        mid += out * 0.5
        if axis[1] == "x":
            box(kit[frame], mid, (mullion_depth, mullion_w, z1 - z0))
        else:
            box(kit[frame], mid, (mullion_w, mullion_depth, z1 - z0))
    rows = [z0, z1]
    if transom:
        n = max(1, int(round((z1 - z0) / transom)))
        rows = [z0 + (z1 - z0) * k / n for k in range(n + 1)]
    for z in rows:
        a = Vector(point(u0, z, -recess + mullion_depth * 0.5))
        b = Vector(point(u1, z, -recess + mullion_depth * 0.5))
        mid = (a + b) / 2
        if axis[1] == "x":
            box(kit[frame], mid, (mullion_depth, span, mullion_w))
        else:
            box(kit[frame], mid, (span, mullion_depth, mullion_w))


def fins(kit: Kit, axis: str, offset: float, u0: float, u1: float, z0: float, z1: float,
         spacing: float = 1.5, depth: float = 0.55, thickness: float = 0.12,
         material: str = "panel") -> None:
    """Vertical sun fins standing proud of a wall."""
    point = _wall_frame(axis, offset)
    count = max(1, int(round((u1 - u0) / spacing)))
    for i in range(count + 1):
        u = u0 + (u1 - u0) * i / count
        mid = Vector(point(u, (z0 + z1) / 2, depth / 2))
        if axis[1] == "x":
            box(kit[material], mid, (depth, thickness, z1 - z0))
        else:
            box(kit[material], mid, (thickness, depth, z1 - z0))


def louvres(kit: Kit, axis: str, offset: float, u0: float, u1: float, z0: float, z1: float,
            pitch: float = 0.18, material: str = "graphite") -> None:
    """Horizontal louvre blades over an opening - plant rooms, data halls."""
    point = _wall_frame(axis, offset)
    count = max(1, int((z1 - z0) / pitch))
    for i in range(count):
        z = z0 + (i + 0.5) * (z1 - z0) / count
        a = Vector(point(u0, z, 0.05))
        b = Vector(point(u1, z, 0.05))
        mid = (a + b) / 2
        if axis[1] == "x":
            box(kit[material], mid, (0.10, abs(u1 - u0), 0.035))
        else:
            box(kit[material], mid, (abs(u1 - u0), 0.10, 0.035))
    # Surround frame.
    for z in (z0, z1):
        mid = (Vector(point(u0, z, 0.06)) + Vector(point(u1, z, 0.06))) / 2
        if axis[1] == "x":
            box(kit[material], mid, (0.14, abs(u1 - u0) + 0.1, 0.08))
        else:
            box(kit[material], mid, (abs(u1 - u0) + 0.1, 0.14, 0.08))


def ribbon_windows(kit: Kit, axis: str, offset: float, u0: float, u1: float, z0: float, z1: float,
                   pane: float = 1.4, glass: str = "glass", frame: str = "graphite") -> None:
    curtain_wall(kit, axis, offset, u0, u1, z0, z1, mullion=pane, glass=glass, frame=frame,
                 recess=0.10, mullion_depth=0.12, mullion_w=0.06)


def door(kit: Kit, axis: str, offset: float, u: float, width: float, height: float,
         material: str = "graphite", panel_lines: int = 0) -> None:
    point = _wall_frame(axis, offset)
    mid = Vector(point(u, height / 2, 0.02))
    if axis[1] == "x":
        box(kit[material], mid, (0.08, width, height))
    else:
        box(kit[material], mid, (width, 0.08, height))
    for k in range(1, panel_lines + 1):
        z = height * k / (panel_lines + 1)
        mid = Vector(point(u, z, 0.07))
        if axis[1] == "x":
            box(kit["steel_dark"], mid, (0.03, width * 0.98, 0.03))
        else:
            box(kit["steel_dark"], mid, (width * 0.98, 0.03, 0.03))


def parapet(kit: Kit, cx: float, cy: float, sx: float, sy: float, z: float, height: float = 0.9,
            thickness: float = 0.3, material: str = "panel") -> None:
    """A parapet ring on a rectangular roof."""
    box(kit[material], (cx + sx / 2 - thickness / 2, cy, z + height / 2), (thickness, sy, height))
    box(kit[material], (cx - sx / 2 + thickness / 2, cy, z + height / 2), (thickness, sy, height))
    box(kit[material], (cx, cy + sy / 2 - thickness / 2, z + height / 2), (sx - 2 * thickness, thickness, height))
    box(kit[material], (cx, cy - sy / 2 + thickness / 2, z + height / 2), (sx - 2 * thickness, thickness, height))
    # Coping.
    for dx, dy, lx, ly in ((sx / 2 - thickness / 2, 0, thickness + 0.06, sy + 0.06),
                           (-sx / 2 + thickness / 2, 0, thickness + 0.06, sy + 0.06),
                           (0, sy / 2 - thickness / 2, sx, thickness + 0.06),
                           (0, -sy / 2 + thickness / 2, sx, thickness + 0.06)):
        box(kit["graphite"], (cx + dx, cy + dy, z + height + 0.03), (lx, ly, 0.06))


def railing(kit: Kit, points: Sequence[Sequence[float]], height: float = 1.1, post: float = 1.5,
            material: str = "galv", radius: float = 0.03) -> None:
    pts = [Vector(p) for p in points]
    for a, b in zip(pts, pts[1:]):
        length = (b - a).length
        n = max(1, int(round(length / post)))
        for i in range(n + 1):
            p = a.lerp(b, i / n)
            pipe(kit[material], p, p + Vector((0, 0, height)), radius * 0.9, 6)
        for h in (height, height * 0.5):
            pipe(kit[material], a + Vector((0, 0, h)), b + Vector((0, 0, h)), radius, 6)


def stair_flight(kit: Kit, start, direction, rise: float, steps: int, width: float = 1.0,
                 material: str = "steel_dark") -> None:
    d = Vector(direction).normalized()
    side = Vector((-d.y, d.x, 0.0))
    run = 0.28
    for i in range(steps):
        p = Vector(start) + d * (run * (i + 0.5)) + Vector((0, 0, rise * (i + 1) / steps))
        box(kit[material], p, _oriented_size(d, run, width, 0.05))
    top = Vector(start) + d * run * steps + Vector((0, 0, rise))
    for s in (-1, 1):
        a = Vector(start) + side * s * width / 2
        b = top + side * s * width / 2
        bar(kit[material], a, b, 0.06, 0.18)


def _oriented_size(direction: Vector, along: float, across: float, height: float):
    if abs(direction.x) >= abs(direction.y):
        return (along, across, height)
    return (across, along, height)


def lattice(kit: Kit, height: float, base_half: float, top_half: float, bays: int,
            leg: float = 0.18, brace: float = 0.07, material: str = "galv",
            z0: float = 0.0, origin: Sequence[float] = (0.0, 0.0)) -> None:
    """A tapered square lattice mast: legs, rings, X-bracing."""
    ox, oy = origin

    def half_at(z):
        return base_half + (top_half - base_half) * ((z - z0) / height)

    def p(sx, sy, h, z):
        return (ox + sx * h, oy + sy * h, z)

    corners = ((1, 1), (1, -1), (-1, -1), (-1, 1))
    for bay in range(bays):
        za, zb = z0 + height * bay / bays, z0 + height * (bay + 1) / bays
        ha, hb = half_at(za), half_at(zb)
        for sx, sy in corners:
            bar(kit[material], p(sx, sy, ha, za), p(sx, sy, hb, zb), leg, leg)
        for (ax, ay), (bx, by) in zip(corners, corners[1:] + corners[:1]):
            bar(kit[material], p(ax, ay, ha, za), p(bx, by, hb, zb), brace, brace)
            bar(kit[material], p(bx, by, ha, za), p(ax, ay, hb, zb), brace, brace)
            bar(kit[material], p(ax, ay, hb, zb), p(bx, by, hb, zb), brace * 1.2, brace * 1.2)


def sign_text(name: str, body: str, location, rotation, size: float,
              material: bpy.types.Material, extrude: float = 0.03,
              align: str = "CENTER") -> bpy.types.Object:
    """Signage lettering as real geometry, transform baked in."""
    curve = bpy.data.curves.new(name + "_curve", type="FONT")
    curve.body = body
    curve.size = size
    curve.extrude = extrude
    curve.align_x = align
    curve.align_y = "CENTER"
    curve.space_character = 1.12
    curve.resolution_u = 4
    obj = bpy.data.objects.new(name, curve)
    obj.location = Vector(location)
    obj.rotation_euler = rotation
    bpy.context.scene.collection.objects.link(obj)
    lib.select_only([obj])
    bpy.ops.object.convert(target="MESH")
    mesh_obj = bpy.context.view_layer.objects.active
    mesh_obj.name = name
    mesh_obj.data.materials.clear()
    mesh_obj.data.materials.append(material)
    mesh_obj.data.transform(mesh_obj.matrix_basis)
    mesh_obj.matrix_basis = Matrix.Identity(4)
    return mesh_obj


# Rotations that stand a text object up facing each axis, reading left-to-right
# for a viewer looking at that face.
FACING = {
    "+x": (math.pi / 2, 0.0, math.pi / 2),
    "-x": (math.pi / 2, 0.0, -math.pi / 2),
    "+y": (math.pi / 2, 0.0, math.pi),
    "-y": (math.pi / 2, 0.0, 0.0),
}


def attach(base: bpy.types.Object, parts: Sequence[bpy.types.Object]) -> bpy.types.Object:
    """Join extra objects (signage, a dish) into a finished prop."""
    name = base.name
    joined = geo.join([base] + [p for p in parts if p is not None], name)
    return joined


def rng(seed: int) -> random.Random:
    return random.Random(seed)
