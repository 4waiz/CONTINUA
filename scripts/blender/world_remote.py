"""
CONTINUA world - the remote sector, and the living things.

The satellite ground station the route ends at, the pipeline the rover is
there to inspect, the wind farm, granite boulders, and the planting that makes
the island read as a warm, green coast: palms, broadleaf trees, scarlet flame
trees and violet jacarandas, flowering bushes and bedding.

Front faces +X unless stated otherwise; base on z = 0; authored at the origin.
"""

from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

import continua_arch as arch
import continua_geo as geo
import continua_lib as lib
from continua_arch import Kit, box, cylinder, slab


# ==========================================================================
# Satellite ground station (node name is a contract with sites.ts)
# ==========================================================================


DISH_DEPTH = 0.35      # rim depth / radius: f/D of about 0.36, a real ground-station dish


def _dish(bm, diameter: float, depth_ratio: float = DISH_DEPTH, segments: int = 48,
          rings: int = 8) -> None:
    """Parabolic reflector at the origin, opening toward +Y, with a back rim."""
    r = diameter / 2
    focal = r / (4 * depth_ratio)
    front = [(r * i / rings, (r * i / rings) ** 2 / (4 * focal)) for i in range(rings + 1)]
    back = [(rr, z - 0.08 - 0.12 * (1 - rr / r)) for (rr, z) in reversed(front)]
    profile = [(rr, -z) for (rr, z) in front] + [(rr, -z) for (rr, z) in back]
    # Revolve about Y; the concave side (front) faces +Y.
    geo.revolve_profile(bm, [(rr, -a) for (rr, a) in profile], segments, axis="Y")


def prop_sat_terminal(m: dict) -> bpy.types.Object:
    """Ground station compound: a 7.2 m dish on an az-el pedestal, a radome,
    an equipment shelter, a solar row and a fence. The dish faces +X, raised
    38 degrees; the beam attaches at 4.4 m (sites.ts linkHeight)."""
    k = Kit("PROP_SatTerminal", m)
    # The compound (pad, radome, shelter, solar, fence) is built in its own kit
    # and shifted by COMPOUND_SHIFT: the dish stays on the site position the
    # beam attaches to, while the fence clears the road's turnaround, which
    # lies toward authored -X with the site's yaw.
    c = Kit("tmp_compound", m)
    slab(c["concrete_warm"], (-2.0, 0.0, 0.05), (30.0, 24.0, 0.1), cell=4.0)
    # Pedestal.
    slab(k["concrete"], (0.0, 0.0, 0.55), (3.2, 3.2, 1.1), cell=1.0)
    cylinder(k["panel"], (0.0, 0.0, 1.45), 1.35, 0.7, 32)
    cylinder(k["graphite"], (0.0, 0.0, 1.85), 1.2, 0.1, 32)
    for s in (-1, 1):
        box(k["panel"], (0.0, s * 1.05, 3.1), (1.2, 0.35, 2.6))
    cylinder(k["steel_dark"], (0.0, 0.0, 4.2), 0.25, 2.5, 16, axis="Y")
    # The reflector, its back frame and the quadripod.
    dish = Kit("tmp_dish", m)
    _dish(dish["panel"], 7.2)
    r = 3.6
    for i in range(8):
        a = 2 * math.pi * i / 8
        arch.bar(dish["steel_dark"], (0.0, -0.35, 0.0), (r * 0.9 * math.cos(a), -0.12, r * 0.9 * math.sin(a)),
                 0.08, 0.12)
    focal_y = r / (4 * DISH_DEPTH)
    for i in range(4):
        a = math.pi / 4 + i * math.pi / 2
        arch.bar(dish["galv"], (r * 0.85 * math.cos(a), 0.45, r * 0.85 * math.sin(a)), (0.0, focal_y - 0.3, 0.0),
                 0.06, 0.06)
    cylinder(dish["panel"], (0.0, focal_y - 0.15, 0.0), 0.32, 0.4, 16, axis="Y")
    cylinder(dish["graphite"], (0.0, 0.3, 0.0), 0.2, 0.6, 12, axis="Y")
    turn = (Matrix.Translation((0.25, 0.0, 4.4))
            @ Matrix.Rotation(-math.pi / 2, 4, "Z")
            @ Matrix.Rotation(math.radians(38), 4, "X"))
    for bm in dish.meshes.values():
        bmesh.ops.transform(bm, matrix=turn, verts=bm.verts[:])
    for key, bm in list(dish.meshes.items()):
        mesh = bpy.data.meshes.new("tmp_merge")
        bm.to_mesh(mesh)
        k[key].from_mesh(mesh)
        bpy.data.meshes.remove(mesh)
        bm.free()
    dish.meshes = {}
    # Radome on a drum.
    cylinder(c["panel_grey"], (-9.0, 6.0, 1.3), 3.0, 2.6, 32)
    lib.bm_sphere(c["panel"], (-9.0, 6.0, 3.6), 3.4, 32, 16)
    for z in (2.6, 4.2, 5.6):
        rr = math.sqrt(max(0.0, 3.4 ** 2 - (z - 3.6) ** 2))
        geo.revolve_profile(c["panel_grey"], [(rr + 0.01, z - 0.03), (rr + 0.04, z - 0.03),
                                              (rr + 0.04, z + 0.03), (rr + 0.01, z + 0.03)], 32, axis="Z")
    # Equipment shelter with air conditioners.
    slab(c["panel"], (-8.0, -6.5, 1.55), (7.0, 3.0, 3.1), cell=1.5)
    box(c["graphite"], (-8.0, -6.5, 3.13), (7.2, 3.2, 0.08))
    arch.door(c, "+x", -4.5, -6.5, 1.0, 2.2)
    for y in (-7.4, -5.6):
        slab(c["panel_grey"], (-11.7, y, 1.2), (0.6, 0.9, 0.9), cell=0.5)
        cylinder(c["graphite"], (-12.0, y, 1.2), 0.32, 0.03, 16, axis="X")
    geo.tube(c["galv"], [(-6.0, -5.0, 3.1), (-6.0, -5.0, 7.5)], 0.05, 8)
    lib.bm_sphere(c["panel"], (-6.0, -5.0, 7.6), 0.14, 12, 6)
    box(c["accent_violet"], (-4.48, -6.5, 2.75), (0.03, 2.2, 0.16))
    # Solar row.
    tilt = Matrix.Rotation(math.radians(-25), 4, "Y")
    for i in range(6):
        y = -9.0 + i * 1.75
        box(c["solar"], (-14.5, y, 1.3), (1.0, 1.7, 0.05), rotation=tilt)
    for y in (-9.0, -0.25):
        cylinder(c["galv"], (-14.5, y, 0.6), 0.05, 1.2, 8)
    arch.railing(c, [(-17.0, -12.0, 0.1), (13.0, -12.0, 0.1), (13.0, 12.0, 0.1), (-17.0, 12.0, 0.1),
                     (-17.0, -12.0, 0.1)], height=2.4, post=3.0)
    sx, sy = COMPOUND_SHIFT
    for key, bm in list(c.meshes.items()):
        bmesh.ops.translate(bm, verts=bm.verts[:], vec=(sx, sy, 0.0))
        mesh = bpy.data.meshes.new("tmp_merge")
        bm.to_mesh(mesh)
        k[key].from_mesh(mesh)
        bpy.data.meshes.remove(mesh)
        bm.free()
    c.meshes = {}
    # Cable bridge from the shelter to the pedestal, along the shift.
    box(k["galv"], ((-4.5 + sx) / 2, (-6.5 + sy) / 2, 2.6),
        (math.hypot(-4.5 + sx, -6.5 + sy), 0.5, 0.12),
        rotation=Matrix.Rotation(math.atan2(-6.5 + sy, -4.5 + sx), 4, "Z"))
    st = k.finish(smooth_angle=45.0)
    sign = arch.sign_text("PROP_Sat_sign", "GROUND STATION 7", (-4.47 + sx, -6.5 + sy, 2.35),
                          arch.FACING["+x"], 0.28, m["graphite"], extrude=0.02)
    return arch.attach(st, [sign])


COMPOUND_SHIFT = (6.0, 4.0)


# ==========================================================================
# Pipeline
# ==========================================================================


def prop_pipeline(m: dict) -> bpy.types.Object:
    """A 12 m run of above-ground pipeline along X on two H-supports."""
    k = Kit("PROP_Pipeline", m)
    geo.tube(k["galv"], [(-6.0, 0.0, 1.3), (6.0, 0.0, 1.3)], 0.46, 20, cap=False)
    for x in (-6.0 + 0.6, 6.0 - 0.6):
        geo.revolve_profile(k["steel"], [(0.47, -0.05), (0.5, -0.05), (0.5, 0.05), (0.47, 0.05)], 20,
                            center=(x, 0.0, 1.3), axis="X")
    for x in (-3.0, 3.0):
        for y in (-0.55, 0.55):
            box(k["steel_dark"], (x, y, 0.45), (0.2, 0.12, 0.9))
        box(k["steel_dark"], (x, 0.0, 0.85), (0.24, 1.3, 0.14))
        box(k["concrete"], (x, 0.0, 0.08), (0.8, 1.6, 0.16))
    return k.finish(smooth_angle=45.0)


def prop_valve_station(m: dict) -> bpy.types.Object:
    """Block valve station: the pipeline surfaces, two gate valves with hand
    wheels, a launcher barrel, a vent stack and a small shelter."""
    k = Kit("PROP_ValveStation", m)
    slab(k["concrete_warm"], (0.0, 0.0, 0.06), (22.0, 14.0, 0.12), cell=3.0)
    geo.tube(k["galv"], [(-11.0, 0.0, 1.3), (11.0, 0.0, 1.3)], 0.46, 20, cap=False)
    for x in (-4.0, 4.0):
        slab(k["accent"], (x, 0.0, 1.3), (1.4, 1.3, 1.3), cell=0.7)
        cylinder(k["steel_dark"], (x, 0.0, 2.6), 0.12, 1.4, 10)
        geo.revolve_profile(k["signal_red"], [(0.45, -0.03), (0.5, -0.03), (0.5, 0.03), (0.45, 0.03)], 20,
                            center=(x, 0.0, 3.35), axis="Z")
    geo.tube(k["tank_white"], [(-8.0, -3.5, 1.2), (6.0, -3.5, 1.2)], 0.6, 20)
    for x in (-6.0, 0.0, 4.5):
        box(k["steel_dark"], (x, -3.5, 0.3), (0.3, 1.2, 0.6))
    geo.tube(k["galv"], [(8.0, 4.0, 0.0), (8.0, 4.0, 7.0)], 0.18, 12)
    slab(k["panel"], (-7.0, 4.5, 1.4), (4.0, 3.0, 2.8), cell=1.5)
    box(k["graphite"], (-7.0, 4.5, 2.84), (4.2, 3.2, 0.08))
    arch.railing(k, [(-11.0, -7.0, 0.12), (11.0, -7.0, 0.12), (11.0, 7.0, 0.12), (-11.0, 7.0, 0.12),
                     (-11.0, -7.0, 0.12)], height=2.2, post=2.75)
    return k.finish(smooth_angle=45.0)


# ==========================================================================
# Wind turbine (the rotor is its own node so the runtime can turn it)
# ==========================================================================

TURBINE_HUB = (2.6, 0.0, 62.0)   # hub centre in the turbine's frame; rotor faces +X


def prop_wind_turbine(m: dict) -> list[bpy.types.Object]:
    k = Kit("PROP_WindTurbine", m)
    h = 60.0
    geo.revolve_profile(k["tank_white"], [(2.1, 0.0), (1.25, h)], 32, axis="Z", closed_section=False)
    slab(k["tank_white"], (0.0, 0.0, h + 1.6), (6.5, 3.0, 3.2), cell=1.5)
    box(k["accent"], (0.0, 1.52, h + 1.2), (5.0, 0.04, 0.3))
    cylinder(k["concrete"], (0.0, 0.0, 0.3), 4.5, 0.6, 24)
    tower = k.finish(smooth_angle=50.0)
    r = Kit("PROP_WindTurbine_Rotor", m)
    lib.bm_sphere(r["tank_white"], (0.4, 0.0, 0.0), 1.4, 20, 10, scale=(1.6, 1.0, 1.0))
    for i in range(3):
        a = 2 * math.pi * i / 3
        rings = []
        for j, (rad, chord, thick) in enumerate(((1.0, 1.6, 0.5), (4.0, 2.6, 0.45), (12.0, 1.9, 0.3),
                                                  (24.0, 1.1, 0.18), (34.0, 0.4, 0.08))):
            sec = geo.rounded_rect(thick, chord, min(thick, chord) * 0.45, 2)
            twist = math.radians(18 - j * 4)
            radial = Vector((0.0, math.cos(a), math.sin(a)))
            tangent = Vector((0.0, -math.sin(a), math.cos(a)))
            axial = Vector((1.0, 0.0, 0.0))
            # Twist turns the chord out of the rotor plane toward the wind.
            chord_dir = tangent * math.cos(twist) + axial * math.sin(twist)
            thick_dir = axial * math.cos(twist) - tangent * math.sin(twist)
            rings.append([radial * rad + thick_dir * u + chord_dir * v for (u, v) in sec])
        geo.loft(r["tank_white"], rings, closed=True, cap_start=True, cap_end=True)
    rotor = r.finish(smooth_angle=60.0)
    return [tower, rotor]


# ==========================================================================
# Ground and planting
# ==========================================================================


def _boulder(bm, centre, radius, seed: int, squash: float = 0.6) -> None:
    rng = arch.rng(seed)
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=2, radius=radius)
    for v in tmp.verts:
        n = v.co.normalized()
        bump = 1.0 + rng.uniform(-0.16, 0.16) + 0.12 * math.sin(n.x * 5.0 + seed) * math.cos(n.y * 4.0)
        v.co = n * radius * bump
        v.co.z *= squash
        # Sandstone weathers in layers: terrace the profile a little.
        v.co.z = round(v.co.z / (radius * 0.18)) * (radius * 0.18) * 0.35 + v.co.z * 0.65
        if v.co.z < -radius * 0.15:
            v.co.z = -radius * 0.15
    bmesh.ops.translate(tmp, verts=tmp.verts[:], vec=Vector(centre) + Vector((0, 0, radius * squash * 0.55)))
    mesh = bpy.data.meshes.new("tmp_boulder")
    tmp.to_mesh(mesh)
    tmp.free()
    bm.from_mesh(mesh)
    bpy.data.meshes.remove(mesh)


def prop_rocks(m: dict) -> list[bpy.types.Object]:
    out = []
    for name, seed, parts in (("PROP_Rock_A", 11, ((0, 0, 1.7, 0.62), (1.2, 0.6, 0.9, 0.7))),
                              ("PROP_Rock_B", 23, ((0, 0, 1.1, 0.75),)),
                              ("PROP_Rock_C", 37, ((0, 0, 2.8, 0.5), (-1.8, 1.0, 1.4, 0.65),
                                                   (1.6, -1.2, 1.0, 0.8)))):
        k = Kit(name, m)
        for i, (x, y, r, sq) in enumerate(parts):
            _boulder(k["rock" if i == 0 else "rock_dark"], (x, y, 0.0), r, seed + i * 7, sq)
        out.append(k.finish(smooth_angle=55.0))
    return out


def _frond(bm, base: Vector, direction: float, droop: float, length: float, width: float) -> None:
    """A palm frond: an arching strip with a V fold, both faces built."""
    steps = 7
    rings = []
    for i in range(steps + 1):
        t = i / steps
        along = length * t
        x = math.cos(direction) * along
        y = math.sin(direction) * along
        z = 0.9 * length * t * (1.0 - t) * 1.2 - droop * t * t * length
        w = width * math.sin(math.pi * min(1.0, t * 1.15)) * (1.0 - 0.6 * t)
        side = Vector((-math.sin(direction), math.cos(direction), 0.0))
        centre = base + Vector((x, y, z))
        rings.append([centre + side * w + Vector((0, 0, -0.18 * w)), centre + Vector((0, 0, 0.02)),
                      centre - side * w + Vector((0, 0, -0.18 * w))])
    # Two sheets of vertices a hair apart, wound opposite ways, so the frond
    # is visible from below without a double-sided material.
    front = [[bm.verts.new(p) for p in r] for r in rings]
    back = [[bm.verts.new(p - Vector((0, 0, 0.01))) for p in r] for r in rings]
    for (a, b), (c, d) in zip(zip(front, front[1:]), zip(back, back[1:])):
        for j in range(2):
            bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
            bm.faces.new((c[j + 1], d[j + 1], d[j], c[j]))


def prop_palm(m: dict) -> bpy.types.Object:
    """Date palm: a ringed, slightly curved trunk and a crown of 14 fronds."""
    k = Kit("PROP_Palm", m)
    h = 9.0
    path = [(0.25 * math.sin(t * 1.4) * t, 0.0, t * h) for t in [i / 12 for i in range(13)]]
    radius = lambda t: 0.30 - 0.08 * t + 0.03 * math.sin(t * 60.0)
    geo.sweep(k["trunk"], geo.circle(1.0, 10), path, scale=lambda t: radius(t))
    top = Vector(path[-1])
    lib.bm_sphere(k["trunk"], top + Vector((0, 0, 0.1)), 0.42, 10, 6)
    for i in range(14):
        direction = 2 * math.pi * i / 14 + (0.2 if i % 2 else 0.0)
        droop = 0.55 if i % 2 else 0.35
        _frond(k["leaf" if i % 3 else "leaf_dark"], top + Vector((0, 0, 0.25)), direction, droop,
               4.2 if i % 2 else 3.6, 0.55)
    return k.finish(smooth_angle=70.0)


def prop_ghaf(m: dict) -> bpy.types.Object:
    """Ghaf tree: a short trunk splitting into three limbs under a broad,
    drooping canopy of clustered foliage."""
    k = Kit("PROP_Ghaf", m)
    rng = arch.rng(5)
    geo.sweep(k["trunk"], geo.circle(1.0, 9), [(0, 0, 0), (0.1, 0.0, 1.6)], scale=lambda t: 0.32 - 0.06 * t)
    tips = []
    for i in range(3):
        a = 2 * math.pi * i / 3 + 0.4
        tip = Vector((2.2 * math.cos(a), 2.2 * math.sin(a), 4.2))
        geo.sweep(k["trunk"], geo.circle(1.0, 7), [(0.1, 0, 1.5), (1.0 * math.cos(a), 1.0 * math.sin(a), 2.8),
                                                   tuple(tip)], scale=lambda t: 0.22 - 0.12 * t)
        tips.append(tip)
    for i in range(10):
        base = tips[i % 3]
        offset = Vector((rng.uniform(-1.7, 1.7), rng.uniform(-1.7, 1.7), rng.uniform(-0.3, 1.0)))
        r = rng.uniform(1.35, 2.0)
        _foliage(k["leaf_dark" if i % 2 else "leaf"], base + offset - Vector((0, 0, r * 0.25)), r,
                 100 + i, squash=0.68, subdivisions=3)
    return k.finish(smooth_angle=70.0)


def prop_shrubs(m: dict) -> list[bpy.types.Object]:
    out = []
    for name, seed, count, spread in (("PROP_Shrub_A", 3, 4, 0.7), ("PROP_Shrub_B", 9, 6, 1.1)):
        k = Kit(name, m)
        rng = arch.rng(seed)
        for i in range(count):
            r = rng.uniform(0.35, 0.65)
            c = (rng.uniform(-spread, spread), rng.uniform(-spread, spread), -r * 0.25)
            _boulder(k["leaf_dry" if i % 2 else "leaf"], c, r, seed * 10 + i, squash=0.7)
        out.append(k.finish(smooth_angle=60.0))
    return out


def prop_solar_field(m: dict) -> bpy.types.Object:
    """Two ground-mounted solar tables, 20 m along X, tilted toward +Y."""
    k = Kit("PROP_SolarField", m)
    tilt = Matrix.Rotation(math.radians(-22), 4, "X")
    for row, y in enumerate((-3.0, 3.0)):
        for i in range(10):
            box(k["solar"], (-9.0 + i * 2.0, y, 1.35), (1.96, 2.0, 0.05), rotation=tilt)
        for x in (-9.5, -3.0, 3.0, 9.5):
            cylinder(k["galv"], (x, y + 0.5, 0.75), 0.05, 1.5, 8)
            cylinder(k["galv"], (x, y - 0.5, 0.55), 0.05, 1.1, 8)
        box(k["galv"], (0.0, y, 1.25), (20.0, 0.08, 0.08), rotation=tilt)
    return k.finish(smooth_angle=40.0)


# ==========================================================================
# Flowering planting: the colour of a green coastal island
# ==========================================================================


def _foliage(bm, centre, radius: float, seed: int, squash: float = 0.7, subdivisions: int = 2) -> None:
    """A cluster of leaf or bloom: a lumpy, flattened ball."""
    rng = arch.rng(seed)
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=subdivisions, radius=radius)
    phase = rng.uniform(0.0, 6.28)
    for v in tmp.verts:
        n = v.co.normalized()
        lump = (0.15 * math.sin(n.x * 4.1 + phase) * math.sin(n.y * 3.7 + phase * 0.7) * math.cos(n.z * 4.6)
                + 0.06 * math.sin(n.x * 9.3 - phase) * math.cos(n.y * 8.1)
                + rng.uniform(-0.05, 0.05))
        v.co = n * radius * (1.0 + lump)
        v.co.z *= squash
    bmesh.ops.translate(tmp, verts=tmp.verts[:], vec=Vector(centre))
    mesh = bpy.data.meshes.new("tmp_foliage")
    tmp.to_mesh(mesh)
    tmp.free()
    bm.from_mesh(mesh)
    bpy.data.meshes.remove(mesh)


def prop_flame_tree(m: dict) -> bpy.types.Object:
    """Flame tree (Delonix regia): a short trunk forking low into spreading
    limbs under a broad, flat umbrella of scarlet bloom and fine green leaf."""
    k = Kit("PROP_FlameTree", m)
    rng = arch.rng(41)
    geo.sweep(k["trunk"], geo.circle(1.0, 10), [(0, 0, 0), (0.15, 0.0, 1.3), (0.2, 0.1, 2.1)],
              scale=lambda t: 0.36 - 0.1 * t)
    for i in range(5):
        a = 2 * math.pi * i / 5 + rng.uniform(-0.25, 0.25)
        r = rng.uniform(3.4, 4.8)
        tip = (r * math.cos(a), r * math.sin(a), rng.uniform(5.0, 5.7))
        mid = (r * 0.42 * math.cos(a), r * 0.42 * math.sin(a), 3.5)
        geo.sweep(k["trunk"], geo.circle(1.0, 7), [(0.2, 0.1, 1.9), mid, tip], scale=lambda t: 0.2 - 0.12 * t)
    # Leaf in a broad lower layer, bloom heaped over it - the way a flame tree
    # in flower carries its colour on top.
    for i in range(8):
        a = 2 * math.pi * i / 8 + rng.uniform(-0.2, 0.2)
        r = rng.uniform(2.6, 5.0)
        centre = (r * math.cos(a), r * math.sin(a), rng.uniform(5.2, 5.8))
        _foliage(k["leaf" if i % 2 else "leaf_dark"], centre, rng.uniform(1.7, 2.3), 300 + i, squash=0.5,
                 subdivisions=3)
    for i in range(9):
        a = 2 * math.pi * i / 9 + rng.uniform(-0.3, 0.3) + 0.35
        r = rng.uniform(0.0, 4.6) if i else 0.0
        centre = (r * math.cos(a), r * math.sin(a), rng.uniform(6.2, 6.9))
        _foliage(k["blossom_flame"], centre, rng.uniform(1.5, 2.1), 320 + i, squash=0.55, subdivisions=3)
    return k.finish(smooth_angle=70.0)


def prop_jacaranda(m: dict) -> bpy.types.Object:
    """Jacaranda: an upright vase of limbs under a rounded crown of violet bloom."""
    k = Kit("PROP_Jacaranda", m)
    rng = arch.rng(43)
    geo.sweep(k["trunk"], geo.circle(1.0, 10), [(0, 0, 0), (0.1, 0.05, 1.6), (0.15, 0.1, 2.7)],
              scale=lambda t: 0.3 - 0.08 * t)
    for i in range(4):
        a = 2 * math.pi * i / 4 + 0.4
        tip = (2.3 * math.cos(a), 2.3 * math.sin(a), 6.0)
        mid = (1.0 * math.cos(a), 1.0 * math.sin(a), 4.0)
        geo.sweep(k["trunk"], geo.circle(1.0, 7), [(0.15, 0.1, 2.5), mid, tip], scale=lambda t: 0.18 - 0.1 * t)
    # Crown: clusters over the upper half of a dome.
    for i in range(13):
        polar = rng.uniform(0.0, 1.25)
        azimuth = rng.uniform(0.0, 6.283)
        centre = (3.0 * math.sin(polar) * math.cos(azimuth), 3.0 * math.sin(polar) * math.sin(azimuth),
                  6.4 + 2.2 * math.cos(polar))
        green = i % 4 == 2
        _foliage(k["leaf_dark" if green else "blossom_lilac"], centre, rng.uniform(1.4, 1.95), 400 + i,
                 squash=0.8, subdivisions=3)
    return k.finish(smooth_angle=70.0)


FLOWER_BUSHES = (
    ("PROP_FlowerBush_Magenta", "blossom_magenta", 5),
    ("PROP_FlowerBush_Coral", "blossom_coral", 6),
    ("PROP_FlowerBush_Yellow", "blossom_yellow", 7),
    ("PROP_FlowerBush_White", "blossom_white", 8),
)


def prop_flower_bushes(m: dict) -> list[bpy.types.Object]:
    """Bougainvillea-like mounds: dark leaf under sprays of bloom, about 2.4 m
    across and 1.6 m high, in four colours."""
    out = []
    for name, colour, seed in FLOWER_BUSHES:
        k = Kit(name, m)
        rng = arch.rng(seed)
        for i in range(5):
            r = rng.uniform(0.55, 0.85)
            centre = (rng.uniform(-0.8, 0.8), rng.uniform(-0.8, 0.8), r * 0.45)
            _foliage(k["leaf_dark" if i % 2 else "leaf"], centre, r, seed * 10 + i, squash=0.8)
        for i in range(10):
            angle = rng.uniform(0.0, 6.283)
            reach = rng.uniform(0.25, 1.05)
            r = rng.uniform(0.26, 0.42)
            centre = (reach * math.cos(angle), reach * math.sin(angle), rng.uniform(0.55, 1.15))
            _foliage(k[colour], centre, r, seed * 20 + i, squash=0.85, subdivisions=1)
        out.append(k.finish(smooth_angle=60.0))
    return out


def prop_flower_bed(m: dict) -> bpy.types.Object:
    """A raised bed for roadsides and facades: a concrete kerb round dark soil
    and two rows of bedding plants in four colours. 6 m along X, 1.6 m deep."""
    k = Kit("PROP_FlowerBed", m)
    length, depth, kerb = 6.0, 1.6, 0.12
    for y in (-depth / 2 + kerb / 2, depth / 2 - kerb / 2):
        box(k["concrete"], (0.0, y, 0.15), (length, kerb, 0.3))
    for x in (-length / 2 + kerb / 2, length / 2 - kerb / 2):
        box(k["concrete"], (x, 0.0, 0.15), (kerb, depth - 2 * kerb, 0.3))
    box(k["soil"], (0.0, 0.0, 0.13), (length - 2 * kerb, depth - 2 * kerb, 0.26))
    rng = arch.rng(29)
    colours = ("blossom_yellow", "blossom_magenta", "blossom_white", "blossom_coral")
    for row, y in enumerate((-0.36, 0.36)):
        for i in range(10):
            x = -2.55 + i * 0.567 + (0.28 if row else 0.0) * 0.5
            _foliage(k["leaf"], (x, y, 0.36), 0.24, 600 + row * 20 + i, squash=0.7, subdivisions=1)
            _foliage(k[colours[(i + row * 2) % 4]], (x + rng.uniform(-0.06, 0.06), y + rng.uniform(-0.06, 0.06), 0.5),
                     0.17, 640 + row * 20 + i, squash=0.75, subdivisions=1)
    return k.finish(smooth_angle=55.0)


def build_all(m: dict) -> list[bpy.types.Object]:
    out = [prop_sat_terminal(m), prop_pipeline(m), prop_valve_station(m), prop_palm(m),
           prop_ghaf(m), prop_solar_field(m)]
    out += prop_wind_turbine(m)
    out += prop_rocks(m)
    out += prop_shrubs(m)
    out += [prop_flame_tree(m), prop_jacaranda(m), prop_flower_bed(m)]
    out += prop_flower_bushes(m)
    return out
