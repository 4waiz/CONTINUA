"""
CONTINUA — world prop library.

Builds the reusable infrastructure that dresses the mission route and exports it
as one glTF whose top-level nodes are instanced by the runtime.

    node scripts/run-blender.mjs scripts/blender/build_props.py

Outputs
    assets/blender/continua_props.blend
    apps/web/public/models/continua_props.glb

Every prop is authored at the world origin with its base on z = 0, so the
runtime places it with a position and a single yaw. Node names are the contract
— `packages/scene/src/world/props.ts` looks them up by name. Per-prop authored
orientation is recorded in docs/ASSET_MANIFEST.md.
"""

from __future__ import annotations

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import continua_lib as lib  # noqa: E402


def finish(name: str, parts: list[tuple[bmesh.types.BMesh, str]], materials: dict,
           bevel: float = 0.03) -> bpy.types.Object:
    """Turn (bmesh, material-key) pairs into one named, shaded, bevelled object."""
    objects = []
    for index, (bm, material_key) in enumerate(parts):
        if not bm.faces:
            bm.free()
            continue
        objects.append(lib.new_mesh_object(f"{name}__part{index}", bm, materials[material_key]))
    obj = lib.join_objects(objects, name)
    if bevel > 0:
        lib.add_bevel(obj, width=bevel, segments=1, angle_deg=45)
        lib.apply_modifiers(obj)
    lib.shade_auto(obj, 32.0)
    return obj


# ==========================================================================
# A. Command facility (wired docking site)
# ==========================================================================


def prop_facility_main(materials: dict) -> bpy.types.Object:
    shell, glass, trim = bmesh.new(), bmesh.new(), bmesh.new()

    lib.bm_box(shell, (0, 0, 4.0), (24.0, 15.0, 8.0))                 # main block
    lib.bm_box(shell, (-3.0, 0, 10.0), (13.0, 10.5, 4.0))             # setback storey
    lib.bm_box(shell, (0, 0, 8.25), (24.6, 15.6, 0.5))                # parapet band
    lib.bm_box(shell, (-3.0, 0, 12.25), (13.6, 11.1, 0.5))

    # Continuous glazing bands read as a technical facility, not a warehouse.
    for z, height in ((3.2, 2.0), (6.4, 1.5)):
        lib.bm_box(glass, (0, 0, z), (24.2, 15.2, height))
    lib.bm_box(glass, (-3.0, 0, 10.4), (13.2, 10.7, 2.2))
    for x in (-9.0, -4.5, 0.0, 4.5, 9.0):                              # mullions
        lib.bm_box(trim, (x, 0, 4.8), (0.35, 15.4, 5.6))
    for y in (-6.0, -2.0, 2.0, 6.0):
        lib.bm_box(trim, (0, y, 4.8), (24.4, 0.35, 5.6))

    # Entrance canopy on the +X face.
    lib.bm_box(shell, (13.4, 0, 3.4), (3.2, 7.0, 0.35))
    for y in (-3.0, 3.0):
        lib.bm_cylinder(trim, (14.6, y, 1.7), 0.14, 3.4, 10, axis="Z")

    # Roof plant and a mast.
    for x, y in ((-8.0, 4.5), (-8.0, -4.5), (5.5, 5.0)):
        lib.bm_box(trim, (x, y, 9.2), (2.6, 2.2, 1.4))
    lib.bm_cylinder(trim, (8.5, -5.5, 10.6), 0.10, 4.6, 8, axis="Z")

    return finish("PROP_Facility_Main",
                  [(shell, "building"), (glass, "building_glass"), (trim, "steel")],
                  materials, bevel=0.05)


def prop_facility_hangar(materials: dict) -> bpy.types.Object:
    shell, trim = bmesh.new(), bmesh.new()

    # Barrel roof: an arc profile extruded along the building length.
    outer = lib.arc_points(0.0, 4.2, 6.0, 180.0, 0.0, 18)
    inner = lib.arc_points(0.0, 4.2, 5.75, 0.0, 180.0, 18)
    lib.bm_prism(shell, outer + inner, -10.0, 10.0)
    for side in (-1, 1):                                   # side walls
        lib.bm_box(shell, (side * 5.85, 0, 2.1), (0.30, 20.0, 4.2))
    lib.bm_box(shell, (0, -10.1, 4.6), (12.0, 0.3, 9.2))   # back gable
    lib.bm_box(trim, (0, 10.05, 3.0), (9.0, 0.25, 6.0))    # roller door
    for x in (-3.6, -1.2, 1.2, 3.6):
        lib.bm_box(trim, (x, 10.18, 3.0), (0.20, 0.12, 5.9))
    lib.bm_box(trim, (0, 10.2, 6.4), (9.6, 0.35, 0.5))

    return finish("PROP_Facility_Hangar",
                  [(shell, "building"), (trim, "steel")], materials, bevel=0.04)


def prop_dock_station(materials: dict) -> bpy.types.Object:
    """The wired dock: pad, data pillar, overhead cable arm, bollards."""
    pad, steel, accent, screen = bmesh.new(), bmesh.new(), bmesh.new(), bmesh.new()

    lib.bm_box(pad, (0, 0, 0.06), (8.0, 5.0, 0.12))
    lib.bm_box(pad, (0, 0, 0.13), (7.0, 4.0, 0.03))

    # Data / power pillar.
    lib.bm_box(steel, (-2.6, 1.6, 1.15), (0.75, 0.75, 2.3))
    lib.bm_box(steel, (-2.6, 1.6, 2.40), (0.95, 0.95, 0.20))
    lib.bm_box(screen, (-2.21, 1.6, 1.65), (0.03, 0.52, 0.36))
    lib.bm_box(accent, (-2.6, 1.6, 2.52), (0.60, 0.60, 0.06))

    # Overhead arm carrying the tether down to the vehicle.
    lib.bm_cylinder(steel, (-2.6, 1.6, 3.30), 0.13, 1.60, 12, axis="Z")
    lib.bm_bar(steel, (-2.6, 1.6, 4.05), (-0.2, 0.4, 4.05), 0.18, 0.18)
    lib.bm_box(steel, (-0.2, 0.4, 3.85), (0.36, 0.36, 0.44))
    lib.bm_cylinder(accent, (-0.2, 0.4, 3.35), 0.045, 0.60, 8, axis="Z")

    for x, y in ((2.9, 1.9), (2.9, -1.9), (-2.9, -1.9)):
        lib.bm_cylinder(steel, (x, y, 0.45), 0.10, 0.90, 10, axis="Z")
        lib.bm_cylinder(accent, (x, y, 0.92), 0.10, 0.06, 10, axis="Z")

    return finish("PROP_DockStation",
                  [(pad, "concrete"), (steel, "steel_white"),
                   (accent, "accent_cyan"), (screen, "sensor_lens")],
                  materials, bevel=0.02)


# ==========================================================================
# B. Access-network infrastructure
# ==========================================================================


def prop_wifi_mast(materials: dict) -> bpy.types.Object:
    steel, housing, accent = bmesh.new(), bmesh.new(), bmesh.new()

    lib.bm_cylinder(steel, (0, 0, 0.15), 0.55, 0.30, 12, axis="Z")
    lib.bm_cylinder(steel, (0, 0, 3.2), 0.11, 6.1, 12, axis="Z")
    lib.bm_box(steel, (0, 0, 6.2), (1.5, 0.12, 0.12))
    for y_sign, x in ((1, 0.0), (-1, 0.0)):
        lib.bm_box(housing, (x, 0, 5.85), (0.34, 0.20, 0.46))
    for x in (-0.62, 0.62):                                # sector APs on the crossarm
        lib.bm_box(housing, (x, 0, 6.2), (0.16, 0.30, 0.40))
        lib.bm_box(accent, (x, 0.16, 6.2), (0.10, 0.02, 0.24))
    lib.bm_cylinder(housing, (0, 0, 6.55), 0.30, 0.12, 14, axis="Z")
    lib.bm_cylinder(accent, (0, 0, 6.64), 0.10, 0.08, 10, axis="Z")

    return finish("PROP_WifiMast",
                  [(steel, "steel"), (housing, "sensor"), (accent, "accent_cyan")],
                  materials, bevel=0.012)


def prop_cell_tower(materials: dict) -> bpy.types.Object:
    """A tapered lattice mast with three sector panels — the 5G site."""
    steel, panel, accent = bmesh.new(), bmesh.new(), bmesh.new()

    height, base_half, top_half, bays = 24.0, 1.9, 0.62, 10
    lib.bm_box(steel, (0, 0, 0.25), (5.2, 5.2, 0.5))

    def half_at(z: float) -> float:
        return base_half + (top_half - base_half) * (z / height)

    legs = ((1, 1), (1, -1), (-1, 1), (-1, -1))
    for sx, sy in legs:                                    # tapered legs
        for bay in range(bays):
            z0, z1 = height * bay / bays, height * (bay + 1) / bays
            h0, h1 = half_at(z0), half_at(z1)
            lib.bm_bar(steel, (sx * h0, sy * h0, z0), (sx * h1, sy * h1, z1), 0.16, 0.16)

    for bay in range(bays + 1):                            # horizontal rings
        z = height * bay / bays
        h = half_at(z)
        for a, b in (((1, 1), (1, -1)), ((1, -1), (-1, -1)),
                     ((-1, -1), (-1, 1)), ((-1, 1), (1, 1))):
            lib.bm_bar(steel, (a[0] * h, a[1] * h, z), (b[0] * h, b[1] * h, z), 0.10, 0.10)

    for bay in range(bays):                                # diagonal bracing
        z0, z1 = height * bay / bays, height * (bay + 1) / bays
        h0, h1 = half_at(z0), half_at(z1)
        for a, b in (((1, 1), (1, -1)), ((1, -1), (-1, -1)),
                     ((-1, -1), (-1, 1)), ((-1, 1), (1, 1))):
            lib.bm_bar(steel, (a[0] * h0, a[1] * h0, z0), (b[0] * h1, b[1] * h1, z1), 0.07, 0.07)

    lib.bm_box(steel, (0, 0, height + 0.1), (2.6, 2.6, 0.2))          # platform
    for index in range(3):                                            # sector antennas
        angle = math.radians(90 + index * 120)
        cx, cy = 1.15 * math.cos(angle), 1.15 * math.sin(angle)
        lib.bm_bar(steel, (cx * 0.5, cy * 0.5, height + 1.1), (cx, cy, height + 1.1), 0.09, 0.09)
        lib.bm_box(panel, (cx, cy, height + 1.5),
                   (0.22, 0.42, 1.70), rotation=Matrix.Rotation(angle, 4, "Z"))
        lib.bm_box(accent, (cx * 1.14, cy * 1.14, height + 1.5),
                   (0.04, 0.22, 1.20), rotation=Matrix.Rotation(angle, 4, "Z"))
    lib.bm_cylinder(steel, (0, 0, height + 2.4), 0.09, 2.4, 8, axis="Z")
    lib.bm_sphere(accent, (0, 0, height + 3.7), 0.20, 12, 6)          # obstruction light

    return finish("PROP_CellTower",
                  [(steel, "steel"), (panel, "steel_white"), (accent, "accent_violet")],
                  materials, bevel=0.0)


def prop_sat_terminal(materials: dict) -> bpy.types.Object:
    """Ground station: cabinet, pedestal and a tilted parabolic dish."""
    base, steel, accent = bmesh.new(), bmesh.new(), bmesh.new()
    dish = bmesh.new()

    lib.bm_box(base, (0, 0, 0.10), (6.0, 6.0, 0.20))
    lib.bm_box(base, (-2.0, 1.9, 0.85), (1.6, 1.2, 1.30))              # equipment cabinet
    lib.bm_box(accent, (-1.22, 1.9, 1.15), (0.04, 0.60, 0.36))
    lib.bm_cylinder(steel, (0, 0, 0.55), 0.85, 0.70, 16, axis="Z")     # pedestal
    lib.bm_cylinder(steel, (0, 0, 1.70), 0.34, 1.80, 14, axis="Z")
    lib.bm_box(steel, (0, 0, 2.65), (0.90, 1.10, 0.55))                # yoke

    # Parabolic reflector, revolved about Y then tilted to face up-range.
    focal = 1.25
    front = [(r, (r * r) / (4 * focal)) for r in
             (0.14, 0.42, 0.72, 1.02, 1.32, 1.62, 1.86)]
    back = [(r, (r * r) / (4 * focal) + 0.07) for r in
            (1.86, 1.62, 1.32, 1.02, 0.72, 0.42, 0.14)]
    lib.bm_revolve(dish, front + back, segments=40)
    lib.bm_cylinder(dish, (0, -1.05, 0), 0.09, 2.10, 10, axis="Y")     # feed boom
    lib.bm_cone(dish, (0, -2.05, 0), 0.10, 0.20, 0.34, 12, axis="Y")   # feed horn
    # Face the dish up and outboard: -Y opening -> +X, then raise 38 degrees.
    bmesh.ops.rotate(dish, verts=dish.verts[:], cent=(0, 0, 0),
                     matrix=Matrix.Rotation(math.radians(-38), 3, "X"))
    bmesh.ops.rotate(dish, verts=dish.verts[:], cent=(0, 0, 0),
                     matrix=Matrix.Rotation(math.radians(-90), 3, "Z"))
    bmesh.ops.translate(dish, verts=dish.verts[:], vec=(0.0, 0.0, 3.35))

    dish_obj = lib.new_mesh_object("PROP_SatTerminal__dish", dish, materials["steel_white"])
    lib.shade_auto(dish_obj, 40.0)
    body = finish("PROP_SatTerminal__body",
                  [(base, "concrete"), (steel, "steel"), (accent, "accent_violet")],
                  materials, bevel=0.02)
    return lib.join_objects([body, dish_obj], "PROP_SatTerminal")


# ==========================================================================
# C. Site dressing
# ==========================================================================


def prop_container(materials: dict) -> bpy.types.Object:
    shell, trim = bmesh.new(), bmesh.new()
    length, width, height = 6.06, 2.44, 2.59
    lib.bm_box(shell, (0, 0, height / 2), (length, width, height))
    for index in range(13):                                # corrugations
        x = -length / 2 + 0.30 + index * 0.45
        lib.bm_box(shell, (x, 0, height / 2), (0.12, width + 0.06, height - 0.30))
    for sx in (-1, 1):                                     # corner posts
        for sy in (-1, 1):
            lib.bm_box(trim, (sx * (length / 2 - 0.09), sy * (width / 2 - 0.06), height / 2),
                       (0.20, 0.16, height + 0.05))
    lib.bm_box(trim, (0, 0, height + 0.04), (length + 0.04, width + 0.04, 0.12))
    lib.bm_box(trim, (0, 0, 0.06), (length + 0.04, width + 0.04, 0.14))
    return finish("PROP_Container", [(shell, "steel_white"), (trim, "steel")],
                  materials, bevel=0.015)


def prop_light_pole(materials: dict) -> bpy.types.Object:
    steel, lens = bmesh.new(), bmesh.new()
    lib.bm_cylinder(steel, (0, 0, 0.14), 0.36, 0.28, 12, axis="Z")
    lib.bm_cylinder(steel, (0, 0, 4.3), 0.10, 8.3, 10, axis="Z")
    lib.bm_bar(steel, (0, 0, 8.35), (1.5, 0, 8.55), 0.11, 0.11)
    lib.bm_box(steel, (1.75, 0, 8.52), (0.80, 0.34, 0.14))
    lib.bm_box(lens, (1.75, 0, 8.43), (0.68, 0.28, 0.05))
    return finish("PROP_LightPole", [(steel, "steel_white"), (lens, "light_front")],
                  materials, bevel=0.012)


def prop_barrier(materials: dict) -> bpy.types.Object:
    """Jersey barrier — a real profile, extruded. Instanced along service roads."""
    body, stripe = bmesh.new(), bmesh.new()
    profile = [
        (-0.30, 0.0), (0.30, 0.0), (0.22, 0.14), (0.12, 0.55),
        (0.10, 0.92), (-0.10, 0.92), (-0.12, 0.55), (-0.22, 0.14),
    ]
    # The profile is drawn in X-Z; extrude along Y to make a 3 m section.
    lib.bm_prism(body, profile, -1.5, 1.5)
    lib.bm_box(stripe, (0, 0, 0.74), (0.23, 2.4, 0.14))
    for mesh in (body, stripe):   # extruded along Y; turn it to run along +X
        bmesh.ops.rotate(mesh, verts=mesh.verts[:], cent=(0, 0, 0),
                         matrix=Matrix.Rotation(math.radians(90), 3, "Z"))
    return finish("PROP_Barrier", [(body, "concrete"), (stripe, "accent_matte")],
                  materials, bevel=0.015)


def prop_road_sign(materials: dict) -> bpy.types.Object:
    steel, face = bmesh.new(), bmesh.new()
    lib.bm_cylinder(steel, (0, 0, 1.3), 0.06, 2.6, 8, axis="Z")
    lib.bm_box(face, (0, 0, 2.5), (0.06, 1.30, 0.80))
    lib.bm_box(steel, (0, 0, 2.5), (0.03, 1.38, 0.88))
    return finish("PROP_RoadSign", [(steel, "steel"), (face, "steel_white")],
                  materials, bevel=0.01)


def prop_rock(materials: dict, name: str, seed: int, radius: float) -> bpy.types.Object:
    """A deterministic faceted boulder. Seeded so the world is reproducible."""
    import random

    rng = random.Random(seed)
    bm = bmesh.new()
    lib.bm_sphere(bm, (0, 0, 0), radius, 10, 6, scale=(1.0, 0.85, 0.62))
    for vert in bm.verts:
        jitter = Vector((rng.uniform(-0.22, 0.22), rng.uniform(-0.22, 0.22),
                         rng.uniform(-0.16, 0.16))) * radius
        vert.co += jitter
        vert.co.z = max(vert.co.z, -radius * 0.05)
    bmesh.ops.translate(bm, verts=bm.verts[:], vec=(0.0, 0.0, radius * 0.42))
    obj = lib.new_mesh_object(name, bm, materials["sand"])
    lib.shade_auto(obj, 46.0)
    return obj


# ==========================================================================
# Main
# ==========================================================================


def main() -> None:
    lib.banner("CONTINUA — building world props")
    lib.reset_scene("CONTINUA_Props")
    materials = lib.continua_materials()

    props = [
        prop_facility_main(materials),
        prop_facility_hangar(materials),
        prop_dock_station(materials),
        prop_wifi_mast(materials),
        prop_cell_tower(materials),
        prop_sat_terminal(materials),
        prop_container(materials),
        prop_light_pole(materials),
        prop_barrier(materials),
        prop_road_sign(materials),
        prop_rock(materials, "PROP_Rock_A", 1101, 1.7),
        prop_rock(materials, "PROP_Rock_B", 2202, 1.05),
        prop_rock(materials, "PROP_Rock_C", 3303, 2.8),
    ]

    print(f"\n  {'prop':<28}{'tris':>10}")
    print(f"  {'-' * 38}")
    total = 0
    for prop in props:
        count = lib.triangle_count([prop])
        total += count
        print(f"  {prop.name:<28}{count:>10,}")
    print(f"  {'-' * 38}")
    print(f"  {'TOTAL':<28}{total:>10,}")

    # Export while every prop is still at the origin: the runtime instances the
    # nodes directly, so a baked-in layout offset would displace every copy.
    lib.export_glb(lib.out_path("apps", "web", "public", "models", "continua_props.glb"), props)

    # Only now spread them on a grid, so the .blend is pleasant to hand-edit.
    for index, prop in enumerate(props):
        prop.location.x = (index % 5) * 44.0
        prop.location.y = (index // 5) * 44.0
    lib.save_blend(lib.out_path("assets", "blender", "continua_props.blend"))


if __name__ == "__main__":
    main()
