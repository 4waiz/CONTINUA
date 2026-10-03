"""
CONTINUA - the opening and closing shots of the demo video.

These are the only frames in the video that are not the running application, so
they are labelled `rendered scene` on the timeline and nothing in them is
presented as a measurement. What they are for is showing the vehicle and the
road the whole project is about, at a quality a browser canvas cannot reach.

Both shots use the project's own rover from `assets/blender/continua_rover.blend`,
the planting from `assets/blender/continua_props.blend` (palms, flame trees,
jacarandas, broadleaf trees, flowering bushes - the same leaf-card props the
browser instances) and the island palette from `packages/scene/src/theme.ts`,
so the cut into the application footage does not read as a change of subject.

    node scripts/run-blender.mjs scripts/blender/render_video_shots.py
    node scripts/run-blender.mjs scripts/blender/render_video_shots.py -- --probe
    node scripts/run-blender.mjs scripts/blender/render_video_shots.py -- --shot outro
    node scripts/run-blender.mjs scripts/blender/render_video_shots.py -- --shot intro --from 51

`--probe` renders a single frame of each shot so the framing and the per-frame
cost can be checked before committing to 390 of them. `--shot` renders one shot,
which is how an interrupted sequence is resumed without re-rendering the other;
`--from N` (with `--shot`) starts that shot at frame N, for a sequence cut off
part-way. Each frame is a pure function of its number, so a resumed sequence is
the same as one rendered in a single pass.

Output: video/renders/intro/0001.png…, video/renders/outro/0001.png…
(git-ignored; the finished MP4 is the artefact, not the frames).
"""

from __future__ import annotations

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector, noise

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import continua_lib as lib  # noqa: E402

RESOLUTION = (1920, 1080)
SAMPLES = 48
FPS = 30

#: Straight from packages/scene/src/theme.ts, so the Blender frames and the
#: WebGL frames are the same world: a green coastal island on a clear day.
PALETTE = {
    "sky": "#3F8EDC",
    "sky_horizon": "#D8EAF8",
    "grass": "#7C9A50",
    "grass_lush": "#54763C",
    "grass_dry": "#B9B76C",
    "road": "#4F5664",
    "road_edge": "#B9B3A6",
    "road_line": "#F4F2EC",
    "road_centre": "#F2C14E",
    "hill": "#4F8148",
    "hill_far": "#7FA594",
    # The ranges across the water (theme.ts mountainLush / Shade / Crest / Rock)
    # and the haze they stand in.
    "mountain": "#3D7340",
    "mountain_shade": "#1F4630",
    "mountain_crest": "#7DA35A",
    "mountain_rock": "#7E776B",
    "haze": "#9FBFDB",
    # What the camera sees of the sky: bluer near the horizon than the light
    # the scene is lit by, with fair-weather cumulus.
    "sky_cam_horizon": "#C4DDF4",
    "sky_cam_low": "#86BAEC",
    "sky_cam_mid": "#4A8FDF",
    "sky_cam_high": "#2E6FCB",
    "cloud": "#FFFFFF",
    "cloud_shade": "#C7D4E3",
    "grass_base": "#3B5A28",
    "grass_mid": "#6C9844",
    "grass_tip": "#AFC96E",
}

#: Planting appended from the props library, and where it stands (x along the
#: road, y across it, yaw, scale). The road runs along X through the origin.
PROPS_BLEND = ("assets", "blender", "continua_props.blend")
PLANTING = [
    # None on the near side where the closing shot's camera rises out through
    # the row: it passed 0.7 m from a trunk, which then filled a third of the
    # frame.
    ("PROP_Palm", [(x, side * 9.5, 0.4 * i, 0.95 + 0.06 * (i % 3))
                   for i, x in enumerate(range(-120, 121, 15)) for side in (1, -1)
                   if not (side < 0 and -35 <= x <= 5)]),
    ("PROP_FlameTree", [(-34, 26, 0.3, 1.0), (22, -30, 1.4, 1.1), (61, 34, 2.2, 0.95), (-70, -38, 0.8, 1.05)]),
    ("PROP_Jacaranda", [(-12, 31, 2.0, 1.0), (40, -36, 0.6, 1.05), (-52, 44, 1.1, 0.9)]),
    ("PROP_Ghaf", [(x, y, (x * 0.37) % 6.28, 0.9 + ((x * 7 + y) % 5) * 0.08)
                   for x, y in ((-90, 40), (-80, 52), (-66, 47), (-95, 60), (75, -46), (88, -58), (100, -44),
                                (110, 50), (120, 62), (-20, 70), (5, 78), (30, 72), (-40, -70), (-10, -82),
                                (20, -76), (55, 70), (-110, -52), (130, -70))]),
    ("PROP_FlowerBush_Magenta", [(-26, 14, 0.4, 1.0), (34, -15, 1.0, 1.1)]),
    ("PROP_FlowerBush_Coral", [(8, 15, 2.0, 1.0), (-44, -16, 0.2, 1.0)]),
    ("PROP_FlowerBush_Yellow", [(48, 16, 1.3, 1.0), (-8, -14, 0.9, 0.9)]),
    ("PROP_FlowerBush_White", [(-60, 15, 0.5, 1.0), (66, -16, 2.6, 1.0)]),
    ("PROP_FlowerBed", [(x, side * 7.2, 0.0, 1.0) for x in range(-98, 99, 28) for side in (1, -1)]),
]

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


def _meadow_material() -> bpy.types.Material:
    """Field-scale patchwork of greens with drier patches - the browser's
    meadow, as a procedural Blender material (frames only; nothing exported)."""
    material = bpy.data.materials.new("Video_Meadow")
    material.use_nodes = True
    tree = material.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    coords = tree.nodes.new("ShaderNodeTexCoord")
    broad = tree.nodes.new("ShaderNodeTexNoise")
    broad.inputs["Scale"].default_value = 0.012
    broad.inputs["Detail"].default_value = 4.0
    fine = tree.nodes.new("ShaderNodeTexNoise")
    fine.inputs["Scale"].default_value = 1.6
    fine.inputs["Detail"].default_value = 6.0
    mid = tree.nodes.new("ShaderNodeTexNoise")
    mid.inputs["Scale"].default_value = 0.07
    mid.inputs["Detail"].default_value = 3.0
    tree.links.new(coords.outputs["Object"], broad.inputs["Vector"])
    tree.links.new(coords.outputs["Object"], fine.inputs["Vector"])
    tree.links.new(coords.outputs["Object"], mid.inputs["Vector"])
    # Field-scale patches alone are uniform across the few dozen metres a
    # shot sees; tussock-scale patches under them are what reads as a meadow.
    patches = tree.nodes.new("ShaderNodeMix")
    patches.data_type = "FLOAT"
    patches.inputs["Factor"].default_value = 0.45
    tree.links.new(broad.outputs["Fac"], patches.inputs[2])
    tree.links.new(mid.outputs["Fac"], patches.inputs[3])
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[0].color = lib.srgb(PALETTE["grass_lush"])
    ramp.color_ramp.elements[1].position = 0.68
    ramp.color_ramp.elements[1].color = lib.srgb(PALETTE["grass"])
    dry = ramp.color_ramp.elements.new(0.86)
    dry.color = lib.srgb(PALETTE["grass_dry"])
    tree.links.new(patches.outputs[0], ramp.inputs["Fac"])
    grain = tree.nodes.new("ShaderNodeMix")
    grain.data_type = "RGBA"
    grain.blend_type = "MULTIPLY"
    grain.inputs["Factor"].default_value = 0.45
    tree.links.new(ramp.outputs["Color"], grain.inputs[6])
    tree.links.new(fine.outputs["Color"], grain.inputs[7])
    tree.links.new(grain.outputs[2], bsdf.inputs["Base Color"])
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.25
    tree.links.new(fine.outputs["Fac"], bump.inputs["Height"])
    tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.92
    return material


def _append_props() -> dict:
    """Bring the planting in from the props library, by node name."""
    path = lib.out_path(*PROPS_BLEND)
    names = [name for name, _ in PLANTING]
    with bpy.data.libraries.load(path, link=False) as (source, target):
        target.objects = [name for name in source.objects if name in names]
    library = {}
    for obj in target.objects:
        if obj is not None:
            library[obj.name] = obj
    return library


def _sky_world() -> bpy.types.World:
    """The sky. The scene is lit by the same pale gradient as before; what the
    camera sees is bluer down to the horizon, with fair-weather cumulus. (The
    lit gradient's horizon band reaches 30 degrees up and every shot looks
    below that, so seen directly the sky was nearly white.)"""
    world = bpy.data.worlds.new("CONTINUA_Video")
    world.use_nodes = True
    tree = world.node_tree
    nodes, links = tree.nodes, tree.links
    lit = next(n for n in nodes if n.type == "BACKGROUND")
    output = next(n for n in nodes if n.type == "OUTPUT_WORLD")
    coords = nodes.new("ShaderNodeTexCoord")
    direction = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coords.outputs["Generated"], direction.inputs["Vector"])

    # The light: unchanged, so the rover is lit as it always was.
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.5
    ramp.color_ramp.elements[0].color = lib.srgb(PALETTE["sky_horizon"])
    ramp.color_ramp.elements[1].position = 0.78
    ramp.color_ramp.elements[1].color = lib.srgb(PALETTE["sky"])
    links.new(direction.outputs["Z"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], lit.inputs["Color"])
    lit.inputs["Strength"].default_value = 1.0

    # What the camera sees.
    seen = nodes.new("ShaderNodeValToRGB")
    stops = seen.color_ramp.elements
    stops[0].position = 0.0
    stops[0].color = lib.srgb(PALETTE["sky_cam_horizon"])
    stops[1].position = 0.5
    stops[1].color = lib.srgb(PALETTE["sky_cam_high"])
    low = stops.new(0.07)
    low.color = lib.srgb(PALETTE["sky_cam_low"])
    mid = stops.new(0.22)
    mid.color = lib.srgb(PALETTE["sky_cam_mid"])
    links.new(direction.outputs["Z"], seen.inputs["Fac"])

    # Cumulus on a layer overhead: the view direction projected onto it, so
    # the clouds crowd toward the horizon as real ones do.
    above = nodes.new("ShaderNodeMath")
    above.operation = "MAXIMUM"
    above.inputs[1].default_value = 0.035
    links.new(direction.outputs["Z"], above.inputs[0])
    u = nodes.new("ShaderNodeMath")
    u.operation = "DIVIDE"
    links.new(direction.outputs["X"], u.inputs[0])
    links.new(above.outputs[0], u.inputs[1])
    v = nodes.new("ShaderNodeMath")
    v.operation = "DIVIDE"
    links.new(direction.outputs["Y"], v.inputs[0])
    links.new(above.outputs[0], v.inputs[1])
    layer = nodes.new("ShaderNodeCombineXYZ")
    links.new(u.outputs[0], layer.inputs["X"])
    links.new(v.outputs[0], layer.inputs["Y"])
    puffs = nodes.new("ShaderNodeTexNoise")
    puffs.inputs["Scale"].default_value = 0.55
    puffs.inputs["Detail"].default_value = 6.0
    puffs.inputs["Roughness"].default_value = 0.58
    links.new(layer.outputs["Vector"], puffs.inputs["Vector"])
    cover = nodes.new("ShaderNodeMapRange")
    cover.inputs["From Min"].default_value = 0.47
    cover.inputs["From Max"].default_value = 0.62
    links.new(puffs.outputs["Fac"], cover.inputs["Value"])
    # Thinning into the haze at the horizon.
    horizon = nodes.new("ShaderNodeMapRange")
    horizon.inputs["From Min"].default_value = 0.03
    horizon.inputs["From Max"].default_value = 0.16
    links.new(direction.outputs["Z"], horizon.inputs["Value"])
    amount = nodes.new("ShaderNodeMath")
    amount.operation = "MULTIPLY"
    links.new(cover.outputs["Result"], amount.inputs[0])
    links.new(horizon.outputs["Result"], amount.inputs[1])
    # The blue is dimmer than the light: at full strength it sits in AgX's
    # highlight shoulder, which bleaches blue to grey. The clouds are not
    # dimmed - they are the brightest thing in the sky - and their bases,
    # where the cover thins, are shaded.
    dimmed = nodes.new("ShaderNodeVectorMath")
    dimmed.operation = "SCALE"
    dimmed.inputs["Scale"].default_value = 0.62
    links.new(seen.outputs["Color"], dimmed.inputs[0])
    body = nodes.new("ShaderNodeMapRange")
    body.inputs["From Min"].default_value = 0.55
    body.inputs["From Max"].default_value = 0.72
    links.new(puffs.outputs["Fac"], body.inputs["Value"])
    tone = nodes.new("ShaderNodeMix")
    tone.data_type = "RGBA"
    links.new(body.outputs["Result"], tone.inputs["Factor"])
    tone.inputs[6].default_value = lib.srgb(PALETTE["cloud_shade"])
    tone.inputs[7].default_value = lib.srgb(PALETTE["cloud"])
    cloudy = nodes.new("ShaderNodeMix")
    cloudy.data_type = "RGBA"
    links.new(amount.outputs[0], cloudy.inputs["Factor"])
    links.new(dimmed.outputs[0], cloudy.inputs[6])
    links.new(tone.outputs[2], cloudy.inputs[7])
    sky = nodes.new("ShaderNodeBackground")
    links.new(cloudy.outputs[2], sky.inputs["Color"])
    sky.inputs["Strength"].default_value = 1.0

    path = nodes.new("ShaderNodeLightPath")
    choose = nodes.new("ShaderNodeMixShader")
    links.new(path.outputs["Is Camera Ray"], choose.inputs["Fac"])
    links.new(lit.outputs["Background"], choose.inputs[1])
    links.new(sky.outputs["Background"], choose.inputs[2])
    links.new(choose.outputs["Shader"], output.inputs["Surface"])
    return world


def _mountains() -> None:
    """The island's ranges across the water: forested spurs and valleys under
    a ridged crest, lit by the sun and fading into the haze with distance -
    in place of six scaled spheres."""
    # Far enough that they stand a few degrees above the horizon from a camera
    # a metre and a half off the road: nearer and taller, they filled the sky.
    nx, ny = 420, 60
    x0, x1, y0, y1 = -3600.0, 3600.0, 1600.0, 2700.0
    rows = []
    for j in range(ny + 1):
        y = y0 + (y1 - y0) * j / ny
        t = (y - y0) / (y1 - y0)
        row = []
        for i in range(nx + 1):
            x = x0 + (x1 - x0) * i / nx
            massif = 0.5 + 0.5 * noise.fractal(Vector((x * 0.0009, 3.1, 0.0)), 1.0, 2.0, 3)
            crest_at = 0.32 + 0.12 * noise.noise(Vector((x * 0.0016, 7.7, 0.0)))
            front = min(1.0, t / max(crest_at, 0.05))
            behind = max(0.0, (t - crest_at) / (1.0 - crest_at))
            envelope = smoothstep(front) * (1.0 - 0.45 * smoothstep(behind))
            ridges = noise.ridged_multi_fractal(Vector((x * 0.0022, y * 0.0022, 0.0)), 1.0, 2.0, 4, 1.0, 2.0)
            peak = 55.0 + 75.0 * massif
            row.append(peak * envelope * (0.45 + 0.32 * ridges) - 6.0)
        rows.append(row)

    bm = bmesh.new()
    colour = bm.loops.layers.color.new("Col")
    verts = []
    for j in range(ny + 1):
        y = y0 + (y1 - y0) * j / ny
        verts.append([bm.verts.new((x0 + (x1 - x0) * i / nx, y, rows[j][i])) for i in range(nx + 1)])
    for j in range(ny):
        for i in range(nx):
            bm.faces.new((verts[j][i], verts[j][i + 1], verts[j + 1][i + 1], verts[j + 1][i]))
    bm.normal_update()
    lush = Vector(lib.srgb(PALETTE["mountain"])[:3])
    shade = Vector(lib.srgb(PALETTE["mountain_shade"])[:3])
    crest = Vector(lib.srgb(PALETTE["mountain_crest"])[:3])
    rock = Vector(lib.srgb(PALETTE["mountain_rock"])[:3])
    for face in bm.faces:
        for loop in face.loops:
            vertex = loop.vert
            slope = 1.0 - abs(vertex.normal.z)
            height = max(0.0, vertex.co.z) / 110.0
            patch = 0.5 + 0.5 * noise.noise(Vector((vertex.co.x * 0.01, vertex.co.y * 0.01, 0.0)))
            c = lush * (0.86 + 0.24 * patch)
            # Darker in the valleys and on the faces turned from the sun,
            # lighter toward the crests, rock where it is too steep for forest.
            c = c.lerp(shade, max(0.0, min(0.6, (0.35 - vertex.normal.x * 0.4 - height) * 0.8)))
            c = c.lerp(crest, max(0.0, min(0.4, (height - 0.55) * 0.9)))
            c = c.lerp(rock, max(0.0, min(1.0, (slope - 0.55) * 4.0)))
            loop[colour] = (c.x, c.y, c.z, 1.0)

    material = bpy.data.materials.new("Video_Mountains")
    material.use_nodes = True
    tree = material.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    attribute = tree.nodes.new("ShaderNodeVertexColor")
    attribute.layer_name = "Col"
    camera = tree.nodes.new("ShaderNodeCameraData")
    distance = tree.nodes.new("ShaderNodeMapRange")
    distance.inputs["From Min"].default_value = 1500.0
    distance.inputs["From Max"].default_value = 2800.0
    distance.inputs["To Min"].default_value = 0.12
    distance.inputs["To Max"].default_value = 0.3
    tree.links.new(camera.outputs["View Distance"], distance.inputs["Value"])
    hazed = tree.nodes.new("ShaderNodeMix")
    hazed.data_type = "RGBA"
    tree.links.new(distance.outputs["Result"], hazed.inputs["Factor"])
    tree.links.new(attribute.outputs["Color"], hazed.inputs[6])
    hazed.inputs[7].default_value = lib.srgb(PALETTE["haze"])
    tree.links.new(hazed.outputs[2], bsdf.inputs["Base Color"])
    # The haze is light, not paint: a little of it glows.
    glow = tree.nodes.new("ShaderNodeMath")
    glow.operation = "MULTIPLY"
    glow.inputs[1].default_value = 0.05
    tree.links.new(distance.outputs["Result"], glow.inputs[0])
    bsdf.inputs["Emission Color"].default_value = lib.srgb(PALETTE["haze"])
    tree.links.new(glow.outputs[0], bsdf.inputs["Emission Strength"])
    # Canopy: a fine bump of crowns where it can still be seen.
    crowns = tree.nodes.new("ShaderNodeTexNoise")
    crowns.inputs["Scale"].default_value = 0.04
    crowns.inputs["Detail"].default_value = 3.0
    coords = tree.nodes.new("ShaderNodeTexCoord")
    tree.links.new(coords.outputs["Object"], crowns.inputs["Vector"])
    bump = tree.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.35
    tree.links.new(crowns.outputs["Fac"], bump.inputs["Height"])
    tree.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.95
    obj = lib.new_mesh_object("Video_Mountains", bm, material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def _blade_tuft(name: str, seed: int, blades: int, height: float,
                material: bpy.types.Material) -> bpy.types.Object:
    """A tuft of grass: tapering blades curving out from a common root."""
    rng = random.Random(seed)
    bm = bmesh.new()
    for _ in range(blades):
        angle = rng.uniform(0.0, math.tau)
        lean = rng.uniform(0.12, 0.5)
        tall = height * rng.uniform(0.55, 1.1)
        width = rng.uniform(0.022, 0.04)
        out = Vector((math.cos(angle), math.sin(angle), 0.0))
        across = Vector((-out.y, out.x, 0.0))
        root = out * rng.uniform(0.0, 0.05)
        rows = []
        for k in range(4):
            f = k / 3
            centre = root + out * (lean * tall * f * f) + Vector((0.0, 0.0, tall * f))
            half = width * (1.0 - 0.92 * f) / 2
            rows.append((bm.verts.new(centre - across * half), bm.verts.new(centre + across * half)))
        for (a, b), (c, d) in zip(rows, rows[1:]):
            bm.faces.new((a, b, d, c))
    obj = lib.new_mesh_object(name, bm, material)
    obj.hide_render = True
    obj.hide_viewport = True
    return obj


def _bloom(name: str, colour: str, seed: int, stem: bpy.types.Material) -> bpy.types.Object:
    """A wildflower: a stem and a small open head."""
    rng = random.Random(seed)
    tall = rng.uniform(0.28, 0.42)
    bm = bmesh.new()
    lib.bm_box(bm, (0.0, 0.0, tall / 2), (0.012, 0.012, tall))
    obj = lib.new_mesh_object(name, bm, stem)
    head = bmesh.new()
    lib.bm_sphere(head, (0.0, 0.0, tall), 0.045, 8, 5, scale=(1.0, 1.0, 0.45))
    petals = lib.new_mesh_object(name + "_head", head, lib.pbr(f"Video_Bloom_{colour}", colour, roughness=0.6))
    joined = lib.join_objects([obj, petals], name)
    joined.hide_render = True
    joined.hide_viewport = True
    return joined


def _scatter(name: str, source: bpy.types.Object, area: tuple, density: float, seed: int,
             scale: tuple = (0.75, 1.3)) -> None:
    """Instances of `source` strewn over a rectangle (x0, x1, y0, y1) by a
    geometry-nodes modifier - one object, however many tufts."""
    x0, x1, y0, y1 = area
    bm = bmesh.new()
    corners = [bm.verts.new((x0, y0, 0.0)), bm.verts.new((x1, y0, 0.0)),
               bm.verts.new((x1, y1, 0.0)), bm.verts.new((x0, y1, 0.0))]
    bm.faces.new(corners)
    obj = lib.new_mesh_object(name, bm, None)
    tree = bpy.data.node_groups.new(name, "GeometryNodeTree")
    tree.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nodes, links = tree.nodes, tree.links
    group_in = nodes.new("NodeGroupInput")
    group_out = nodes.new("NodeGroupOutput")
    spread = nodes.new("GeometryNodeDistributePointsOnFaces")
    spread.inputs["Density"].default_value = density
    spread.inputs["Seed"].default_value = seed
    info = nodes.new("GeometryNodeObjectInfo")
    info.inputs["Object"].default_value = source
    info.inputs["As Instance"].default_value = True
    place = nodes.new("GeometryNodeInstanceOnPoints")
    spin = nodes.new("FunctionNodeRandomValue")
    spin.data_type = "FLOAT"
    spin.inputs[2].default_value = 0.0
    spin.inputs[3].default_value = math.tau
    spin.inputs["Seed"].default_value = seed + 1
    euler = nodes.new("ShaderNodeCombineXYZ")
    links.new(spin.outputs[1], euler.inputs["Z"])
    rotation = nodes.new("FunctionNodeEulerToRotation")
    links.new(euler.outputs["Vector"], rotation.inputs["Euler"])
    size = nodes.new("FunctionNodeRandomValue")
    size.data_type = "FLOAT"
    size.inputs[2].default_value = scale[0]
    size.inputs[3].default_value = scale[1]
    size.inputs["Seed"].default_value = seed + 2
    links.new(group_in.outputs[0], spread.inputs["Mesh"])
    links.new(spread.outputs["Points"], place.inputs["Points"])
    links.new(info.outputs["Geometry"], place.inputs["Instance"])
    links.new(rotation.outputs[0], place.inputs["Rotation"])
    links.new(size.outputs[1], place.inputs["Scale"])
    links.new(place.outputs["Instances"], group_out.inputs[0])
    modifier = obj.modifiers.new("Scatter", "NODES")
    modifier.node_group = tree


def _verges() -> None:
    """Grass along both verges, thick by the road and thinning into the
    meadow, with wildflowers through it - the browser's roadside tufts and
    blooms, at a density a canvas cannot afford."""
    grass = bpy.data.materials.new("Video_Grass")
    grass.use_nodes = True
    tree = grass.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    coords = tree.nodes.new("ShaderNodeTexCoord")
    height = tree.nodes.new("ShaderNodeSeparateXYZ")
    tree.links.new(coords.outputs["Object"], height.inputs["Vector"])
    ramp = tree.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.0
    ramp.color_ramp.elements[0].color = lib.srgb(PALETTE["grass_base"])
    ramp.color_ramp.elements[1].position = 0.55
    ramp.color_ramp.elements[1].color = lib.srgb(PALETTE["grass_tip"])
    middle = ramp.color_ramp.elements.new(0.25)
    middle.color = lib.srgb(PALETTE["grass_mid"])
    tree.links.new(height.outputs["Z"], ramp.inputs["Fac"])
    tree.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.62
    stem = lib.pbr("Video_Stem", "#4E7A34", roughness=0.7)

    tufts = [_blade_tuft(f"Video_Tuft_{k}", 40 + k, 9 + 2 * k, 0.42 + 0.08 * k, grass) for k in range(3)]
    blooms = [_bloom(f"Video_Bloom_{k}", colour, 70 + k, stem)
              for k, colour in enumerate(("#D93A8C", "#F2C12E", "#F5F2EA", "#F26A4B", "#9B7ADB"))]
    edge = ROAD_WIDTH / 2 + SHOULDER + 0.15
    for side in (1, -1):
        near = (edge, 13.0) if side > 0 else (-13.0, -edge)
        far = (13.0, 46.0) if side > 0 else (-46.0, -13.0)
        # Thinning out rather than stopping: the pull-back at the end sees this far.
        beyond = (46.0, 100.0) if side > 0 else (-100.0, -46.0)
        whole = (edge, 46.0) if side > 0 else (-46.0, -edge)
        for k, tuft in enumerate(tufts):
            _scatter(f"Video_Verge_{side}_{k}", tuft, (-135.0, 135.0, *near), 6.0, 11 + k + (side > 0) * 7)
            _scatter(f"Video_Field_{side}_{k}", tuft, (-135.0, 135.0, *far), 2.2, 31 + k + (side > 0) * 7)
            _scatter(f"Video_Beyond_{side}_{k}", tuft, (-160.0, 160.0, *beyond), 0.8, 61 + k + (side > 0) * 7)
        for k, bloom in enumerate(blooms):
            _scatter(f"Video_Blooms_{side}_{k}", bloom, (-135.0, 135.0, *whole), 0.12,
                     51 + k + (side > 0) * 7, (0.8, 1.2))


def build_world() -> None:
    scene = bpy.context.scene

    scene.world = _sky_world()

    # --- terrain: the island's meadow ----------------------------------------
    bm = bmesh.new()
    # Out to the foot of the far ranges, so there is no edge to see.
    lib.bm_box(bm, (0.0, 0.0, -0.30), (8000.0, 8000.0, 0.60))
    lib.new_mesh_object("Video_Ground", bm, _meadow_material())

    # --- the ranges across the water ------------------------------------------
    _mountains()

    # --- road: asphalt, white edge lines, a dashed yellow centre line --------
    bm = bmesh.new()
    lib.bm_box(bm, (0.0, 0.0, 0.035), (ROAD_LENGTH, ROAD_WIDTH, 0.07))
    lib.new_mesh_object("Video_Road", bm, lib.pbr("Video_Road", PALETTE["road"], roughness=0.85))

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
            lib.pbr("Video_Shoulder", PALETTE["road_edge"], roughness=0.85),
        )
        bm = bmesh.new()
        lib.bm_box(bm, (0.0, side * (ROAD_WIDTH / 2 - 0.35), 0.073), (ROAD_LENGTH, 0.16, 0.008))
        lib.new_mesh_object(f"Video_Edge_{'L' if side > 0 else 'R'}", bm,
                            lib.pbr("Video_RoadLine", PALETTE["road_line"], roughness=0.6))

    # Dashes rather than a solid line: it gives the pull-back something to read
    # speed against.
    dash_material = lib.pbr("Video_RoadCentre", PALETTE["road_centre"], roughness=0.55)
    for i in range(-26, 27):
        bm = bmesh.new()
        lib.bm_box(bm, (i * 5.0, 0.0, 0.076), (2.6, 0.16, 0.012))
        lib.new_mesh_object(f"Video_Dash_{i + 26:02d}", bm, dash_material)

    # --- planting: the props library's leaf-card trees, palms and flowers ----
    library = _append_props()
    for name, placements in PLANTING:
        source = library.get(name)
        if source is None:
            print(f"  ! {name} not found in the props library")
            continue
        for index, (x, y, yaw, scale) in enumerate(placements):
            copy = bpy.data.objects.new(f"{name}_v{index:02d}", source.data)
            copy.location = (x, y, 0.0)
            copy.rotation_euler = (0.0, 0.0, yaw)
            copy.scale = (scale, scale, scale)
            scene.collection.objects.link(copy)

    # --- grass and wildflowers along the verges ------------------------------
    _verges()


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


def render_shot(name: str, spec: dict, camera, probe: bool, first: int = 1) -> None:
    frames = 1 if probe else int(round(spec["duration_s"] * FPS))
    directory = lib.out_path("video", "renders", name)
    os.makedirs(directory, exist_ok=True)

    start, end = spec["start"], spec["end"]
    resumed = f", from frame {first}" if first > 1 else ""
    print(f"\n  · {name}: {frames} frame(s) at {RESOLUTION[0]}x{RESOLUTION[1]}{resumed}")

    for frame in range(first - 1, frames):
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
    first = 1
    if "--from" in sys.argv:
        if not only:
            raise SystemExit("--from resumes one shot: name it with --shot")
        first = int(sys.argv[sys.argv.index("--from") + 1])

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
    # Out to the far ranges; the default far plane cut them off.
    camera_data.clip_start = 0.1
    camera_data.clip_end = 12000.0
    camera = bpy.data.objects.new("VideoCamera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera

    for name, spec in SHOTS.items():
        if only and name != only:
            continue
        render_shot(name, spec, camera, probe, first)

    print("\n  done.")


if __name__ == "__main__":
    main()
