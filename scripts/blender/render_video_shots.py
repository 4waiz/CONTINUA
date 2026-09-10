"""
CONTINUA - the opening and closing shots of the demo video.

These are the only frames in the video that are not the running application, so
they are labelled `rendered scene` on the timeline and nothing in them is
presented as a measurement. What they are for is showing the vehicle and the
road the whole project is about, at a quality a browser canvas cannot reach.

Both shots use the project's own rover from `assets/blender/continua_rover.blend`
and the world palette from `packages/scene/src/theme.ts`, so the cut into the
application footage does not read as a change of subject.

    node scripts/run-blender.mjs scripts/blender/render_video_shots.py
    node scripts/run-blender.mjs scripts/blender/render_video_shots.py -- --probe
    node scripts/run-blender.mjs scripts/blender/render_video_shots.py -- --shot outro

`--probe` renders a single frame of each shot so the framing and the per-frame
cost can be checked before committing to 390 of them. `--shot` renders one shot,
which is how an interrupted sequence is resumed without re-rendering the other.

Output: video/renders/intro/0001.png…, video/renders/outro/0001.png…
(git-ignored; the finished MP4 is the artefact, not the frames).
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

RESOLUTION = (1920, 1080)
SAMPLES = 48
FPS = 30

#: Straight from packages/scene/src/theme.ts, so the Blender frames and the
#: WebGL frames are the same world.
PALETTE = {
    "sky": "#EAF1FC",
    "ground_far": "#CFC0A4",
    "ground_high": "#E3D9C6",
    "road": "#7F8CA3",
    "road_edge": "#B4BFD1",
    "road_centre": "#DFE6F1",
}

ROAD_LENGTH = 260.0
ROAD_WIDTH = 7.4
SHOULDER = 1.9


# ---------------------------------------------------------------------------
# Camera moves. Each is (position, look-at) at the start and at the end; the
# frames in between are eased with a smoothstep so there is no visible snap at
# either cut.
# ---------------------------------------------------------------------------

SHOTS = {
    # A slow arc from a low three-quarter to a higher one, dollying in. Ends
    # with the rover left of centre so the title has somewhere to sit.
    "intro": {
        "duration_s": 6.5,
        "start": {"position": (11.4, -9.8, 1.55), "target": (0.4, 0.0, 1.15), "lens": 52},
        "end": {"position": (8.1, -7.0, 3.35), "target": (-0.2, 0.0, 1.05), "lens": 58},
    },
    # A rise and pull-back: the vehicle becomes small against the road, which is
    # the note the video should end on.
    "outro": {
        "duration_s": 6.5,
        "start": {"position": (-9.6, -6.4, 2.35), "target": (0.0, 0.0, 1.15), "lens": 62},
        "end": {"position": (-19.5, -13.6, 7.60), "target": (1.5, 0.0, 0.85), "lens": 46},
    },
}


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    direction = target - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def smoothstep(x: float) -> float:
    """Ease in and out, so neither cut begins or ends on a moving camera."""
    x = max(0.0, min(1.0, x))
    return x * x * (3.0 - 2.0 * x)


def lerp3(a, b, t: float) -> Vector:
    return Vector((a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t))


# ---------------------------------------------------------------------------


def build_world() -> None:
    scene = bpy.context.scene

    world = bpy.data.worlds.new("CONTINUA_Video")
    world.use_nodes = True
    background = world.node_tree.nodes["Background"]
    background.inputs["Color"].default_value = lib.srgb(PALETTE["sky"])
    background.inputs["Strength"].default_value = 1.25
    scene.world = world

    # --- terrain: a wide, very slightly warm plane -------------------------
    bm = bmesh.new()
    lib.bm_box(bm, (0.0, 0.0, -0.30), (700.0, 700.0, 0.60))
    ground = lib.new_mesh_object(
        "Video_Ground", bm, lib.pbr("Video_Ground", PALETTE["ground_far"], roughness=0.88)
    )
    ground.location.z = 0.0

    # A second, paler plane a hair above the first, so the horizon lifts the way
    # the WebGL terrain does rather than reading as one flat colour.
    bm = bmesh.new()
    lib.bm_box(bm, (0.0, 0.0, 0.005), (700.0, 700.0, 0.01))
    far = lib.new_mesh_object(
        "Video_Ground_High", bm, lib.pbr("Video_Ground_High", PALETTE["ground_high"], roughness=0.9)
    )
    far.location = (0.0, 0.0, 0.0)
    far.scale = (1.0, 1.0, 1.0)

    # --- road: carriageway, shoulders, centre line -------------------------
    bm = bmesh.new()
    lib.bm_box(bm, (0.0, 0.0, 0.035), (ROAD_LENGTH, ROAD_WIDTH, 0.07))
    lib.new_mesh_object("Video_Road", bm, lib.pbr("Video_Road", PALETTE["road"], roughness=0.72))

    for side in (1, -1):
        bm = bmesh.new()
        lib.bm_box(
            bm,
            (0.0, side * (ROAD_WIDTH / 2 + SHOULDER / 2), 0.030),
            (ROAD_LENGTH, SHOULDER, 0.06),
        )
        lib.new_mesh_object(
            f"Video_Shoulder_{'L' if side > 0 else 'R'}",
            bm,
            lib.pbr("Video_Shoulder", PALETTE["road_edge"], roughness=0.8),
        )

    # Dashes rather than a solid line: it gives the pull-back something to read
    # speed against.
    dash_material = lib.pbr("Video_RoadCentre", PALETTE["road_centre"], roughness=0.55)
    for i in range(-26, 27):
        bm = bmesh.new()
        lib.bm_box(bm, (i * 5.0, 0.0, 0.076), (2.6, 0.18, 0.012))
        lib.new_mesh_object(f"Video_Dash_{i + 26:02d}", bm, dash_material)


def build_lighting() -> None:
    scene = bpy.context.scene

    sun = bpy.data.lights.new("Video_Sun", type="SUN")
    sun.energy = 3.1
    sun.angle = math.radians(2.2)
    sun.color = lib.srgb("#FFF6E8")[:3]
    sun_obj = bpy.data.objects.new("Video_Sun", sun)
    sun_obj.location = (18.0, -22.0, 26.0)
    look_at(sun_obj, Vector((0, 0, 0)))
    scene.collection.objects.link(sun_obj)

    fill = bpy.data.lights.new("Video_Fill", type="AREA")
    fill.energy = 1100
    fill.size = 22.0
    fill.color = lib.srgb("#E2ECFF")[:3]
    fill_obj = bpy.data.objects.new("Video_Fill", fill)
    fill_obj.location = (-14.0, 16.0, 11.0)
    look_at(fill_obj, Vector((0, 0, 1.2)))
    scene.collection.objects.link(fill_obj)

    rim = bpy.data.lights.new("Video_Rim", type="AREA")
    rim.energy = 900
    rim.size = 6.0
    rim.color = lib.srgb("#DCE9FF")[:3]
    rim_obj = bpy.data.objects.new("Video_Rim", rim)
    rim_obj.location = (-11.0, -9.0, 5.2)
    look_at(rim_obj, Vector((-0.4, 0, 1.25)))
    scene.collection.objects.link(rim_obj)


def configure_render() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = RESOLUTION
    scene.render.resolution_percentage = 100
    scene.render.fps = FPS
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    scene.render.image_settings.compression = 70

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

    view = scene.view_settings
    try:
        view.view_transform = "AgX"
        view.look = "AgX - Base Contrast"
    except TypeError:
        view.view_transform = "Standard"
    view.exposure = 0.5
    view.gamma = 1.0


def render_shot(name: str, spec: dict, camera, probe: bool) -> None:
    frames = 1 if probe else int(round(spec["duration_s"] * FPS))
    directory = lib.out_path("video", "renders", name)
    os.makedirs(directory, exist_ok=True)

    start, end = spec["start"], spec["end"]
    print(f"\n  · {name}: {frames} frame(s) at {RESOLUTION[0]}x{RESOLUTION[1]}")

    for frame in range(frames):
        t = smoothstep(frame / max(frames - 1, 1)) if frames > 1 else 0.5
        camera.location = lerp3(start["position"], end["position"], t)
        camera.data.lens = start["lens"] + (end["lens"] - start["lens"]) * t
        look_at(camera, lerp3(start["target"], end["target"], t))

        path = os.path.join(directory, f"{frame + 1:04d}.png")
        bpy.context.scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        if frame % 30 == 0 or frame == frames - 1:
            print(f"    {frame + 1}/{frames}  {os.path.getsize(path) / 1024:.0f} KB")


def main() -> None:
    probe = "--probe" in sys.argv
    only = None
    if "--shot" in sys.argv:
        only = sys.argv[sys.argv.index("--shot") + 1]
        if only not in SHOTS:
            raise SystemExit(f"unknown shot {only!r}; expected one of {', '.join(SHOTS)}")

    blend_path = lib.out_path("assets", "blender", "continua_rover.blend")
    if not os.path.exists(blend_path):
        raise SystemExit(f"missing {blend_path} - run build_vehicle.py first")

    lib.banner("CONTINUA - video opening and closing shots")
    bpy.ops.wm.open_mainfile(filepath=blend_path)

    for obj in [o for o in bpy.data.objects if o.type in {"CAMERA", "LIGHT"}]:
        bpy.data.objects.remove(obj, do_unlink=True)

    build_world()
    build_lighting()
    configure_render()

    camera_data = bpy.data.cameras.new("VideoCamera")
    camera = bpy.data.objects.new("VideoCamera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    for name, spec in SHOTS.items():
        if only and name != only:
            continue
        render_shot(name, spec, camera, probe)

    print("\n  done.")


if __name__ == "__main__":
    main()
