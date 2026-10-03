"""
CONTINUA world - the coast.

The island's working waterfront: a lighthouse on the headland past the ground
station, a concrete jetty below the campus with the rescue boat that answers
to the same operations centre as the rover, a lifeguard tower on the beach, and
boats for the sea - a rescue boat and two sailing yachts the runtime sails on
slow, fixed courses.

Front faces +X unless stated otherwise; base on z = 0; authored at the origin.
Boats float with their waterline on z = 0.
"""

from __future__ import annotations

import math

import bpy
from mathutils import Matrix

import continua_arch as arch
import continua_geo as geo
import continua_lib as lib
from continua_arch import Kit, box, cylinder, slab


def _ring(radius: float, z: float, segments: int, cx: float = 0.0, cy: float = 0.0):
    return [(cx + radius * math.cos(2 * math.pi * i / segments), cy + radius * math.sin(2 * math.pi * i / segments), z)
            for i in range(segments)]


def _frustum(bm, r0: float, r1: float, z0: float, z1: float, segments: int = 20, cap: bool = False) -> None:
    geo.loft(bm, [_ring(r0, z0, segments), _ring(r1, z1, segments)], closed=True, cap_start=cap, cap_end=cap)


# ==========================================================================
# Lighthouse
# ==========================================================================


def prop_lighthouse(m: dict) -> bpy.types.Object:
    """A 21 m tapered tower, white with two red bands, a railed gallery, a
    glazed lantern under a red cap, and the keeper's house behind it (-X)."""
    k = Kit("PROP_Lighthouse", m)
    # Plinth and steps.
    cylinder(k["concrete"], (0.0, 0.0, 0.35), 3.4, 0.7, 28)
    box(k["concrete"], (3.6, 0.0, 0.18), (1.2, 1.6, 0.36))
    # The tower, in painted bands.
    height, r0, r1 = 20.5, 2.3, 1.55
    radius = lambda z: r0 + (r1 - r0) * (z / height)  # noqa: E731
    bands = ((0.7, 5.6, "panel"), (5.6, 8.6, "signal_red"), (8.6, 13.6, "panel"),
             (13.6, 16.6, "signal_red"), (16.6, height, "panel"))
    for z0, z1, finish in bands:
        _frustum(k[finish], radius(z0), radius(z1), z0, z1, 24)
    # Door and the windows up the stair.
    box(k["graphite"], (radius(1.8) - 0.04, 0.0, 1.85), (0.16, 1.05, 2.2))
    for z, angle in ((4.2, 0.0), (10.8, 2.3), (15.2, -1.9)):
        r = radius(z) - 0.03
        box(k["glass_dark"], (r * math.cos(angle), r * math.sin(angle), z), (0.14, 0.42, 0.85),
            rotation=Matrix.Rotation(angle, 4, "Z"))
    # Gallery: a deck, posts and a rail.
    cylinder(k["graphite"], (0.0, 0.0, height + 0.15), 2.45, 0.3, 28)
    for i in range(18):
        a = 2 * math.pi * i / 18
        cylinder(k["graphite"], (2.3 * math.cos(a), 2.3 * math.sin(a), height + 0.75), 0.035, 0.9, 6)
    geo.sweep(k["graphite"], geo.circle(0.045, 6), _ring(2.3, height + 1.2, 36), closed_path=True)
    # Lantern: glazing between mullions, the lamp inside.
    cylinder(k["glass"], (0.0, 0.0, height + 1.55), 1.2, 2.2, 16)
    for i in range(8):
        a = 2 * math.pi * i / 8
        box(k["graphite"], (1.22 * math.cos(a), 1.22 * math.sin(a), height + 1.55), (0.08, 0.08, 2.2))
    cylinder(k["lamp"], (0.0, 0.0, height + 1.5), 0.42, 0.9, 12)
    # Red cap, ventilator ball and lightning rod.
    _frustum(k["signal_red"], 1.45, 0.25, height + 2.65, height + 3.6, 20, cap=True)
    lib.bm_sphere(k["graphite"], (0.0, 0.0, height + 3.85), 0.3, 12, 8)
    cylinder(k["graphite"], (0.0, 0.0, height + 4.6), 0.04, 1.4, 6)
    # The keeper's house: white walls, a terracotta gable roof.
    hx, hy, hz = -7.4, 0.0, 3.4
    slab(k["panel"], (hx, hy, hz / 2), (6.4, 5.2, hz), cell=1.6)
    for side in (-1, 1):
        roof = [(hx - 3.6, hy + side * 2.95, hz - 0.1), (hx + 3.6, hy + side * 2.95, hz - 0.1),
                (hx + 3.6, hy, hz + 1.7), (hx - 3.6, hy, hz + 1.7)]
        verts = [k["roof_tile"].verts.new(p) for p in roof]
        k["roof_tile"].faces.new(verts if side > 0 else list(reversed(verts)))
    for gx in (hx - 3.2, hx + 3.2):
        verts = [k["panel"].verts.new(p) for p in ((gx, hy - 2.6, hz), (gx, hy + 2.6, hz), (gx, hy, hz + 1.55))]
        k["panel"].faces.new(verts)
    box(k["graphite"], (hx + 3.22, -1.2, 1.1), (0.08, 0.95, 2.1))
    for wy in (0.6, 1.9):
        box(k["glass_dark"], (hx + 3.22, wy, 1.75), (0.06, 0.8, 1.0))
    for wx in (hx - 1.6, hx + 1.0):
        box(k["glass_dark"], (wx, hy - 2.62, 1.75), (0.9, 0.06, 1.0))
    box(k["graphite"], (hx - 1.8, hy + 1.4, hz + 1.3), (0.5, 0.5, 1.4))  # chimney
    return k.finish(smooth_angle=40.0)


# ==========================================================================
# Jetty
# ==========================================================================


def prop_jetty(m: dict) -> bpy.types.Object:
    """A concrete jetty 44 m along +X from the beach: a deck on piles, an edge
    kerb, bollards and fenders, two lamps, and a ramp up from the sand (-X)."""
    k = Kit("PROP_Jetty", m)
    length, width, deck = 44.0, 4.4, 1.25
    slab(k["concrete"], (length / 2, 0.0, deck - 0.2), (length, width, 0.4), cell=4.0)
    # Ramp from the sand up to the deck.
    ramp = [(-6.0, -width / 2, 0.0), (0.0, -width / 2, deck), (0.0, width / 2, deck), (-6.0, width / 2, 0.0)]
    verts = [k["concrete"].verts.new(p) for p in ramp]
    k["concrete"].faces.new(list(reversed(verts)))
    for x in range(4, int(length), 6):
        for y in (-width / 2 + 0.35, width / 2 - 0.35):
            cylinder(k["concrete_warm"], (x, y, deck - 0.4 - 3.6), 0.3, 7.2, 12)
    for y in (-width / 2 + 0.1, width / 2 - 0.1):
        box(k["concrete_warm"], (length / 2, y, deck + 0.1), (length, 0.2, 0.22))
    for x in (9.0, 19.0, 29.0, 39.0):
        for side in (-1, 1):
            y = side * (width / 2 - 0.45)
            cylinder(k["graphite"], (x, y, deck + 0.28), 0.16, 0.56, 12)
            lib.bm_sphere(k["graphite"], (x, y, deck + 0.6), 0.2, 12, 6, scale=(1.0, 1.0, 0.6))
            box(k["rubber"], (x - 2.5, side * (width / 2 + 0.12), deck - 0.35), (0.6, 0.24, 1.0))
    for x in (12.0, 36.0):
        cylinder(k["galv"], (x, width / 2 - 0.3, deck + 2.1), 0.07, 4.2, 8)
        box(k["galv"], (x, width / 2 - 0.85, deck + 4.15), (0.12, 1.1, 0.1))
        box(k["lamp"], (x, width / 2 - 1.3, deck + 4.05), (0.35, 0.3, 0.12))
    # A ladder down to the water at the head.
    for y in (-0.3, 0.3):
        box(k["galv"], (length + 0.08, y, deck - 1.2), (0.06, 0.06, 2.6))
    for z in range(5):
        box(k["galv"], (length + 0.08, 0.0, deck - 2.3 + z * 0.5), (0.05, 0.6, 0.05))
    return k.finish(smooth_angle=40.0)


# ==========================================================================
# Lifeguard tower
# ==========================================================================


def prop_lifeguard_tower(m: dict) -> bpy.types.Object:
    """A raised lifeguard hut on four legs: red and white, a ramp, a flag."""
    k = Kit("PROP_LifeguardTower", m)
    for x in (-1.1, 1.1):
        for y in (-1.1, 1.1):
            box(k["panel"], (x, y, 1.15), (0.14, 0.14, 2.3))
    slab(k["panel"], (0.0, 0.0, 2.4), (3.0, 3.0, 0.2), cell=1.0)
    slab(k["signal_red"], (0.0, 0.0, 3.4), (2.6, 2.6, 1.8), cell=0.8)
    box(k["glass_dark"], (1.31, 0.0, 3.6), (0.05, 2.0, 0.8))
    box(k["panel"], (0.0, 0.0, 4.4), (3.1, 3.1, 0.2))
    ramp = [(-1.5, -0.5, 2.4), (-4.6, -0.5, 0.0), (-4.6, 0.5, 0.0), (-1.5, 0.5, 2.4)]
    verts = [k["panel"].verts.new(p) for p in ramp]
    k["panel"].faces.new(verts)
    cylinder(k["galv"], (1.2, 1.2, 5.4), 0.04, 2.0, 6)
    flag = [(1.2, 1.2, 6.3), (1.2, 2.2, 6.0), (1.2, 1.2, 5.7)]
    verts = [k["signal_red"].verts.new(p) for p in flag]
    k["signal_red"].faces.new(verts)
    return k.finish(smooth_angle=30.0)


# ==========================================================================
# Boats - waterline on z = 0, bow on +X
# ==========================================================================


def _hull(bm, length: float, beam: float, freeboard: float, draft: float, stations: int = 9) -> None:
    """A planing hull: lofted sections, a raked bow, a flat transom."""
    rings = []
    for i in range(stations):
        t = i / (stations - 1)
        x = -length / 2 + length * t
        # Beam: full aft, narrowing to the stem.
        half = beam / 2 * (1.0 if t < 0.55 else math.cos((t - 0.55) / 0.45 * math.pi / 2) ** 0.8)
        half = max(half, 0.02)
        sheer = freeboard + 0.35 * t * t
        keel = -draft * (1.0 - 0.75 * t * t)
        chine = keel * 0.35
        rings.append([(x, -half, sheer), (x, -half * 0.96, chine), (x, 0.0, keel),
                      (x, half * 0.96, chine), (x, half, sheer)])
    geo.loft(bm, rings, closed=True, cap_start=True, cap_end=True)


def prop_rescue_boat(m: dict) -> bpy.types.Object:
    """A 12 m search-and-rescue boat: white hull with a blue boot stripe, an
    orange wheelhouse, a mast with radar and a blue beacon."""
    k = Kit("PROP_Boat_Rescue", m)
    length, beam = 12.0, 3.8
    _hull(k["panel"], length, beam, 1.1, 0.7)
    box(k["accent"], (-0.6, -beam / 2 - 0.01, 0.35), (length * 0.78, 0.04, 0.22))
    box(k["accent"], (-0.6, beam / 2 + 0.01, 0.35), (length * 0.78, 0.04, 0.22))
    slab(k["teak"], (-0.5, 0.0, 1.12), (length * 0.82, beam * 0.86, 0.06), cell=1.5)
    # Wheelhouse.
    slab(k["hull_orange"], (0.2, 0.0, 2.05), (4.2, 2.8, 1.8), cell=0.9)
    box(k["glass_dark"], (2.32, 0.0, 2.35), (0.05, 2.4, 0.75))
    for side in (-1, 1):
        box(k["glass_dark"], (0.2, side * 1.42, 2.35), (3.4, 0.05, 0.7))
    box(k["panel"], (0.2, 0.0, 3.0), (4.4, 3.0, 0.12))
    # Mast, radar, beacon.
    cylinder(k["galv"], (-0.6, 0.0, 4.1), 0.07, 2.2, 8)
    box(k["graphite"], (-0.6, 0.0, 4.6), (0.2, 1.6, 0.12))
    cylinder(k["accent"], (-0.6, 0.0, 5.3), 0.13, 0.22, 10)
    # Fenders along the sides.
    for x in (-3.5, -1.0, 1.5):
        for side in (-1, 1):
            box(k["hull_orange"], (x, side * (beam / 2 + 0.06), 0.85), (0.8, 0.14, 0.32))
    return k.finish(smooth_angle=50.0)


def prop_sailboat(m: dict) -> bpy.types.Object:
    """A 9 m sloop: white hull, teak deck, an 11 m mast with mainsail and jib."""
    k = Kit("PROP_Boat_Sail", m)
    length, beam = 9.0, 2.9
    _hull(k["panel"], length, beam, 0.75, 0.5)
    slab(k["teak"], (-0.3, 0.0, 0.78), (length * 0.8, beam * 0.8, 0.05), cell=1.5)
    box(k["panel"], (-0.6, 0.0, 1.1), (2.4, 1.7, 0.6))  # coachroof
    cylinder(k["galv"], (0.6, 0.0, 6.3), 0.06, 11.0, 8)  # mast
    lib.bm_bar(k["galv"], (0.6, 0.0, 2.0), (-3.2, 0.0, 2.0), 0.06, 0.06)  # boom
    # Sails as thin double-sided sheets.
    for verts_pos in (
        [(0.55, 0.02, 2.1), (-3.1, 0.02, 2.1), (0.55, 0.02, 11.4)],      # mainsail
        [(0.65, 0.02, 9.6), (4.3, 0.02, 1.0), (0.65, 0.02, 1.5)],        # jib
    ):
        front = [k["sail"].verts.new(p) for p in verts_pos]
        k["sail"].faces.new(front)
        back = [k["sail"].verts.new((x, -y, z)) for (x, y, z) in verts_pos]
        k["sail"].faces.new(list(reversed(back)))
    return k.finish(smooth_angle=50.0)


def build_all(m: dict) -> list[bpy.types.Object]:
    return [prop_lighthouse(m), prop_jetty(m), prop_lifeguard_tower(m), prop_rescue_boat(m), prop_sailboat(m)]
