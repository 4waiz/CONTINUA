"""
CONTINUA - world prop library.

Builds every structure that dresses the mission route - the operations campus,
the industrial corridor, the remote ground station and the planting - and
exports them as one glTF whose top-level nodes the runtime instances.

    node scripts/run-blender.mjs scripts/blender/build_props.py

Outputs
    assets/blender/continua_props.blend          editable source, props on a grid
    apps/web/public/models/continua_props.glb    runtime library, props at the origin

Node names are the contract with `packages/scene` (`world/sites.ts` and
`world/layout.ts` look them up by name). The six access-network and site
structures keep the names `world.json` already uses:

    PROP_Facility_Main    the operations centre      (front +X)
    PROP_Facility_Hangar  the service hangar          (door +X)
    PROP_DockStation      the wired dock gantry       (bay authored at (2, -7))
    PROP_WifiMast         a yard Wi-Fi mast
    PROP_CellTower        the 5G macro site
    PROP_SatTerminal      the satellite ground station (dish faces +X)

Every prop carries ambient occlusion baked against a ground plane into a colour
attribute, exported as COLOR_0 (see continua_geo.bake_ao).
"""

from __future__ import annotations

import os
import sys

import bmesh
import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import continua_arch as arch  # noqa: E402
import continua_geo as geo  # noqa: E402
import continua_lib as lib  # noqa: E402
import world_campus  # noqa: E402
import world_industry  # noqa: E402
import world_remote  # noqa: E402

# Props whose names are fixed by world.json / sites.ts.
RENAME = {
    "PROP_HQ": "PROP_Facility_Main",
    "PROP_Hangar": "PROP_Facility_Hangar",
}

# AO reach per prop family, metres. Big buildings want a wide, soft falloff;
# small dressing wants a tight one or it greys out entirely.
AO_DISTANCE = {
    "default": 2.4,
    "PROP_Facility_Main": 3.5, "PROP_Gateway": 3.0, "PROP_Facility_Hangar": 3.5,
    "PROP_ResponseStation": 3.0, "PROP_Warehouse": 3.5, "PROP_Substation": 2.0,
    "PROP_Fence": 0.6, "PROP_Bollard": 0.4, "PROP_Barrier": 0.6, "PROP_RoadSign": 0.6,
    "PROP_Car_A": 1.0, "PROP_Car_B": 1.0, "PROP_Car_C": 1.0, "PROP_Van": 1.0,
    "PROP_Palm": 1.2, "PROP_Ghaf": 1.6, "PROP_Shrub_A": 0.6, "PROP_Shrub_B": 0.6,
    "PROP_Rock_A": 1.0, "PROP_Rock_B": 0.8, "PROP_Rock_C": 1.4,
    "PROP_Skyline_A": 6.0, "PROP_Skyline_B": 6.0, "PROP_Skyline_C": 6.0,
    "PROP_WindTurbine_Rotor": 2.0, "PROP_Pylon": 1.2, "PROP_CellTower": 1.2,
}


def build_library() -> list[bpy.types.Object]:
    materials = arch.world_materials()
    props: list[bpy.types.Object] = []
    props += world_campus.build_all(materials)
    props += world_industry.build_all(materials)
    props += world_remote.build_all(materials)
    for prop in props:
        if prop.name in RENAME:
            new = RENAME[prop.name]
            prop.name = new
            prop.data.name = new
    return props


def bake(props: list[bpy.types.Object], samples: int) -> None:
    ground_bm = bmesh.new()
    lib.bm_box(ground_bm, (0.0, 0.0, -0.05), (400.0, 400.0, 0.1))
    ground = geo.to_object("BAKE_Ground", ground_bm, [])
    for prop in props:
        distance = AO_DISTANCE.get(prop.name, AO_DISTANCE["default"])
        occluders = [] if prop.name == "PROP_WindTurbine_Rotor" else [ground]
        geo.bake_ao([prop], distance=distance, samples=samples, floor=0.36, gamma=0.85,
                    occluders_only_self=True, also_visible=occluders)
    bpy.data.objects.remove(ground, do_unlink=True)


def report(props: list[bpy.types.Object]) -> int:
    print(f"\n  {'prop':<28}{'tris':>10}   size (x, y, z) m")
    print(f"  {'-' * 62}")
    total = 0
    for prop in sorted(props, key=lambda o: o.name):
        count = geo.tri_count(prop)
        total += count
        d = prop.dimensions
        print(f"  {prop.name:<28}{count:>10,}   {d.x:6.1f} {d.y:6.1f} {d.z:6.1f}")
    print(f"  {'-' * 62}")
    print(f"  {'TOTAL':<28}{total:>10,}")
    return total


def export(props: list[bpy.types.Object], path: str) -> None:
    lib.enable_addon("io_scene_gltf2")
    lib.select_only(props)
    valid = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    kwargs = {
        "filepath": path, "export_format": "GLB", "use_selection": True, "export_apply": True,
        "export_yup": True, "export_materials": "EXPORT", "export_normals": True,
        "export_texcoords": False, "export_tangents": False, "export_cameras": False,
        "export_lights": False, "export_extras": True, "export_animations": False,
        "export_vertex_color": "ACTIVE", "export_all_vertex_colors": False,
        # Draco: about a quarter of the size. Quantisation is far below what
        # the eye can see at these scales (14-bit positions: 0.3 mm on the
        # rover, a few mm across a 40 m building).
        "export_draco_mesh_compression_enable": True,
        "export_draco_mesh_compression_level": 7,
        "export_draco_position_quantization": 14,
        "export_draco_normal_quantization": 10,
        "export_draco_color_quantization": 10,
        "export_draco_generic_quantization": 12,
    }
    kwargs = {k: v for k, v in kwargs.items() if k in valid}
    bpy.ops.export_scene.gltf(**kwargs)
    print(f"  · exported {os.path.relpath(path, lib.repo_root())}  "
          f"({os.path.getsize(path) / 1024:.0f} KB)")


def main() -> None:
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    samples = 16 if "--draft" in argv else 64

    lib.banner("CONTINUA - building the world prop library")
    lib.reset_scene("CONTINUA_Props")
    props = build_library()
    if "--no-bake" not in argv:
        bake(props, samples)
    report(props)

    # Export while every prop is still at the origin: the runtime instances the
    # nodes directly, so a baked-in layout offset would displace every copy.
    export(props, lib.out_path("apps", "web", "public", "models", "continua_props.glb"))

    # Only now spread them on a grid, so the .blend is pleasant to hand-edit.
    geo.wire_ao_into_materials(bpy.data.materials)
    x = y = row_depth = 0.0
    for prop in sorted(props, key=lambda o: -o.dimensions.y):
        if x > 260.0:
            x = 0.0
            y += row_depth + 20.0
            row_depth = 0.0
        prop.location.x = x + prop.dimensions.x / 2
        prop.location.y = y + prop.dimensions.y / 2
        x += prop.dimensions.x + 20.0
        row_depth = max(row_depth, prop.dimensions.y)
    lib.save_blend(lib.out_path("assets", "blender", "continua_props.blend"))


if __name__ == "__main__":
    main()
