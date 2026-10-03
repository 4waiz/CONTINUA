"""
CONTINUA - rover generation, Mk2.

Builds `CONTINUA Rover Mk2`, a purpose-built emergency-response / inspection
vehicle, from scratch and exports it for the browser runtime.

    node scripts/run-blender.mjs scripts/blender/build_vehicle.py

Outputs
    assets/blender/continua_rover.blend             editable source (hero detail)
    apps/web/public/models/continua_rover.glb       runtime hero model
    apps/web/public/models/continua_rover_lod1.glb  low-detail variant

What changed from Mk1
    Mk1 was assembled from boxes with a bevel on top, which is why it read as
    a stack of primitives. Mk2's body is ONE lofted surface: ~100 cross-sections
    from tail to nose, each a filleted profile with the same vertex count, so
    the shoulder line, wheel arches, tumblehome, windscreen rake and the
    rounded nose are continuous. Glass, pillars, door shut lines, the graphite
    cladding and the blue pinstripe are painted onto that one surface by
    region, the way a real vehicle's livery and glazing sit on one shell.

    Every mesh carries ambient occlusion baked by Cycles into a colour
    attribute, exported as glTF COLOR_0. The browser multiplies it into base
    colour - contact shading in the wheel wells, under the bumpers and between
    the roof sensors, with no texture download and no post-processing pass.

Orientation contract (see docs/ASSET_MANIFEST.md)
    Blender: forward +X, left +Y, up +Z, root at the tyre contact plane z = 0.
    glTF:    forward +X, up +Y; wheel spin = local Z, steering = local Y.
    Wheelbase 2.85 m, track 1.69 m and tyre radius 0.405 m are unchanged from
    Mk1 - the preview source, the engine (`world.json`) and the rig test all
    depend on them.
"""

from __future__ import annotations

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import continua_geo as geo  # noqa: E402
import continua_lib as lib  # noqa: E402

# ==========================================================================
# Dimensions - metres, all in one place
# ==========================================================================

WHEELBASE = 2.85
AXLE_F = WHEELBASE / 2.0           # +1.425
AXLE_R = -WHEELBASE / 2.0          # -1.425
TRACK_Y = 0.845                    # wheel centre, half-track
WHEEL_R = 0.405                    # tyre outer radius -> ride height
TYRE_HALF_W = 0.165

W_BODY = 0.962                     # body side half-width at the shoulder
W_WELL = 0.600                     # inner wall of the wheel wells
ROCKER_Z = 0.505                   # sill line between the arches
FLOOR_Z = 0.455                    # underside
ARCH_R = 0.525                     # body cut-out around each wheel
ARCH_DX = math.sqrt(ARCH_R ** 2 - (ROCKER_Z - WHEEL_R) ** 2)

NOSE_X = 2.205
TAIL_X = -2.215
R_NOSE = 0.135                     # plan-view corner radius at the nose
R_TAIL = 0.105

X_WS0 = 0.905                      # windscreen base (cowl)
X_WS1 = 0.430                      # windscreen top (roof header)
W_ROOF = 0.842                     # roof edge half-width (tumblehome)
LEDGE = 0.042                      # beltline ledge: glass sits this far inboard
Z_CLAD = 0.735                     # graphite cladding below this line
STRIPE = 0.022                     # CONTINUA-blue pinstripe above the cladding

GAP_HALF = 0.0045                  # door shut-line half width
GAPS = (0.885, -0.300, -1.405)     # front door leading edge, B-pillar, C-pillar
PILLARS = ((-0.355, -0.245), (-1.520, -1.385), (-2.215, -2.055))   # B, C, D (x ranges)

M_PAINT, M_CLAD, M_TRIM, M_GLASS, M_UNDER, M_BLUE, M_ROOF = range(7)


def lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def smoothstep(e0: float, e1: float, x: float) -> float:
    t = clamp((x - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# ==========================================================================
# The body surface: analytic lines the loft follows
# ==========================================================================


def side_bottom_z(x: float) -> float:
    """Bottom edge of the body side: the sill, rising over each wheel."""
    for axle in (AXLE_F, AXLE_R):
        dx = x - axle
        if abs(dx) < ARCH_DX:
            return WHEEL_R + math.sqrt(ARCH_R ** 2 - dx * dx)
    return ROCKER_Z


def belt_z(x: float) -> float:
    """Shoulder line. Bonnet falls gently to the nose; the cabin rises a touch
    toward the tail, which keeps the side from reading as a flat box."""
    if x >= X_WS0:
        t = (x - X_WS0) / (NOSE_X - X_WS0)
        return 1.292 - 0.118 * t * t - 0.022 * t
    t = (X_WS0 - x) / (X_WS0 - TAIL_X)
    return 1.292 + 0.026 * t


def roof_edge_z(x: float) -> float:
    t = clamp((X_WS1 - x) / (X_WS1 - TAIL_X), 0.0, 1.0)
    return 1.884 - 0.018 * t


def end_rounding(x: float) -> tuple[float, float, float]:
    """(shrink of every width, drop of the top, rise of the floor) near the ends."""
    s_front = x - (NOSE_X - R_NOSE)
    if s_front > 0.0:
        s = min(s_front, R_NOSE)
        shrink = R_NOSE - math.sqrt(max(0.0, R_NOSE ** 2 - s * s))
        return shrink, shrink * 0.45, shrink * 0.55
    s_rear = (TAIL_X + R_TAIL) - x
    if s_rear > 0.0:
        s = min(s_rear, R_TAIL)
        shrink = R_TAIL - math.sqrt(max(0.0, R_TAIL ** 2 - s * s))
        return shrink, shrink * 0.7, shrink * 0.5
    return 0.0, 0.0, 0.0


def top_surface(x: float) -> tuple[float, float, float, str]:
    """(edge z, centre z, edge half-width, region) of the upper surface."""
    zb = belt_z(x)
    wg = W_BODY - LEDGE
    if x >= X_WS0:
        return zb + 0.034, zb + 0.058, wg - 0.030, "bonnet"
    if x >= X_WS1:
        t = (X_WS0 - x) / (X_WS0 - X_WS1)
        bow = 0.030 * math.sin(math.pi * t)
        z_edge = lerp(zb + 0.034, roof_edge_z(X_WS1), t) + bow
        w_edge = lerp(wg - 0.030, W_ROOF, smoothstep(0.0, 0.35, t))
        crown = lerp(0.024, 0.030, t)
        return z_edge, z_edge + crown, w_edge, "windscreen"
    z_edge = roof_edge_z(x)
    return z_edge, z_edge + 0.030, W_ROOF, "roof"


def section(x: float, detail: str):
    """Half cross-section (y >= 0) at station x, top centre round to bottom centre."""
    hero = detail == "hero"
    shrink, drop, rise = end_rounding(x)
    zb = belt_z(x) - drop * 0.35
    z_edge, z_centre, w_edge, region = top_surface(x)
    z_edge -= drop
    z_centre -= drop
    zsb = side_bottom_z(x)
    floor = FLOOR_Z + rise
    zsb = max(zsb, floor + 0.035)

    w_b = W_BODY - shrink
    w_g = W_BODY - LEDGE - shrink
    w_e = w_edge - shrink
    w_well = W_WELL - shrink

    z_clad = max(Z_CLAD, zsb + 0.040)
    z_stripe = z_clad + STRIPE
    if z_stripe > zb - 0.16:
        z_stripe = zb - 0.16
        z_clad = min(z_clad, z_stripe - 0.004)
    # The door crease: a soft horizontal highlight line, the widest point of
    # the body side, so the doors are not one flat white slab.
    z_crease = clamp(1.005, z_stripe + 0.07, zb - 0.075)

    sub = (lambda h, l: h if hero else l)
    top_fracs = [0.2, 0.4, 0.6, 0.8, 0.94] if hero else [0.33, 0.66, 0.93]
    side_fracs = [0.07, 0.30, 0.55, 0.80, 0.93] if hero else [0.08, 0.5, 0.92]
    keys = [
        {"p": (0.0, z_centre), "fracs": top_fracs,
         "bow": (z_centre - z_edge) / 4.0},                                          # 0 top
        {"p": (w_e, z_edge), "r": 0.095, "seg": sub(5, 3), "fracs": side_fracs},     # 1 roof edge
        {"p": (w_g, zb + 0.026), "r": 0.010, "seg": 1, "sub": 1},                    # 2 ledge
        {"p": (w_b, zb), "r": 0.024, "seg": sub(3, 2), "sub": sub(3, 1)},            # 3 shoulder
        {"p": (w_b + 0.022, z_crease), "r": 0.22, "seg": sub(2, 1), "sub": sub(3, 1)},  # 4 crease
        {"p": (w_b + 0.010, z_stripe), "r": 0.0, "seg": 0, "sub": 1},                # 5 stripe
        {"p": (w_b + 0.011, z_clad), "r": 0.0, "seg": 0, "sub": sub(2, 1)},          # 6 cladding
        {"p": (w_b - 0.010, zsb), "r": 0.042, "seg": sub(3, 2), "sub": 2},           # 7 sill / arch
        {"p": (w_well, zsb), "r": 0.0, "seg": 0, "sub": 1},                          # 8 well
        {"p": (w_well, floor), "r": 0.0, "seg": 0, "sub": sub(3, 2)},                # 9 floor edge
        {"p": (0.0, floor)},                                                         # 10 floor
    ]
    return geo.profile(keys, labels=True)


def stations(detail: str) -> list[float]:
    hero = detail == "hero"
    xs: list[float] = []
    n_round = 7 if hero else 4
    for i in range(n_round + 1):
        a = (math.pi / 2.0) * i / n_round
        xs.append(NOSE_X - R_NOSE + R_NOSE * math.sin(a))
        xs.append(TAIL_X + R_TAIL - R_TAIL * math.sin(a))
    n_arch = 22 if hero else 12
    phi0 = math.acos(ARCH_DX / ARCH_R)
    for axle in (AXLE_F, AXLE_R):
        for i in range(n_arch + 1):
            phi = phi0 + (math.pi - 2.0 * phi0) * i / n_arch
            xs.append(axle + ARCH_R * math.cos(phi))
        xs.append(axle + ARCH_DX + 0.012)
        xs.append(axle - ARCH_DX - 0.012)
    n_ws = 8 if hero else 4
    for i in range(n_ws + 1):
        xs.append(X_WS1 + (X_WS0 - X_WS1) * i / n_ws)
    xs += [X_WS0 + 0.03, X_WS0 - 0.030, X_WS1 + 0.035]
    if hero:
        for gap in GAPS:
            xs += [gap - GAP_HALF, gap + GAP_HALF]
    for a, b in PILLARS:
        xs += [a, b]
    xs = sorted(x for x in xs if TAIL_X - 1e-9 <= x <= NOSE_X + 1e-9)
    # Fill long spans so the surface stays smooth under the AO bake.
    max_span = 0.14 if hero else 0.28
    filled: list[float] = []
    for x in xs:
        if filled and x - filled[-1] > max_span:
            steps = int(math.ceil((x - filled[-1]) / max_span))
            start = filled[-1]
            for s in range(1, steps):
                filled.append(start + (x - start) * s / steps)
        filled.append(x)
    out: list[float] = []
    for x in filled:
        if not out or x - out[-1] > 0.0025:
            out.append(x)
    out[0], out[-1] = TAIL_X, NOSE_X
    return out


def classify(x: float, label: tuple) -> int:
    """Material for one face of the body loft, from its station x and the
    band it lies in. Bands come from `section()`'s key points, so a window
    frame is exactly one band wide on every station."""
    kind, key, interval, count = label
    _ze, _zc, _we, region = top_surface(x)
    in_gap = any(abs(x - gap) < GAP_HALF + 1e-4 for gap in GAPS)
    if key >= 7 and not (kind == "arc" and key == 7):
        return M_UNDER                                    # well ceiling, well wall, floor
    if (kind == "arc" and key == 7) or (kind == "span" and key == 6):
        return M_TRIM if in_gap else M_CLAD
    if kind == "span" and key == 5:
        return M_TRIM if in_gap else M_BLUE
    if key in (3, 4):
        return M_TRIM if in_gap and kind == "span" else M_PAINT
    if key == 2:                                          # ledge and its fillet
        return M_PAINT if region == "bonnet" else M_TRIM
    if kind == "span" and key == 1:                       # the glasshouse side
        if region == "bonnet":
            return M_PAINT
        if interval == 0 or interval == count - 1:
            return M_TRIM                                 # frame top and seal
        if region == "windscreen":
            return M_GLASS if x < X_WS0 - 0.05 else M_TRIM
        for index, (a, b) in enumerate(PILLARS):
            if a - 1e-4 <= x <= b + 1e-4:
                return M_PAINT if index == 2 else M_TRIM
        return M_GLASS
    if kind == "arc" and key == 1:                        # roof edge / A-pillar
        if region == "windscreen":
            return M_TRIM
        return M_ROOF if region == "roof" else M_PAINT
    # key 0 span: bonnet, windscreen or roof
    if region == "windscreen":
        if interval == count - 1 or x < X_WS1 + 0.035 or x > X_WS0 - 0.030:
            return M_TRIM
        return M_GLASS
    if region == "bonnet" and x < X_WS0 + 0.030:
        return M_TRIM                                     # scuttle panel at the cowl
    if region == "roof":
        return M_ROOF                                     # the floating roof
    return M_PAINT


def build_body(mats: dict, detail: str) -> bpy.types.Object:
    rings = []
    xs = stations(detail)
    labels = None
    for x in xs:
        half, half_labels = section(x, detail)
        labels = labels or half_labels
        full = geo.mirror_ring(half)
        rings.append([(x, y, z) for (y, z) in full])
    bm = bmesh.new()
    _grid, faces, caps = geo.loft(bm, rings, closed=True, cap_start=True, cap_end=True)
    half_points = len(labels) + 1
    ring_size = len(rings[0])
    for i, row in enumerate(faces):
        x_mid = 0.5 * (xs[i] + xs[i + 1])
        for j, face in enumerate(row):
            if face is None:
                continue
            # Map the ring segment back onto the half profile it mirrors.
            hf = j if j < half_points - 1 else ring_size - 1 - j
            face.material_index = classify(x_mid, labels[hf])
    for cap in caps:
        cap.material_index = M_PAINT
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    obj = geo.to_object("CONTINUA_BodyShell", bm,
                        [mats["paint"], mats["clad"], mats["trim"], mats["glass"],
                         mats["under"], mats["accent_blue"], mats["roof"]], recalc=False)
    geo.smooth(obj, 50.0)
    return obj


# ==========================================================================
# Panels and trim that sit on the shell
# ==========================================================================


def build_flares(mats: dict, detail: str) -> bpy.types.Object:
    """Fender flares swept round each arch: a soft rounded band that stands
    proud of the body and covers the tyre's shoulder."""
    hero = detail == "hero"
    bm = bmesh.new()
    section2d = geo.rounded_rect(0.115, 0.115, 0.035, segments=3 if hero else 2)
    steps = 26 if hero else 14
    for axle in (AXLE_F, AXLE_R):
        for side in (-1, 1):
            path = []
            a0, a1 = math.radians(8.0), math.radians(172.0)
            for i in range(steps + 1):
                a = a0 + (a1 - a0) * i / steps
                r = ARCH_R + 0.050
                x = axle + r * math.cos(a)
                z = WHEEL_R + r * math.sin(a)
                # The flare sits on the body side and leans out over the tyre.
                y = side * (W_BODY + 0.034)
                path.append((x, y, z))
            # Frame normal points out of the arch (radially); binormal along Y.
            rings = []
            for i, (px, py, pz) in enumerate(path):
                a = a0 + (a1 - a0) * i / steps
                radial = Vector((math.cos(a), 0.0, math.sin(a)))
                lateral = Vector((0.0, side, 0.0))
                origin = Vector((px, py, pz))
                ring = [origin + radial * u + lateral * (v * 0.85 + 0.010) for (u, v) in section2d]
                rings.append(ring)
            geo.loft(bm, rings, closed=True, cap_start=True, cap_end=True)
    obj = geo.to_object("CONTINUA_Flares", bm, [mats["clad"]])
    geo.smooth(obj, 55.0)
    return obj


def build_bumpers(mats: dict, detail: str) -> list[bpy.types.Object]:
    hero = detail == "hero"
    dark = bmesh.new()
    steel = bmesh.new()
    # Front bumper: a lofted bar with a rounded section, wrapping the corners.
    def bumper(x_face: float, depth: float, z0: float, z1: float, half_w: float, wrap: float,
               sign: float) -> None:
        sec = geo.rounded_rect(depth, z1 - z0, 0.05, segments=3 if hero else 2)
        path = []
        n = 18 if hero else 10
        for i in range(n + 1):
            t = -1.0 + 2.0 * i / n
            y = t * half_w
            x = x_face - sign * wrap * (abs(t) ** 4)
            path.append((x, y, (z0 + z1) / 2.0))
        rings = []
        frames = geo.frames_along(path, up_hint=(0.0, 0.0, 1.0))
        for origin, tangent, normal, binormal in frames:
            # normal ~ up, binormal ~ forward/back: depth along binormal, height along normal.
            rings.append([origin + binormal * u + normal * v for (u, v) in sec])
        geo.loft(dark, rings, closed=True, cap_start=True, cap_end=True)

    bumper(2.300, 0.230, 0.520, 0.790, 0.980, 0.160, +1.0)
    bumper(-2.290, 0.230, 0.490, 0.770, 0.975, 0.140, -1.0)
    # Skid plates.
    lib.bm_box(steel, (2.240, 0.0, 0.445), (0.36, 1.30, 0.035))
    lib.bm_box(steel, (-2.240, 0.0, 0.448), (0.30, 1.20, 0.035))
    # Winch fairlead, tow hooks, recovery points.
    lib.bm_box(dark, (2.425, 0.0, 0.580), (0.040, 0.420, 0.110))
    hooks = bmesh.new()
    if hero:
        lib.bm_cylinder(steel, (2.446, 0.0, 0.580), 0.022, 0.30, 12, axis="Y")
        for side in (-1, 1):
            # Recovery hooks: shackle plates painted CONTINUA blue.
            lib.bm_box(hooks, (2.445, side * 0.420, 0.560), (0.080, 0.040, 0.110))
            lib.bm_cylinder(hooks, (2.480, side * 0.420, 0.560), 0.030, 0.050, 12, axis="Y")
            lib.bm_box(hooks, (-2.425, side * 0.640, 0.560), (0.080, 0.040, 0.110))
        # Tow hitch receiver.
        lib.bm_box(steel, (-2.430, 0.0, 0.560), (0.120, 0.090, 0.090))
        lib.bm_box(dark, (-2.380, 0.0, 0.560), (0.080, 0.160, 0.120))
    a = geo.to_object("CONTINUA_Bumpers", dark, [mats["clad"]])
    geo.smooth(a, 50.0)
    b = geo.to_object("CONTINUA_SkidPlates", steel, [mats["alu"]])
    geo.bevel(b, 0.010, 2)
    out = [a, b]
    if hooks.faces:
        c = geo.to_object("CONTINUA_Hooks", hooks, [mats["caliper"]])
        geo.bevel(c, 0.008, 2)
        out.append(c)
    else:
        hooks.free()
    return out


def build_grille_and_lights(mats: dict, detail: str) -> list[bpy.types.Object]:
    """Front graphic: a dark grille panel between round LED headlamps, with a
    single light blade across the top - the CONTINUA face."""
    hero = detail == "hero"
    x_face = NOSE_X
    housing = bmesh.new()   # trim black
    lens = bmesh.new()      # front light (emissive white)
    amber = bmesh.new()
    accent = bmesh.new()

    # One full-width dark face panel carrying both lamps, the grille slats and
    # the light blade - a single graphic instead of parts scattered on paint.
    panel_z, panel_h, panel_w = 0.972, 0.232, 1.600
    sec = geo.rounded_rect(panel_w, panel_h, 0.040, segments=3 if hero else 2)
    rings = [[(x_face - 0.004, u, panel_z + v) for (u, v) in sec],
             [(x_face + 0.022, u, panel_z + v) for (u, v) in sec]]
    geo.loft(housing, rings, closed=True, cap_start=True, cap_end=True)
    slats = (0.918, 0.950, 0.982, 1.014) if hero else (0.935, 1.000)
    for z in slats:
        lib.bm_box(housing, (x_face + 0.030, 0.0, z), (0.016, 1.000, 0.014))
    # Light blade along the panel's top edge, lamp to lamp.
    lib.bm_box(lens, (x_face + 0.026, 0.0, 1.064), (0.010, 1.480, 0.012))
    # CONTINUA-blue tick beneath the wordmark.
    lib.bm_box(accent, (x_face + 0.040, 0.0, 0.896), (0.008, 0.150, 0.007))

    seg = 28 if hero else 16
    for side in (-1, 1):
        y = side * 0.655
        z = panel_z - 0.004
        lib.bm_cylinder(housing, (x_face + 0.024, y, z), 0.112, 0.020, seg, axis="X")   # bezel
        if hero:
            ring = bmesh.new()
            geo.revolve_profile(ring, [(0.086, -0.007), (0.098, -0.007), (0.098, 0.007),
                                       (0.086, 0.007)], 32, center=(0, 0, 0), axis="Y")
            bmesh.ops.rotate(ring, verts=ring.verts[:], cent=(0, 0, 0),
                             matrix=Matrix.Rotation(math.radians(90), 3, "Z"))
            bmesh.ops.translate(ring, verts=ring.verts[:], vec=(x_face + 0.036, y, z))
            ring_mesh = bpy.data.meshes.new("tmp_ring")
            ring.to_mesh(ring_mesh)
            ring.free()
            lens.from_mesh(ring_mesh)
            bpy.data.meshes.remove(ring_mesh)
        lib.bm_cylinder(lens, (x_face + 0.036, y, z), 0.050, 0.016, seg, axis="X")      # projector
        lib.bm_cylinder(housing, (x_face + 0.032, y, z), 0.074, 0.010, seg, axis="X")
        # Indicators at the panel's outer corners.
        lib.bm_box(amber, (x_face + 0.024, side * 0.775, 0.892), (0.012, 0.050, 0.030))
        # Fog lamps in the bumper.
        lib.bm_cylinder(housing, (2.420, side * 0.640, 0.660), 0.052, 0.040, 16, axis="X")
        lib.bm_cylinder(lens, (2.440, side * 0.640, 0.660), 0.041, 0.012, 16, axis="X")

    h = geo.to_object("CONTINUA_LightHousing_Front", housing, [mats["trim"]])
    geo.smooth(h, 40.0)
    l = geo.to_object("CONTINUA_Lights_Front", lens, [mats["light_front"]])
    geo.smooth(l, 40.0)
    a = geo.to_object("CONTINUA_Indicators", amber, [mats["light_amber"]])
    b = geo.to_object("CONTINUA_FrontAccent", accent, [mats["accent_blue"]])
    return [h, l, a, b]


def build_rear(mats: dict, detail: str) -> list[bpy.types.Object]:
    """Tail: rear glass, vertical LED lamps, side-hinged door with a spare wheel
    and a ladder - the face a following camera sees most."""
    hero = detail == "hero"
    x_tail = TAIL_X
    glass = bmesh.new()
    trim = bmesh.new()
    red = bmesh.new()
    amber = bmesh.new()
    white = bmesh.new()
    plate = bmesh.new()

    # Rear window: flush glass with a black surround.
    lib.bm_box(trim, (x_tail - 0.006, 0.0, 1.585), (0.014, 1.320, 0.360))
    lib.bm_box(glass, (x_tail - 0.014, 0.0, 1.590), (0.012, 1.240, 0.300))
    # Door shut lines on the tail: a door that opens to the side.
    lib.bm_box(trim, (x_tail - 0.004, -0.430, 1.050), (0.010, 0.010, 0.800))
    # Vertical LED tail lamps at the corners.
    for side in (-1, 1):
        y = side * 0.800
        lib.bm_box(trim, (x_tail + 0.010, y, 1.080), (0.040, 0.090, 0.520))
        lib.bm_box(red, (x_tail - 0.012, y, 1.150), (0.014, 0.060, 0.320))
        lib.bm_box(amber, (x_tail - 0.012, y, 0.950), (0.014, 0.060, 0.070))
        lib.bm_box(white, (x_tail - 0.012, y, 0.880), (0.014, 0.060, 0.050))
    # High-mounted stop lamp at the roof.
    lib.bm_box(red, (x_tail - 0.016, 0.0, 1.776), (0.012, 0.360, 0.020))
    # Number plate.
    lib.bm_box(plate, (-2.410, 0.0, 0.690), (0.010, 0.520, 0.110))
    # Mud flaps behind the rear wheels, on a bracket under the flare end: the
    # part of the arches a following camera actually sees, and what a vehicle
    # that works off the tarmac carries.
    for side in (-1, 1):
        y = side * TRACK_Y
        x = AXLE_R - WHEEL_R - 0.15
        lib.bm_box(trim, (x, y, 0.335), (0.014, 0.380, 0.330))
        lib.bm_box(trim, (x + 0.025, y, 0.505), (0.060, 0.400, 0.030))

    objs = [
        geo.to_object("CONTINUA_RearGlass", glass, [mats["glass"]]),
        geo.to_object("CONTINUA_RearTrim", trim, [mats["trim"]]),
        geo.to_object("CONTINUA_Lights_Rear", red, [mats["light_rear"]]),
        geo.to_object("CONTINUA_RearAmber", amber, [mats["light_amber"]]),
        geo.to_object("CONTINUA_RearWhite", white, [mats["light_front"]]),
        geo.to_object("CONTINUA_Plates", plate, [mats["plate"]]),
    ]
    for obj in objs:
        geo.smooth(obj, 40.0)

    # Spare wheel on the door, offset to the right as on most side-hinged doors.
    if True:
        spare = build_wheel(mats, "CONTINUA_Spare", detail, spare=True)
        spare.data.transform(Matrix.Rotation(math.radians(90.0), 4, "Z"))
        spare.data.transform(Matrix.Translation((x_tail - 0.205, -0.180, 1.190)))
        objs.append(spare)
    if hero:
        ladder = bmesh.new()
        for side in (0.36, 0.66):
            geo.tube(ladder, [(x_tail - 0.020, side, 0.90), (x_tail - 0.070, side, 0.95),
                              (x_tail - 0.070, side, 1.80), (x_tail - 0.020, side, 1.86)],
                     0.016, 8)
        for z in (1.05, 1.22, 1.39, 1.56, 1.73):
            lib.bm_cylinder(ladder, (x_tail - 0.070, 0.51, z), 0.012, 0.30, 8, axis="Y")
        lad = geo.to_object("CONTINUA_Ladder", ladder, [mats["metal_dark"]])
        geo.smooth(lad, 40.0)
        objs.append(lad)
    return objs


def build_side_details(mats: dict, detail: str) -> list[bpy.types.Object]:
    """Mirrors, flush handles, side steps, wipers and the snorkel."""
    hero = detail == "hero"
    trim = bmesh.new()
    clad = bmesh.new()
    paint = bmesh.new()
    glass = bmesh.new()

    for side in (-1, 1):
        # Mirror: arm, and a lofted housing whose face is painted.
        lib.bm_bar(trim, (0.830, side * 0.905, 1.340), (0.820, side * 1.050, 1.410), 0.045, 0.040)
        sec = geo.rounded_rect(0.240, 0.170, 0.050, segments=3 if hero else 2)
        rings = []
        for x, s in ((0.905, 0.78), (0.880, 0.97), (0.800, 1.0), (0.768, 0.90)):
            rings.append([(x, side * 1.100 + side * u * s, 1.445 + v * s) for (u, v) in sec])
        geo.loft(paint, rings, closed=True, cap_start=True, cap_end=True)
        lib.bm_box(glass, (0.763, side * 1.100, 1.445), (0.010, 0.200, 0.135))
        # Flush door handles.
        for x in (0.160, -1.050):
            lib.bm_box(trim, (x, side * (W_BODY + 0.0125), 1.150), (0.180, 0.012, 0.030))
        # Running board between the arches.
        lib.bm_box(clad, (0.0, side * 1.000, 0.440), (1.660, 0.200, 0.050))
        lib.bm_box(trim, (0.0, side * 1.000, 0.469), (1.580, 0.170, 0.010))
        for x in (-0.60, 0.0, 0.60):
            lib.bm_box(trim, (x, side * 0.880, 0.470), (0.060, 0.120, 0.060))
    # Wipers parked at the cowl.
    if hero:
        for y in (-0.36, 0.30):
            lib.bm_bar(trim, (X_WS0 - 0.050, y - 0.30, belt_z(X_WS0) + 0.060),
                       (X_WS0 - 0.060, y + 0.28, belt_z(X_WS0) + 0.065), 0.016, 0.012)
        # Snorkel: rises up the right-hand A-pillar.
        path = [(1.120, -0.985, 1.120), (0.990, -0.990, 1.270), (0.900, -0.962, 1.370),
                (0.660, -0.912, 1.650), (0.500, -0.890, 1.840)]
        geo.tube(clad, path, 0.046, 12)
        lib.bm_box(clad, (0.478, -0.888, 1.880), (0.140, 0.100, 0.080))

    objs = [
        geo.to_object("CONTINUA_SideTrim", trim, [mats["trim"]]),
        geo.to_object("CONTINUA_SideClad", clad, [mats["clad"]]),
        geo.to_object("CONTINUA_Mirrors", paint, [mats["trim"]]),
        geo.to_object("CONTINUA_MirrorGlass", glass, [mats["mirror"]]),
    ]
    for obj in objs:
        geo.smooth(obj, 40.0)
    return objs


# ==========================================================================
# Underbody: frame, axles, long-travel coilovers
# ==========================================================================


def build_chassis(mats: dict, detail: str) -> list[bpy.types.Object]:
    hero = detail == "hero"
    dark = bmesh.new()
    spring = bmesh.new()
    for side in (-1, 1):
        lib.bm_bar(dark, (-2.05, side * 0.43, 0.36), (2.05, side * 0.43, 0.36), 0.10, 0.12)
    for x in (1.75, 0.55, -0.60, -1.80):
        lib.bm_bar(dark, (x, -0.43, 0.36), (x, 0.43, 0.36), 0.08, 0.08)
    for axle_x in (AXLE_F, AXLE_R):
        lib.bm_cylinder(dark, (axle_x, 0.0, WHEEL_R), 0.055, 1.50, 14, axis="Y")
        lib.bm_sphere(dark, (axle_x, 0.10, WHEEL_R), 0.150, 14, 8, scale=(1.0, 0.85, 1.0))
        for side in (-1, 1):
            # Trailing arms.
            lib.bm_bar(dark, (axle_x, side * 0.58, WHEEL_R),
                       (axle_x - math.copysign(0.55, axle_x), side * 0.47, 0.42), 0.07, 0.07)
            # Coilover: a real helix round a damper body.
            cx, cy = axle_x - math.copysign(0.10, axle_x), side * 0.60
            lib.bm_cylinder(dark, (cx, cy, 0.700), 0.030, 0.520, 10, axis="Z")
            if hero:
                turns, z0, z1, r = 6.5, 0.52, 0.93, 0.072
                path = []
                for i in range(int(turns * 14) + 1):
                    t = i / (turns * 14)
                    a = t * turns * 2.0 * math.pi
                    path.append((cx + r * math.cos(a), cy + r * math.sin(a), lerp(z0, z1, t)))
                geo.tube(spring, path, 0.012, 6, up_hint=(1.0, 0.3, 0.2))
    lib.bm_box(dark, (0.25, 0.05, 0.38), (0.55, 0.36, 0.28))           # transfer case
    lib.bm_cylinder(dark, (0.95, 0.09, 0.40), 0.035, 0.90, 10, axis="X")
    lib.bm_cylinder(dark, (-0.62, 0.09, 0.40), 0.035, 1.55, 10, axis="X")
    lib.bm_box(dark, (-0.95, 0.20, 0.38), (0.80, 0.60, 0.22))           # battery / tank
    objs = [geo.to_object("CONTINUA_Chassis", dark, [mats["metal_dark"]])]
    geo.smooth(objs[0], 40.0)
    if hero:
        s = geo.to_object("CONTINUA_Springs", spring, [mats["accent_blue_matte"]])
        geo.smooth(s, 60.0)
        objs.append(s)
    return objs


# ==========================================================================
# Cabin
# ==========================================================================


def build_interior(mats: dict, detail: str) -> list[bpy.types.Object]:
    """A real cabin, so tinted glass shows depth rather than an empty box."""
    shell = bmesh.new()
    soft = bmesh.new()
    accent = bmesh.new()
    lib.bm_box(shell, (-0.60, 0.0, 0.78), (3.00, 1.74, 0.06))           # floor
    lib.bm_box(shell, (-0.80, 0.0, 1.835), (2.55, 1.68, 0.05))          # headliner
    lib.bm_box(shell, (0.86, 0.0, 1.20), (0.30, 1.72, 0.28))            # dashboard
    lib.bm_box(shell, (0.52, 0.0, 0.98), (0.55, 0.30, 0.34))            # console
    lib.bm_cylinder(shell, (0.66, 0.42, 1.30), 0.170, 0.032, 18, axis="X")
    lib.bm_box(shell, (-1.72, 0.0, 1.10), (0.86, 1.70, 0.60))           # equipment module
    for x_base, x_back, y in ((0.28, 0.04, 0.42), (0.28, 0.04, -0.42),
                              (-0.78, -1.02, 0.42), (-0.78, -1.02, -0.42)):
        lib.bm_box(soft, (x_base, y, 0.98), (0.54, 0.50, 0.15))
        lib.bm_box(soft, (x_back, y, 1.33), (0.15, 0.50, 0.62))
        lib.bm_box(soft, (x_back - 0.01, y, 1.70), (0.14, 0.26, 0.16))
    if detail == "hero":
        lib.bm_box(accent, (0.725, 0.0, 1.350), (0.020, 0.420, 0.200))   # mission display
        lib.bm_box(accent, (-1.290, 0.0, 1.300), (0.020, 1.100, 0.140))  # rear rack status strip
    objs = [geo.to_object("CONTINUA_InteriorShell", shell, [mats["interior"]]),
            geo.to_object("CONTINUA_InteriorSeats", soft, [mats["interior_soft"]])]
    if detail == "hero":
        objs.append(geo.to_object("CONTINUA_InteriorScreen", accent, [mats["accent_cyan"]]))
    else:
        accent.free()
    for obj in objs:
        geo.smooth(obj, 40.0)
    return objs


# ==========================================================================
# Roof: the sensor crown - the reason this vehicle exists
# ==========================================================================


def build_sensors(mats: dict, detail: str) -> tuple[list[bpy.types.Object], dict]:
    """The sensor suite: static parts, and the parts the runtime moves.

    Returns the static objects and a dict of moving parts, each built about its
    own pivot with the location to place it at: the LiDAR head (spins about
    its vertical axis), the satellite terminal's turntable (yaw) and its flat
    panel (hinged at the back edge, tilts up toward the satellite).
    """
    hero = detail == "hero"
    roof = roof_edge_z(0.0) + 0.032
    white = bmesh.new()     # pod shells, satcom panel
    dark = bmesh.new()      # rack, mast, feet
    lens = bmesh.new()      # camera windows, LiDAR band
    blue = bmesh.new()      # beacon segments
    amber = bmesh.new()
    led = bmesh.new()

    # --- low platform rack ---------------------------------------------------
    rail_z = roof + 0.075
    for side in (-1, 1):
        geo.tube(dark, [(0.300, side * 0.790, rail_z), (-1.980, side * 0.790, rail_z)], 0.022, 8)
        for x in (0.220, -0.620, -1.380, -1.900):
            lib.bm_box(dark, (x, side * 0.790, roof + 0.035), (0.070, 0.050, 0.080))
    for x in (0.280, -0.520, -1.140, -1.940):
        geo.tube(dark, [(x, -0.790, rail_z), (x, 0.790, rail_z)], 0.018, 8)
    # Slatted load platform behind the pod.
    slats = 13 if hero else 6
    for i in range(slats):
        x = -1.900 + (1.700 * i) / (slats - 1)
        lib.bm_box(dark, (x, 0.0, rail_z - 0.012), (0.050, 1.540, 0.012))
    # Scene lights on the rails, facing outward - work lighting at a site.
    for side in (-1, 1):
        for x in (-0.700, -1.620):
            lib.bm_box(dark, (x, side * 0.835, rail_z + 0.020), (0.120, 0.050, 0.075))
            lib.bm_box(led, (x, side * 0.862, rail_z + 0.020), (0.100, 0.006, 0.055))

    # --- sensor crown at the front of the roof -------------------------------
    # A low aerodynamic pod, lofted, sitting across the roof header.
    pod_sec = geo.rounded_rect(1.32, 0.150, 0.055, segments=4 if hero else 2)
    rings = []
    pod_x = (0.420, 0.390, 0.180, -0.020, -0.120)
    pod_s = (0.55, 0.92, 1.0, 0.92, 0.55)
    for x, s in zip(pod_x, pod_s):
        rings.append([(x, u * (0.88 + 0.12 * s), roof + 0.115 + v * s) for (u, v) in pod_sec])
    geo.loft(white, rings, closed=True, cap_start=True, cap_end=True)
    # Camera windows across the pod front.
    for y in (-0.42, -0.14, 0.14, 0.42):
        lib.bm_box(lens, (0.418, y, roof + 0.115), (0.012, 0.150, 0.050))
    # Integrated light bar along the pod's leading edge: blue for response,
    # amber for work zones, white takedown lamps in between.
    bar_colours = ("blue", "blue", "white", "amber", "amber", "white", "blue", "blue")
    for index, colour in enumerate(bar_colours):
        y = -0.595 + index * 0.170
        target = {"blue": blue, "amber": amber, "white": led}[colour]
        lib.bm_box(dark, (0.330, y, roof + 0.192), (0.080, 0.160, 0.020))
        lib.bm_box(target, (0.334, y, roof + 0.208), (0.074, 0.150, 0.016))
    # LiDAR on the pod, centred: a fixed base, and a head that spins - its
    # window band carries a white spine so the rotation can be seen.
    lid_x, lid_z = 0.170, roof + 0.188
    lib.bm_cylinder(dark, (lid_x, 0.0, lid_z + 0.015), 0.085, 0.030, 24, axis="Z")
    lib.bm_cylinder(white, (lid_x, 0.0, lid_z + 0.060), 0.090, 0.060, 28, axis="Z")
    head_white = bmesh.new()
    head_lens = bmesh.new()
    lib.bm_cylinder(head_lens, (0.0, 0.0, 0.0), 0.084, 0.060, 28, axis="Z")
    lib.bm_cylinder(head_white, (0.0, 0.0, 0.048), 0.090, 0.036, 28, axis="Z")
    lib.bm_box(head_white, (0.080, 0.0, 0.0), (0.020, 0.052, 0.062))
    lib.bm_box(head_white, (-0.080, 0.0, 0.0), (0.012, 0.022, 0.062))

    # --- inspection camera on a mast (pan-tilt head) -------------------------
    mast_x = -0.880
    lib.bm_cylinder(dark, (mast_x, 0.0, rail_z + 0.150), 0.040, 0.300, 14, axis="Z")
    lib.bm_box(dark, (mast_x, 0.0, rail_z + 0.320), (0.140, 0.200, 0.050))
    for side in (-1, 1):
        lib.bm_box(dark, (mast_x, side * 0.115, rail_z + 0.410), (0.080, 0.030, 0.160))
    lib.bm_sphere(white, (mast_x, 0.0, rail_z + 0.420), 0.110, 24 if hero else 12, 12 if hero else 6)
    lib.bm_cylinder(lens, (mast_x + 0.095, 0.0, rail_z + 0.420), 0.050, 0.040, 18, axis="X")
    if hero:
        lib.bm_cylinder(lens, (mast_x + 0.070, 0.062, rail_z + 0.465), 0.020, 0.040, 12, axis="X")
        lib.bm_cylinder(blue, (mast_x + 0.072, -0.065, rail_z + 0.465), 0.016, 0.030, 10, axis="X")

    # --- flat-panel satellite terminal (the remote link) ---------------------
    # A turntable on the rack; on it a yoke, and the panel hinged along its
    # back edge so it can turn toward the satellite and tilt up to it.
    sat_x, sat_y = -1.480, 0.320
    lib.bm_cylinder(dark, (sat_x, sat_y, rail_z + 0.022), 0.170, 0.026, 24 if hero else 12, axis="Z")
    mount_dark = bmesh.new()
    lib.bm_cylinder(mount_dark, (0.0, 0.0, 0.010), 0.150, 0.020, 24 if hero else 12, axis="Z")
    for side in (-1, 1):
        lib.bm_box(mount_dark, (-0.300, side * 0.190, 0.040), (0.050, 0.020, 0.060))
    lib.bm_box(mount_dark, (-0.300, 0.0, 0.022), (0.060, 0.400, 0.024))
    panel_white = bmesh.new()
    panel_dark = bmesh.new()
    panel = geo.rounded_rect(0.62, 0.40, 0.045, segments=3 if hero else 2)
    rings = [[(0.310 + u, v, 0.000) for (u, v) in panel],
             [(0.310 + u, v, 0.034) for (u, v) in panel]]
    geo.loft(panel_white, rings, closed=True, cap_start=True, cap_end=True)
    lib.bm_box(panel_dark, (0.310, 0.0, -0.008), (0.560, 0.340, 0.016))
    lib.bm_cylinder(panel_dark, (0.0, 0.0, 0.010), 0.012, 0.400, 10, axis="Y")

    # --- cellular MIMO domes and GNSS ----------------------------------------
    for x, y in ((-1.480, -0.430), (-0.330, -0.520)):
        lib.bm_cylinder(dark, (x, y, rail_z + 0.035), 0.090, 0.020, 18, axis="Z")
        lib.bm_sphere(white, (x, y, rail_z + 0.045), 0.085, 18 if hero else 10, 8 if hero else 5,
                      scale=(1.0, 1.0, 0.55))
    lib.bm_cylinder(white, (-0.330, 0.520, rail_z + 0.040), 0.060, 0.040, 16, axis="Z")
    # Whip antennas at the rear corners.
    for side in (-1, 1):
        lib.bm_cylinder(dark, (-1.940, side * 0.700, rail_z + 0.030), 0.028, 0.050, 10, axis="Z")
        lib.bm_cylinder(dark, (-1.940, side * 0.700, rail_z + 0.330), 0.007, 0.580, 6, axis="Z")

    objs = [
        geo.to_object("CONTINUA_SensorShell", white, [mats["sensor_white"]]),
        geo.to_object("CONTINUA_SensorFrame", dark, [mats["metal_dark"]]),
        geo.to_object("CONTINUA_SensorLens", lens, [mats["sensor_lens"]]),
        geo.to_object("CONTINUA_Beacons", blue, [mats["accent_blue"]]),
        geo.to_object("CONTINUA_BeaconsAmber", amber, [mats["light_amber"]]),
    ]
    objs.append(geo.to_object("CONTINUA_SensorLed", led, [mats["light_front"]]))
    for obj in objs:
        geo.smooth(obj, 40.0)

    def part(name: str, pieces: list[tuple[bmesh.types.BMesh, str]]) -> bpy.types.Object:
        built = [geo.to_object(f"{name}__{key}", bm, [mats[key]]) for bm, key in pieces]
        obj = geo.join(built, name)
        geo.smooth(obj, 40.0)
        return obj

    moving = {
        # name: (object, location, parent name or None)
        "lidar": (part("CONTINUA_LidarHead", [(head_lens, "sensor_lens"), (head_white, "sensor_white")]),
                  (lid_x, 0.0, lid_z + 0.120), None),
        "mount": (part("CONTINUA_SatMount", [(mount_dark, "metal_dark")]),
                  (sat_x, sat_y, rail_z + 0.036), None),
        "panel": (part("CONTINUA_SatPanel", [(panel_white, "sensor_white"), (panel_dark, "metal_dark")]),
                  (-0.300, 0.0, 0.060), "mount"),
    }
    return objs, moving


# ==========================================================================
# Identification - small, and ours
# ==========================================================================


def build_identity(mats: dict) -> list[bpy.types.Object]:
    """Door and tailgate lettering. Viewed from the +Y flank the nose is on
    the observer's left, so that side reads along -X."""
    half = math.pi / 2

    def text(name: str, body: str, location, rotation, size: float, material,
             spacing: float = 1.15) -> bpy.types.Object:
        curve = bpy.data.curves.new(name + "_curve", type="FONT")
        curve.body = body
        curve.size = size
        curve.extrude = 0.0025
        # Lettering a few centimetres tall does not need twelve steps per curve.
        curve.resolution_u = 3 if size < 0.06 else 5
        curve.align_x = "CENTER"
        curve.align_y = "CENTER"
        curve.space_character = spacing
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
        # Bake the object transform into the mesh so joining keeps placement.
        mesh_obj.data.transform(mesh_obj.matrix_basis)
        mesh_obj.matrix_basis = Matrix.Identity(4)
        return mesh_obj

    y = W_BODY + 0.0190
    return [
        text("CONTINUA_Ident_L", "CONTINUA", (-0.42, y, 0.930), (half, 0.0, math.pi), 0.115,
             mats["accent_blue"], 1.25),
        text("CONTINUA_Unit_L", "RESPONSE  ·  INSPECTION  ·  UNIT 04", (-0.42, y, 0.855),
             (half, 0.0, math.pi), 0.036, mats["trim"]),
        text("CONTINUA_Ident_R", "CONTINUA", (-0.42, -y, 0.930), (half, 0.0, 0.0), 0.115,
             mats["accent_blue"], 1.25),
        text("CONTINUA_Unit_R", "RESPONSE  ·  INSPECTION  ·  UNIT 04", (-0.42, -y, 0.855),
             (half, 0.0, 0.0), 0.036, mats["trim"]),
        text("CONTINUA_Ident_Rear", "CONTINUA", (TAIL_X - 0.0035, 0.42, 1.330),
             (half, 0.0, -half), 0.080, mats["accent_blue"], 1.25),
        # Registration on the rear plate, read the same way as the tail lettering.
        text("CONTINUA_Plate_Rear", "CNT · 04", (-2.4165, 0.0, 0.688),
             (half, 0.0, -half), 0.060, mats["trim"], 1.10),
        # Grille wordmark: faces +X and reads along +Y, which is the viewer's
        # right when looking at the nose.
        text("CONTINUA_Ident_Front", "CONTINUA", (NOSE_X + 0.042, 0.0, 0.962),
             (half, 0.0, half), 0.048, mats["rim_bright"], 1.40),
    ]


# ==========================================================================
# Wheels
# ==========================================================================


def build_wheel(mats: dict, name: str, detail: str, spare: bool = False) -> bpy.types.Object:
    """One wheel at the origin, axle on Y, outer face toward +Y."""
    hero = detail == "hero"
    seg = 56 if hero else 24

    # --- tyre carcass ---------------------------------------------------------
    tyre = bmesh.new()
    w = TYRE_HALF_W
    carcass = [
        (0.268, -w + 0.020), (0.290, -w + 0.004), (0.330, -w - 0.006), (0.366, -w + 0.002),
        (0.386, -w + 0.022), (0.394, -0.100), (0.396, -0.040), (0.396, 0.040), (0.394, 0.100),
        (0.386, w - 0.022), (0.366, w - 0.002), (0.330, w + 0.006), (0.290, w - 0.004),
        (0.268, w - 0.020),
    ]
    geo.revolve_profile(tyre, carcass, seg, axis="Y", closed_section=False)

    # --- tread: two staggered centre rows plus shoulder lugs that wrap -------
    if hero or not spare:
        blocks = 34 if hero else 20
        def lug(angle: float, y: float, size, radial: float) -> None:
            centre = Matrix.Rotation(angle, 4, "Y") @ Vector((radial, y, 0.0))
            lib.bm_box(tyre, centre, size, rotation=Matrix.Rotation(angle, 4, "Y"))
        for i in range(blocks):
            a = 2.0 * math.pi * i / blocks
            a2 = a + math.pi / blocks
            lug(a, -0.046, (0.020, 0.075, 0.052), 0.400)
            lug(a2, 0.046, (0.020, 0.075, 0.052), 0.400)
            if hero:
                lug(a2, -0.118, (0.022, 0.060, 0.058), 0.397)
                lug(a, 0.118, (0.022, 0.060, 0.058), 0.397)
                # Shoulder lugs stepping down onto the sidewall.
                lug(a, -0.158, (0.042, 0.020, 0.050), 0.378)
                lug(a2, 0.158, (0.042, 0.020, 0.050), 0.378)
    tyre_obj = geo.to_object(name + "_Tyre", tyre, [mats["rubber"]])

    # --- rim: gunmetal dish, tapered spokes, machined beadlock ring -----------
    rim = bmesh.new()
    bright = bmesh.new()
    barrel = [(0.255, -0.150), (0.268, -0.150), (0.268, 0.118), (0.255, 0.118)]
    geo.revolve_profile(rim, barrel, seg, axis="Y")
    ring = [(0.214, 0.116), (0.272, 0.116), (0.276, 0.144), (0.218, 0.148)]
    geo.revolve_profile(bright, ring, seg, axis="Y")
    lib.bm_cylinder(rim, (0.0, -0.090, 0.0), 0.255, 0.030, seg, axis="Y")   # inner disc
    lib.bm_cylinder(rim, (0.0, 0.086, 0.0), 0.090, 0.070, 24, axis="Y")     # hub
    spokes = 8 if hero else 6
    stations_r = ((0.078, 0.074, 0.046, 0.114), (0.150, 0.054, 0.040, 0.108),
                  (0.226, 0.040, 0.034, 0.100))
    for i in range(spokes):
        a = 2.0 * math.pi * (i + 0.5) / spokes
        radial = Vector((math.cos(a), 0.0, math.sin(a)))
        tangent = Vector((-math.sin(a), 0.0, math.cos(a)))
        axial = Vector((0.0, 1.0, 0.0))
        rings = []
        for r, width, depth, y_c in stations_r:
            sec = geo.rounded_rect(width, depth, 0.010, segments=2 if hero else 1)
            rings.append([radial * r + tangent * u + axial * (y_c + v) for (u, v) in sec])
        geo.loft(rim, rings, closed=True, cap_start=True, cap_end=True)
    bolts = bmesh.new()
    if hero:
        for i in range(20):
            a = 2.0 * math.pi * i / 20
            lib.bm_cylinder(bolts, (0.245 * math.cos(a), 0.150, 0.245 * math.sin(a)),
                            0.010, 0.012, 6, axis="Y")
        for i in range(6):
            a = 2.0 * math.pi * i / 6
            lib.bm_cylinder(bolts, (0.055 * math.cos(a), 0.124, 0.055 * math.sin(a)),
                            0.012, 0.016, 6, axis="Y")
    rim_obj = geo.to_object(name + "_Rim", rim, [mats["rim"]])
    geo.smooth(rim_obj, 40.0)
    ring_obj = geo.to_object(name + "_Beadlock", bright, [mats["rim_bright"]])
    geo.smooth(ring_obj, 40.0)
    parts = [tyre_obj, rim_obj, ring_obj]
    if hero:
        bolt_obj = geo.to_object(name + "_Bolts", bolts, [mats["metal_dark"]])
        parts.append(bolt_obj)
    else:
        bolts.free()

    cap = bmesh.new()
    lib.bm_cylinder(cap, (0.0, 0.124, 0.0), 0.034, 0.012, 20, axis="Y")
    parts.append(geo.to_object(name + "_Cap", cap, [mats["accent_blue"]]))

    if not spare:
        brake = bmesh.new()
        lib.bm_cylinder(brake, (0.0, -0.030, 0.0), 0.190, 0.024, 28 if hero else 14, axis="Y")
        brake_obj = geo.to_object(name + "_Disc", brake, [mats["metal_dark"]])
        caliper = bmesh.new()
        lib.bm_box(caliper, (-0.140, -0.020, 0.120), (0.085, 0.080, 0.150),
                   rotation=Matrix.Rotation(math.radians(40), 4, "Y"))
        caliper_obj = geo.to_object(name + "_Caliper", caliper, [mats["caliper"]])
        geo.bevel(caliper_obj, 0.012, 2)
        parts += [brake_obj, caliper_obj]

    wheel = geo.join(parts, name)
    geo.smooth(wheel, 38.0)
    return wheel


# ==========================================================================
# Materials
# ==========================================================================


def materials() -> dict:
    base = lib.continua_materials()
    pbr = lib.pbr
    return {
        **base,
        # Tests and the runtime look these names up; keep them.
        "paint": pbr("CONTINUA_Paint_White", "#F2F5FA", roughness=0.30, coat=0.85,
                     coat_roughness=0.04),
        "clad": pbr("CONTINUA_Cladding", "#262B33", metallic=0.0, roughness=0.66),
        "trim": pbr("CONTINUA_Trim_Black", "#14171D", metallic=0.05, roughness=0.42),
        "under": pbr("CONTINUA_Underbody", "#1B1F26", metallic=0.1, roughness=0.8),
        "glass": pbr("CONTINUA_Glass_Tint", "#0B1220", metallic=0.0, roughness=0.04,
                     alpha=0.80, ior=1.5, coat=1.0),
        "mirror": pbr("CONTINUA_Mirror", "#A9B6CC", metallic=0.9, roughness=0.06),
        "rubber": pbr("CONTINUA_Rubber", "#1A1D22", metallic=0.0, roughness=0.86),
        "rim": pbr("CONTINUA_Rim_Alloy", "#272C35", metallic=0.45, roughness=0.46),
        "alu": pbr("CONTINUA_Alu", "#B4BCC8", metallic=0.85, roughness=0.32),
        "roof": pbr("CONTINUA_Roof", "#1A1F27", metallic=0.1, roughness=0.42, coat=0.25,
                    coat_roughness=0.12),
        "rim_bright": pbr("CONTINUA_Rim_Bright", "#C9D0DA", metallic=0.9, roughness=0.24),
        "caliper": pbr("CONTINUA_Caliper", "#176BFF", metallic=0.2, roughness=0.38),
        "plate": pbr("CONTINUA_Plate", "#E9EDF3", metallic=0.0, roughness=0.5),
        "sensor_white": pbr("CONTINUA_Sensor_White", "#E8EDF4", metallic=0.0, roughness=0.36,
                            coat=0.5),
        "accent_blue_matte": pbr("CONTINUA_Spring_Blue", "#2E6FE0", metallic=0.3, roughness=0.42),
        "light_front": pbr("CONTINUA_Light_Front", "#F4F8FF", roughness=0.10,
                           emission="#FFFFFF", emission_strength=2.2),
        "light_rear": pbr("CONTINUA_Light_Rear", "#8E0F12", roughness=0.16,
                          emission="#FF1E1A", emission_strength=1.6),
        "light_amber": pbr("CONTINUA_Light_Amber", "#B45309", roughness=0.16,
                           emission="#FF9D0A", emission_strength=1.6),
    }


# ==========================================================================
# Assembly
# ==========================================================================


def build_vehicle(detail: str = "hero") -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    mats = materials()
    hero = detail == "hero"

    body = build_body(mats, detail)
    flares = build_flares(mats, detail)
    bumpers = build_bumpers(mats, detail)
    front = build_grille_and_lights(mats, detail)
    rear = build_rear(mats, detail)
    sides = build_side_details(mats, detail)
    chassis = build_chassis(mats, detail)
    interior = build_interior(mats, detail)
    sensors, moving = build_sensors(mats, detail)
    identity = build_identity(mats) if hero else []

    by_name = {o.name: o for o in rear + sides + front}
    spare = by_name.get("CONTINUA_Spare")

    # Node structure is a contract (docs/ASSET_MANIFEST.md, tests/scene.spec.ts).
    body_parts = [body, flares] + bumpers + identity
    body_parts += [by_name[n] for n in ("CONTINUA_Plates",) if n in by_name]
    body_obj = geo.join(body_parts, "CONTINUA_Body")

    glass_obj = geo.join([by_name["CONTINUA_RearGlass"], by_name["CONTINUA_MirrorGlass"]],
                         "CONTINUA_Glass")
    trim_obj = geo.join([by_name["CONTINUA_RearTrim"], by_name["CONTINUA_SideTrim"],
                         by_name["CONTINUA_SideClad"], by_name["CONTINUA_Mirrors"],
                         by_name["CONTINUA_LightHousing_Front"]]
                        + ([by_name["CONTINUA_Ladder"]] if "CONTINUA_Ladder" in by_name else [])
                        + ([spare] if spare else []), "CONTINUA_Trim")
    chassis_obj = geo.join(chassis, "CONTINUA_Chassis")
    cabin_obj = geo.join(interior, "CONTINUA_Interior")
    sensor_obj = geo.join(sensors, "CONTINUA_SensorAssembly")
    lights_front = geo.join([by_name["CONTINUA_Lights_Front"], by_name["CONTINUA_Indicators"],
                             by_name["CONTINUA_FrontAccent"]], "CONTINUA_Lights_Front")
    lights_rear = geo.join([by_name["CONTINUA_Lights_Rear"], by_name["CONTINUA_RearAmber"],
                            by_name["CONTINUA_RearWhite"]], "CONTINUA_Lights_Rear")

    root = lib.new_empty("CONTINUA_Vehicle", (0.0, 0.0, 0.0), size=0.6, display="ARROWS")
    static_parts = [body_obj, glass_obj, cabin_obj, trim_obj, chassis_obj, lights_front,
                    lights_rear, sensor_obj]
    for part in static_parts:
        lib.parent_to(part, root)
    # Moving sensors, each on its own pivot (the runtime animates them by name):
    # the LiDAR head spins; the satellite terminal turns and its panel tilts.
    for key in ("lidar", "mount", "panel"):
        obj, location, parent = moving[key]
        lib.parent_to(obj, moving[parent][0] if parent else root, location)
        static_parts.append(obj)

    wheels: list[bpy.types.Object] = []
    pivots: list[bpy.types.Object] = []
    for tag, axle_x, y, steerable in (
        ("FL", AXLE_F, TRACK_Y, True),
        ("FR", AXLE_F, -TRACK_Y, True),
        ("RL", AXLE_R, TRACK_Y, False),
        ("RR", AXLE_R, -TRACK_Y, False),
    ):
        wheel = build_wheel(mats, f"CONTINUA_Wheel_{tag}", detail)
        if y < 0:  # mirror so the dish and tread face outward on both sides
            wheel.data.transform(Matrix.Diagonal(Vector((1.0, -1.0, 1.0, 1.0))))
            wheel.data.flip_normals()
        if steerable:
            pivot = lib.new_empty(f"CONTINUA_Steer_{tag}", (axle_x, y, WHEEL_R), size=0.3)
            lib.parent_to(pivot, root, (axle_x, y, WHEEL_R))
            lib.parent_to(wheel, pivot, (0.0, 0.0, 0.0))
            pivots.append(pivot)
        else:
            lib.parent_to(wheel, root, (axle_x, y, WHEEL_R))
        wheels.append(wheel)

    bpy.context.view_layer.update()
    return root, [root] + static_parts + pivots + wheels


def bake(objects: list[bpy.types.Object], detail: str) -> None:
    """Contact shading: statics see each other and a ground plane; wheels see
    only themselves, because they spin and steer."""
    meshes = [o for o in objects if o.type == "MESH"]
    wheels = [o for o in meshes if o.name.startswith("CONTINUA_Wheel_")]
    statics = [o for o in meshes if o not in wheels]
    ground_bm = bmesh.new()
    lib.bm_box(ground_bm, (0.0, 0.0, -0.01), (14.0, 10.0, 0.02))
    ground = geo.to_object("BAKE_Ground", ground_bm, [])
    samples = 128 if detail == "hero" else 48
    geo.bake_ao(statics, distance=0.55, samples=samples, floor=0.30, gamma=0.85)
    geo.bake_ao(wheels, distance=0.22, samples=samples, floor=0.35, gamma=0.9,
                occluders_only_self=True)
    bpy.data.objects.remove(ground, do_unlink=True)


def report(objects: list[bpy.types.Object]) -> int:
    meshes = [o for o in objects if o.type == "MESH"]
    counts = {obj.name: lib.triangle_count([obj]) for obj in meshes}
    total = sum(counts.values())
    print(f"\n  {'object':<32}{'tris':>10}")
    print(f"  {'-' * 42}")
    for name, count in sorted(counts.items(), key=lambda item: -item[1]):
        print(f"  {name:<32}{count:>10,}")
    print(f"  {'-' * 42}")
    print(f"  {'TOTAL':<32}{total:>10,}")
    return total


def export(objects: list[bpy.types.Object], path: str) -> None:
    """Export with the AO attribute as COLOR_0."""
    lib.enable_addon("io_scene_gltf2")
    lib.select_only(objects)
    valid = {p.identifier for p in bpy.ops.export_scene.gltf.get_rna_type().properties}
    kwargs = {
        "filepath": path, "export_format": "GLB", "use_selection": True, "export_apply": True,
        "export_yup": True, "export_materials": "EXPORT", "export_normals": True,
        "export_tangents": False, "export_cameras": False, "export_lights": False,
        "export_extras": True, "export_animations": False, "export_vertex_color": "ACTIVE",
        "export_all_vertex_colors": False,
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
    no_bake = "--no-bake" in argv

    lib.banner("CONTINUA - building rover Mk2 (hero detail)")
    lib.reset_scene("CONTINUA_Vehicle")
    _, objects = build_vehicle("hero")
    if not no_bake:
        bake(objects, "hero")
    hero_tris = report(objects)
    export(objects, lib.out_path("apps", "web", "public", "models", "continua_rover.glb"))
    # glTF multiplies COLOR_0 into base colour by itself; the .blend needs the
    # same multiply wired in so Blender renders match the browser.
    geo.wire_ao_into_materials(bpy.data.materials)
    lib.save_blend(lib.out_path("assets", "blender", "continua_rover.blend"))

    lib.banner("CONTINUA - building rover Mk2 (LOD1)")
    lib.reset_scene("CONTINUA_Vehicle_LOD1")
    _, lod_objects = build_vehicle("lod1")
    if not no_bake:
        bake(lod_objects, "lod1")
    lod_tris = report(lod_objects)
    export(lod_objects, lib.out_path("apps", "web", "public", "models", "continua_rover_lod1.glb"))
    lib.write_model_versions()

    lib.banner("Summary")
    print(f"  hero triangles : {hero_tris:,}   (target 30,000 - 80,000)")
    print(f"  lod1 triangles : {lod_tris:,}")
    if not 30_000 <= hero_tris <= 80_000:
        print("  ! hero triangle count is outside the target budget")


if __name__ == "__main__":
    main()
