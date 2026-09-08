"""
CONTINUA — preview renders.

Opens `assets/blender/continua_rover.blend`, builds a light studio that matches
the CONTINUA design language (pale ground, soft daylight, no bloom) and renders
front / side / rear / three-quarter views.

    node scripts/run-blender.mjs scripts/blender/render_previews.py

Outputs to assets/previews/.
"""

from __future__ import annotations

import math
import os
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import continua_lib as lib  # noqa: E402

RESOLUTION = (1400, 1000)
SAMPLES = 96

VIEWS = {
    # name:        (camera position,           look-at target,      lens mm)
    "front":       ((9.20, 0.00, 2.05), (0.10, 0.00, 1.05), 85),
    "side":        ((0.10, 11.50, 2.10), (0.10, 0.00, 1.08), 90),
    "rear":        ((-9.40, 0.00, 2.15), (-0.10, 0.00, 1.05), 85),
    "threequarter": ((6.60, 6.10, 3.20), (-0.15, 0.00, 1.02), 78),
    "detail_front": ((4.30, 2.55, 1.35), (1.20, 0.00, 1.00), 105),
    "detail_wheel": ((3.05, 2.35, 1.05), (1.42, 0.55, 0.42), 110),
}


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    direction = target - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def build_studio() -> None:
    scene = bpy.context.scene

    # --- pale, even world light ---
    world = bpy.data.worlds.new("CONTINUA_Studio")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = lib.srgb("#EAF1FC")
    background.inputs["Strength"].default_value = 1.35
    scene.world = world

    # --- ground: large, very pale, catches a soft contact shadow ---
    bm = bmesh.new()
    lib.bm_box(bm, (0.0, 0.0, -0.05), (120.0, 120.0, 0.10))
    ground_material = lib.pbr("CONTINUA_Studio_Ground", "#F4F7FD", roughness=0.62)
    ground = lib.new_mesh_object("Studio_Ground", bm, ground_material)
    ground.location.z = 0.0

    # --- three-point daylight ---
    key = bpy.data.lights.new("Key", type="AREA")
    key.energy = 2400
    key.size = 7.0
    key.color = lib.srgb("#FFFAF2")[:3]
    key_obj = bpy.data.objects.new("Key", key)
    key_obj.location = (6.0, 7.0, 8.5)
    look_at(key_obj, Vector((0, 0, 1.0)))
    scene.collection.objects.link(key_obj)

    fill = bpy.data.lights.new("Fill", type="AREA")
    fill.energy = 900
    fill.size = 10.0
    fill.color = lib.srgb("#E4EEFF")[:3]
    fill_obj = bpy.data.objects.new("Fill", fill)
    fill_obj.location = (-5.0, -8.0, 5.0)
    look_at(fill_obj, Vector((0, 0, 1.1)))
    scene.collection.objects.link(fill_obj)

    rim = bpy.data.lights.new("Rim", type="AREA")
    rim.energy = 1400
    rim.size = 4.0
    rim.color = lib.srgb("#DCE9FF")[:3]
    rim_obj = bpy.data.objects.new("Rim", rim)
    rim_obj.location = (-7.0, 5.5, 4.5)
    look_at(rim_obj, Vector((-0.5, 0, 1.2)))
    scene.collection.objects.link(rim_obj)

    sun = bpy.data.lights.new("Sun", type="SUN")
    sun.energy = 2.4
    sun.angle = math.radians(3.0)
    sun_obj = bpy.data.objects.new("Sun", sun)
    sun_obj.location = (4.0, 4.0, 10.0)
    look_at(sun_obj, Vector((0, 0, 0)))
    scene.collection.objects.link(sun_obj)


def configure_render() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.compression = 88

    eevee = scene.eevee
    for attribute, value in (
        ("taa_render_samples", SAMPLES),
        ("use_raytracing", True),
        ("use_shadows", True),
        ("use_bloom", False),
        ("use_gtao", True),
        ("shadow_ray_count", 2),
        ("shadow_step_count", 6),
    ):
        if hasattr(eevee, attribute):
            setattr(eevee, attribute, value)

    # Restrained, film-like tone mapping — the CONTINUA look is not blown out.
    view = scene.view_settings
    try:
        view.view_transform = "AgX"
        view.look = "AgX - Base Contrast"
    except TypeError:
        view.view_transform = "Standard"
    view.exposure = 0.55
    view.gamma = 1.0


def main() -> None:
    blend_path = lib.out_path("assets", "blender", "continua_rover.blend")
    if not os.path.exists(blend_path):
        raise SystemExit(f"missing {blend_path} — run build_vehicle.py first")

    lib.banner("CONTINUA — preview renders")
    bpy.ops.wm.open_mainfile(filepath=blend_path)

    # Remove any camera/light left in the source file so the studio is definitive.
    for obj in [o for o in bpy.data.objects if o.type in {"CAMERA", "LIGHT"}]:
        bpy.data.objects.remove(obj, do_unlink=True)

    build_studio()
    configure_render()

    camera_data = bpy.data.cameras.new("PreviewCamera")
    camera = bpy.data.objects.new("PreviewCamera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    for name, (position, target, lens) in VIEWS.items():
        camera.location = Vector(position)
        camera_data.lens = lens
        look_at(camera, Vector(target))
        output = lib.out_path("assets", "previews", f"rover_{name}.png")
        bpy.context.scene.render.filepath = output
        print(f"  · rendering {name} -> {os.path.relpath(output, lib.repo_root())}")
        bpy.ops.render.render(write_still=True)
        print(f"    {os.path.getsize(output) / 1024:.0f} KB")

    print("\n  done.")


if __name__ == "__main__":
    main()
