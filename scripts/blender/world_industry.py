"""
CONTINUA world - the industrial corridor and the network infrastructure.

Halls, a tank farm, a pipe rack, a substation, transmission pylons and a stack
give the corridor the job the scenario says it has: industrial inspection.
The access-network structures - the dock, the Wi-Fi masts, the 5G macro site -
keep the node names the scene's site table and `world.json` already use, so a
better model drops into the same place without moving any network site.

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
# Halls
# ==========================================================================


def prop_warehouse(m: dict) -> bpy.types.Object:
    """A 48 x 32 m industrial hall with a sawtooth north-light roof, ribbed
    cladding, four roller doors on the +X front and an office annex."""
    k = Kit("PROP_Warehouse", m)
    L, D, H = 48.0, 32.0, 9.0
    slab(k["panel_grey"], (0.0, 0.0, H / 2), (D, L, H), cell=3.0)
    # Ribbed cladding on every face: vertical ribs read as profiled steel.
    for axis, offset, u0, u1 in (("+x", D / 2, -L / 2, L / 2), ("-x", D / 2, -L / 2, L / 2),
                                 ("+y", L / 2, -D / 2, D / 2), ("-y", L / 2, -D / 2, D / 2)):
        point = arch._wall_frame(axis, offset)
        count = int((u1 - u0) / 1.2)
        for i in range(count + 1):
            u = u0 + (u1 - u0) * i / count
            c = Vector(point(u, H / 2, 0.04))
            box(k["panel"], c, (0.08, 0.16, H) if axis[1] == "x" else (0.16, 0.08, H))
    box(k["accent"], (D / 2 + 0.1, 0.0, H - 1.2), (0.06, L, 0.35))
    # Sawtooth roof: teeth along x, glazed steep faces looking -X.
    teeth = 5
    tooth = D / teeth
    for i in range(teeth):
        x0 = -D / 2 + i * tooth
        bm = k["panel"]
        a = bm.verts.new((x0, -L / 2, H))
        b = bm.verts.new((x0 + tooth, -L / 2, H))
        c = bm.verts.new((x0 + tooth, -L / 2, H + 3.2))
        a2 = bm.verts.new((x0, L / 2, H))
        b2 = bm.verts.new((x0 + tooth, L / 2, H))
        c2 = bm.verts.new((x0 + tooth, L / 2, H + 3.2))
        bm.faces.new((a, c, c2, a2))                     # sloped roof plane
        bm.faces.new((a, b, c))
        bm.faces.new((a2, c2, b2))
        g = k["glass"]
        box(g, (x0 + tooth - 0.06, 0.0, H + 1.6), (0.1, L - 0.4, 3.0))
        for y in [-L / 2 + 2.0 * j for j in range(1, 24)]:
            box(k["graphite"], (x0 + tooth - 0.02, y, H + 1.6), (0.08, 0.08, 3.1))
    # Roller doors on the front.
    for y in (-16.0, -6.0, 4.0, 14.0):
        box(k["steel"], (D / 2 + 0.08, y, 2.6), (0.1, 5.0, 5.2))
        for z in [0.45 * j for j in range(1, 12)]:
            box(k["steel_dark"], (D / 2 + 0.14, y, z), (0.03, 5.0, 0.04))
        box(k["graphite"], (D / 2 + 0.2, y, 5.45), (0.4, 5.4, 0.5))
        for s in (-1, 1):
            cylinder(k["amber"], (D / 2 + 0.8, y + s * 2.8, 0.55), 0.12, 1.1, 10)
    # Office annex on the -y end.
    slab(k["panel"], (6.0, -L / 2 - 4.0, 3.5), (18.0, 8.0, 7.0), cell=3.0)
    for floor in range(2):
        arch.ribbon_windows(k, "+x", 15.0, -L / 2 - 7.5, -L / 2 - 0.5, 1.0 + floor * 3.3,
                            2.9 + floor * 3.3, pane=1.4)
    box(k["graphite"], (6.0, -L / 2 - 4.0, 7.05), (18.2, 8.2, 0.12))
    slab(k["concrete"], (D / 2 + 8.0, 0.0, 0.06), (16.0, L + 4.0, 0.12), cell=4.0)
    return k.finish(smooth_angle=30.0)


# ==========================================================================
# Tank farm
# ==========================================================================


def _tank(m: dict, name: str, radius: float, height: float, band: str = "accent",
          stair: bool = True) -> bpy.types.Object:
    k = Kit(name, m)
    seg = 40
    shell = [(radius, 0.0), (radius, height), (radius * 0.98, height + 0.15),
             (radius * 0.55, height + radius * 0.16), (0.0, height + radius * 0.2)]
    geo.revolve_profile(k["tank_white"], shell, seg, axis="Z", closed_section=False)
    cylinder(k["concrete"], (0, 0, 0.2), radius + 0.6, 0.4, seg)
    # Weld courses and a coloured band.
    for z in [height * j / 5 for j in range(1, 5)]:
        geo.revolve_profile(k["steel"], [(radius + 0.01, z - 0.03), (radius + 0.04, z - 0.03),
                                         (radius + 0.04, z + 0.03), (radius + 0.01, z + 0.03)],
                            seg, axis="Z")
    geo.revolve_profile(k[band], [(radius + 0.01, height * 0.72), (radius + 0.03, height * 0.72),
                                  (radius + 0.03, height * 0.72 + 0.9), (radius + 0.01, height * 0.72 + 0.9)],
                        seg, axis="Z")
    # Top railing.
    arch.railing(k, [((radius * 0.92) * math.cos(a), (radius * 0.92) * math.sin(a), height + 0.15)
                     for a in [2 * math.pi * i / 32 for i in range(33)]], height=1.0, post=3.0)
    if stair:
        steps = int(height / 0.22)
        for i in range(steps):
            t = i / steps
            a = -math.pi / 2 + t * math.pi * 0.9
            z = t * height
            r = radius + 0.55
            c = (r * math.cos(a), r * math.sin(a), z + 0.11)
            box(k["steel_dark"], c, (0.3, 0.9, 0.05), rotation=Matrix.Rotation(a, 4, "Z"))
        path = [((radius + 1.0) * math.cos(-math.pi / 2 + t * math.pi * 0.9),
                 (radius + 1.0) * math.sin(-math.pi / 2 + t * math.pi * 0.9), t * height + 1.0)
                for t in [i / 24 for i in range(25)]]
        geo.tube(k["galv"], path, 0.03, 6)
    return k.finish(smooth_angle=50.0)


def prop_tanks(m: dict) -> list[bpy.types.Object]:
    return [_tank(m, "PROP_Tank_Large", 8.0, 11.0), _tank(m, "PROP_Tank_Small", 4.0, 7.0, "amber")]


def prop_sphere_tank(m: dict) -> bpy.types.Object:
    """A pressurised sphere on eight legs with a ring girder and a stair."""
    k = Kit("PROP_Tank_Sphere", m)
    r, zc = 6.0, 9.0
    lib.bm_sphere(k["tank_white"], (0, 0, zc), r, 36, 18)
    for i in range(8):
        a = 2 * math.pi * i / 8
        x, y = (r - 0.3) * math.cos(a), (r - 0.3) * math.sin(a)
        cylinder(k["galv"], (x, y, zc / 2), 0.3, zc, 12)
        cylinder(k["concrete"], (x, y, 0.3), 0.6, 0.6, 12)
    for i in range(8):
        a0, a1 = 2 * math.pi * i / 8, 2 * math.pi * (i + 1) / 8
        p0 = ((r - 0.3) * math.cos(a0), (r - 0.3) * math.sin(a0), 3.0)
        p1 = ((r - 0.3) * math.cos(a1), (r - 0.3) * math.sin(a1), 6.0)
        arch.bar(k["galv"], p0, p1, 0.12, 0.12)
    geo.revolve_profile(k["accent"], [(r * 0.995, zc - 0.5), (r * 1.01, zc - 0.5),
                                      (r * 1.01, zc + 0.5), (r * 0.995, zc + 0.5)], 36, axis="Z")
    arch.stair_flight(k, (r + 1.5, -1.0, 0.0), (0.0, 1.0, 0.0), zc + r - 0.5, 40, width=0.9)
    return k.finish(smooth_angle=60.0)


# ==========================================================================
# Pipe rack, stack, substation, pylon
# ==========================================================================


def prop_pipe_rack(m: dict) -> bpy.types.Object:
    """One 12 m bay of a two-level pipe rack running along X. Instanced."""
    k = Kit("PROP_PipeRack", m)
    for y in (-2.2, 2.2):
        box(k["steel_dark"], (0.0, y, 3.2), (0.35, 0.35, 6.4))
        cylinder(k["concrete"], (0.0, y, 0.25), 0.5, 0.5, 10)
    for z in (4.0, 6.2):
        box(k["steel_dark"], (0.0, 0.0, z), (0.35, 4.8, 0.35))
    box(k["steel_dark"], (0.0, 0.0, 5.2), (0.2, 0.2, 2.0))
    pipes = (("galv", -1.6, 4.45, 0.30), ("tank_white", -0.7, 4.45, 0.42), ("accent", 0.4, 4.4, 0.25),
             ("amber", 1.2, 4.35, 0.18), ("galv", -1.0, 6.6, 0.45), ("steel", 0.6, 6.55, 0.38))
    for material, y, z, r in pipes:
        geo.tube(k[material], [(-6.0, y, z), (6.0, y, z)], r, 14, up_hint=(0.0, 0.0, 1.0), cap=False)
    return k.finish(smooth_angle=50.0)


def prop_stack(m: dict) -> bpy.types.Object:
    """A 48 m process stack with red/white aviation bands - a landmark."""
    k = Kit("PROP_Stack", m)
    h = 48.0
    for i in range(8):
        z0, z1 = h * i / 8, h * (i + 1) / 8
        r0, r1 = 2.2 - 0.9 * i / 8, 2.2 - 0.9 * (i + 1) / 8
        material = "signal_red" if i >= 5 and i % 2 == 1 else "tank_white"
        geo.revolve_profile(k[material], [(r0, z0), (r1, z1)], 32, axis="Z", closed_section=False)
    for z in (16.0, 32.0, h - 0.2):
        r = 2.2 - 0.9 * z / h
        arch.railing(k, [((r + 0.9) * math.cos(a), (r + 0.9) * math.sin(a), z)
                         for a in [2 * math.pi * i / 24 for i in range(25)]], height=1.0, post=2.0)
        geo.revolve_profile(k["steel_dark"], [(r, z - 0.1), (r + 1.0, z - 0.1), (r + 1.0, z), (r, z)],
                            32, axis="Z")
    cylinder(k["concrete"], (0, 0, 0.4), 3.4, 0.8, 32)
    return k.finish(smooth_angle=50.0)


def prop_substation(m: dict) -> bpy.types.Object:
    """A fenced 32 x 22 m yard: two transformers, gantries, a control house."""
    k = Kit("PROP_Substation", m)
    slab(k["concrete_warm"], (0.0, 0.0, 0.05), (34.0, 24.0, 0.1), cell=4.0)
    for y in (-5.0, 5.0):
        slab(k["panel_grey"], (2.0, y, 1.8), (5.0, 3.2, 3.2), cell=2.0)
        for i in range(8):                              # radiator fins
            box(k["steel"], (2.0 - 2.0 + i * 0.55, y + 2.0, 1.7), (0.08, 0.9, 2.6))
        for j in range(3):                              # bushings
            cylinder(k["tank_white"], (0.8 + j * 1.2, y, 3.9), 0.12, 1.4, 8)
            for z in (3.4, 3.7, 4.0, 4.3):
                cylinder(k["tank_white"], (0.8 + j * 1.2, y, z), 0.22, 0.08, 10)
    for x in (-10.0, -3.0, 9.0):
        for y in (-9.0, 9.0):
            arch.lattice(k, 9.0, 0.45, 0.35, 3, leg=0.1, brace=0.04, origin=(x, y))
        box(k["galv"], (x, 0.0, 9.0), (0.5, 18.5, 0.5))
        for y in (-4.0, 0.0, 4.0):
            for z in (8.2, 8.0, 7.8, 7.6):
                cylinder(k["tank_white"], (x, y, z), 0.18, 0.06, 10)
    for y in (-4.0, 0.0, 4.0):
        geo.tube(k["steel"], [(-10.0, y, 7.6), (9.0, y, 7.6)], 0.05, 6)
    slab(k["panel"], (-12.5, 0.0, 2.0), (6.0, 8.0, 4.0), cell=2.0)
    arch.door(k, "+x", -9.5, 2.0, 1.1, 2.3)
    box(k["graphite"], (-12.5, 0.0, 4.06), (6.3, 8.3, 0.12))
    arch.railing(k, [(-17.0, -12.0, 0.1), (17.0, -12.0, 0.1), (17.0, 12.0, 0.1), (-17.0, 12.0, 0.1),
                     (-17.0, -12.0, 0.1)], height=2.4, post=3.0)
    return k.finish(smooth_angle=40.0)


def prop_pylon(m: dict) -> bpy.types.Object:
    """A 34 m lattice transmission tower; arms along Y carry the conductors."""
    k = Kit("PROP_Pylon", m)
    arch.lattice(k, 26.0, 3.2, 1.0, 7, leg=0.22, brace=0.08)
    arch.lattice(k, 8.0, 1.0, 0.45, 3, leg=0.16, brace=0.06, z0=26.0)
    for z, half in ((22.0, 6.5), (27.5, 5.0), (31.5, 3.6)):
        for s in (-1, 1):
            arch.bar(k["galv"], (0.0, s * 1.0, z), (0.0, s * half, z), 0.2, 0.25)
            arch.bar(k["galv"], (0.0, s * 1.0, z - 1.8), (0.0, s * half, z), 0.1, 0.1)
            for i in range(5):
                cylinder(k["tank_white"], (0.0, s * (half - 0.2), z - 0.4 - i * 0.28), 0.16, 0.06, 10)
    for sx, sy in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
        cylinder(k["concrete"], (sx * 3.2, sy * 3.2, 0.3), 0.7, 0.6, 10)
    return k.finish(smooth_angle=50.0)


# Conductor attachment points, for the runtime to string catenaries between
# pylons. (y, z) in the pylon's local frame.
PYLON_CONDUCTORS = ((-6.3, 20.6), (6.3, 20.6), (-4.8, 26.1), (4.8, 26.1), (-3.4, 30.1), (3.4, 30.1))


# ==========================================================================
# Access-network structures (node names are a contract with sites.ts)
# ==========================================================================


def prop_cell_tower(m: dict) -> bpy.types.Object:
    """5G macro site: a 26 m lattice with three sectors, microwave dishes, a
    cable ladder, equipment cabinets and a compound fence. Beam attaches at
    25.5 m (sites.ts linkHeight)."""
    k = Kit("PROP_CellTower", m)
    h = 24.0
    arch.lattice(k, h, 1.8, 0.65, 8, leg=0.17, brace=0.06)
    box(k["galv"], (0.0, 0.0, h + 0.1), (3.2, 3.2, 0.2))
    arch.railing(k, [(-1.6, -1.6, h + 0.2), (1.6, -1.6, h + 0.2), (1.6, 1.6, h + 0.2),
                     (-1.6, 1.6, h + 0.2), (-1.6, -1.6, h + 0.2)], height=1.0, post=1.6)
    for index in range(3):
        a = math.radians(90 + index * 120)
        cx, cy = 1.8 * math.cos(a), 1.8 * math.sin(a)
        arch.bar(k["galv"], (cx * 0.4, cy * 0.4, h + 1.2), (cx, cy, h + 1.2), 0.1, 0.1)
        for off in (-0.45, 0.45):
            px = cx + off * math.cos(a + math.pi / 2)
            py = cy + off * math.sin(a + math.pi / 2)
            box(k["tank_white"], (px, py, h + 1.6), (0.18, 0.36, 1.9), rotation=Matrix.Rotation(a, 4, "Z"))
        box(k["accent"], (cx * 1.12, cy * 1.12, h + 2.6), (0.05, 0.6, 0.06), rotation=Matrix.Rotation(a, 4, "Z"))
    for z, yaw in ((19.0, 0.6), (17.5, 2.6)):
        x, y = 0.95 * math.cos(yaw), 0.95 * math.sin(yaw)
        dish = bmesh.new()
        # A microwave drum: domed back toward the mast, flat radome facing out.
        geo.revolve_profile(dish, [(0.0, -0.32), (0.35, -0.26), (0.55, -0.1), (0.6, 0.0), (0.0, 0.0)], 20,
                            axis="Y")
        bmesh.ops.rotate(dish, verts=dish.verts[:], cent=(0, 0, 0),
                         matrix=Matrix.Rotation(yaw - math.pi / 2, 3, "Z"))
        bmesh.ops.translate(dish, verts=dish.verts[:], vec=(x, y, z))
        mesh = bpy.data.meshes.new("tmp_dish")
        dish.to_mesh(mesh)
        dish.free()
        k["tank_white"].from_mesh(mesh)
        bpy.data.meshes.remove(mesh)
    box(k["steel_dark"], (0.0, -0.75, h / 2), (0.35, 0.06, h))             # cable ladder
    cylinder(k["galv"], (0.0, 0.0, h + 3.3), 0.06, 2.4, 8)
    lib.bm_sphere(k["signal_red"], (0.0, 0.0, h + 4.6), 0.18, 12, 6)
    # Compound: pad, two cabinets, fence.
    slab(k["concrete"], (0.0, 0.0, 0.08), (11.0, 11.0, 0.16), cell=3.0)
    for x in (-3.6, -1.4):
        slab(k["panel"], (x, 3.6, 1.0), (1.6, 1.2, 1.9), cell=1.0)
        box(k["graphite"], (x, 3.6, 1.98), (1.7, 1.3, 0.06))
    arch.railing(k, [(-5.4, -5.4, 0.16), (5.4, -5.4, 0.16), (5.4, 5.4, 0.16), (-5.4, 5.4, 0.16),
                     (-5.4, -5.4, 0.16)], height=2.2, post=2.7)
    return k.finish(smooth_angle=45.0)


def prop_wifi_mast(m: dict) -> bpy.types.Object:
    """Yard Wi-Fi mast: a 6.6 m pole, two sector APs on a crossarm, an omni
    on top. Beam attaches at 6.6 m (sites.ts linkHeight)."""
    k = Kit("PROP_WifiMast", m)
    cylinder(k["concrete"], (0, 0, 0.2), 0.5, 0.4, 16)
    geo.sweep(k["galv"], geo.circle(0.11, 12), [(0, 0, 0.35), (0, 0, 6.3)], scale=lambda t: 1.15 - 0.3 * t)
    box(k["galv"], (0.0, 0.0, 6.05), (0.12, 1.6, 0.1))
    for y in (-0.7, 0.7):
        slab(k["tank_white"], (0.08, y, 5.75), (0.14, 0.34, 0.55), cell=0.5)
        box(k["accent_cyan"], (0.16, y, 5.6), (0.02, 0.2, 0.03))
    cylinder(k["tank_white"], (0, 0, 6.5), 0.16, 0.4, 14)
    cylinder(k["accent_cyan"], (0, 0, 6.72), 0.07, 0.05, 10)
    slab(k["panel_grey"], (0.25, 0.0, 1.6), (0.25, 0.5, 0.7), cell=0.5)        # power/PoE box
    return k.finish(smooth_angle=45.0)


def prop_dock_station(m: dict) -> bpy.types.Object:
    """The wired dock: a portal gantry over the docking bay with the tether
    head hanging from its beam, a data/power pillar with a screen, and a
    utility cabinet at the site origin.

    The rover parks 7 m from the site origin (world.json puts the dock at
    (-24, 7) and the route starts at (-26, 0)), so the bay is authored at
    DOCK_BAY = (2.0, -7.0): with the site's yaw of pi that lands on the
    parking spot. The scene attaches the wired tether at DOCK_TETHER.
    """
    k = Kit("PROP_DockStation", m)
    cx, cy = DOCK_BAY
    # Bay pad with cyan lane markings; the rover's long axis runs along X.
    slab(k["concrete"], (cx, cy, 0.05), (8.6, 5.4, 0.1), cell=2.0)
    for y in (cy - 2.2, cy + 2.2):
        box(k["accent_cyan"], (cx, y, 0.105), (7.6, 0.12, 0.012))
    for x in (cx - 3.9, cx + 3.9):
        box(k["accent_cyan"], (x, cy, 0.105), (0.12, 4.5, 0.012))
    # Portal gantry across the bay.
    gx = cx + 0.4
    for y in (cy - 2.7, cy + 2.7):
        slab(k["panel"], (gx, y, 2.25), (0.45, 0.45, 4.5), cell=1.5)
        box(k["accent_cyan"], (gx + 0.23, y, 2.6), (0.02, 0.2, 1.2))
    slab(k["panel"], (gx, cy, 4.6), (0.6, 6.0, 0.4), cell=1.5)
    # Light strip under the beam. No canopy: the rover stands in daylight
    # while docked, which is when it is inspected.
    box(k["lamp"], (gx, cy, 4.39), (0.3, 5.0, 0.02))
    box(k["accent_cyan"], (gx + 0.31, cy, 4.6), (0.02, 5.2, 0.1))
    # Tether head hanging over the rover's roof port.
    tx, ty, tz = DOCK_TETHER
    geo.tube(k["galv"], [(tx, ty, 4.4), (tx, ty, tz + 0.25)], 0.05, 8)
    slab(k["panel_grey"], (tx, ty, tz + 0.12), (0.36, 0.36, 0.26), cell=0.5)
    cylinder(k["accent_cyan"], (tx, ty, tz - 0.03), 0.07, 0.06, 12)
    # Data/power pillar beside the bay, screen facing the bay.
    px, py = cx - 2.6, cy + 3.3
    slab(k["panel_grey"], (px, py, 1.25), (0.8, 0.7, 2.5), cell=1.0)
    box(k["glass_dark"], (px, py - 0.36, 1.6), (0.55, 0.03, 0.42))
    box(k["accent_cyan"], (px, py, 2.54), (0.85, 0.75, 0.08))
    # Utility cabinet at the site origin, with a cable trench to the bay.
    slab(k["panel"], (0.0, 0.0, 0.9), (1.4, 0.8, 1.8), cell=1.0)
    box(k["graphite"], (0.0, 0.0, 1.83), (1.5, 0.9, 0.06))
    box(k["steel_dark"], ((0.0 + px) / 2, (0.0 + py) / 2, 0.02), (0.5, abs(py) + 0.5, 0.04))
    for x, y in ((cx + 4.6, cy - 3.0), (cx + 4.6, cy + 3.0), (cx - 4.6, cy - 3.0)):
        cylinder(k["graphite"], (x, y, 0.5), 0.1, 1.0, 10)
        cylinder(k["amber"], (x, y, 0.95), 0.102, 0.08, 10)
    return k.finish(smooth_angle=45.0)


# Where the rover parks relative to the dock site origin, and where the
# tether head hangs - both in the prop's authored frame (Blender x, y, z).
DOCK_BAY = (2.0, -7.0)
DOCK_TETHER = (2.4, -7.0, 3.6)


# ==========================================================================
# Yard dressing
# ==========================================================================


def prop_container(m: dict) -> bpy.types.Object:
    k = Kit("PROP_Container", m)
    length, width, height = 6.06, 2.44, 2.59
    slab(k["panel_grey"], (0, 0, height / 2), (length, width, height), cell=1.5)
    for i in range(14):
        x = -length / 2 + 0.3 + i * 0.42
        for s in (-1, 1):
            box(k["panel"], (x, s * (width / 2 + 0.02), height / 2), (0.14, 0.05, height - 0.3))
    for sx in (-1, 1):
        for sy in (-1, 1):
            box(k["steel_dark"], (sx * (length / 2 - 0.09), sy * (width / 2 - 0.06), height / 2),
                (0.2, 0.16, height + 0.04))
    box(k["steel_dark"], (0, 0, height + 0.03), (length + 0.04, width + 0.04, 0.1))
    box(k["steel_dark"], (0, 0, 0.06), (length + 0.04, width + 0.04, 0.12))
    for z in (0.6, 1.9):
        box(k["galv"], (length / 2 + 0.05, -0.5, z), (0.04, 0.06, 0.05))
        box(k["galv"], (length / 2 + 0.05, 0.5, z), (0.04, 0.06, 0.05))
    return k.finish(smooth_angle=40.0)


def prop_barrier(m: dict) -> bpy.types.Object:
    """Jersey barrier, 3 m, running along X."""
    k = Kit("PROP_Barrier", m)
    profile = [(-0.30, 0.0), (0.30, 0.0), (0.22, 0.14), (0.12, 0.55), (0.10, 0.92),
               (-0.10, 0.92), (-0.12, 0.55), (-0.22, 0.14)]
    rings = [[(x, u, v) for (u, v) in profile] for x in (-1.5, 1.5)]
    geo.loft(k["concrete"], rings, closed=True, cap_start=True, cap_end=True)
    box(k["accent"], (0.0, 0.0, 0.70), (2.4, 0.235, 0.12))
    return k.finish(smooth_angle=40.0)


def prop_road_sign(m: dict) -> bpy.types.Object:
    """A route sign; face normal on +X."""
    k = Kit("PROP_RoadSign", m)
    for y in (-0.5, 0.5):
        cylinder(k["galv"], (0, y, 1.5), 0.05, 3.0, 8)
    slab(k["accent"], (0.04, 0.0, 2.5), (0.05, 1.6, 0.9), cell=1.0)
    box(k["paint_line"], (0.07, 0.0, 2.5), (0.01, 1.5, 0.8))
    box(k["accent"], (0.075, 0.0, 2.5), (0.01, 1.4, 0.7))
    box(k["paint_line"], (0.08, 0.15, 2.5), (0.01, 0.8, 0.12))
    box(k["paint_line"], (0.08, -0.38, 2.5), (0.01, 0.12, 0.5))
    return k.finish()


def _tower(m: dict, name: str, w: float, d: float, h: float, crown: float,
           setback: float | None = None) -> bpy.types.Object:
    """Distant city tower: banded glass and panel, very few triangles.
    Seen through 600 m of haze, bands are all the detail that survives."""
    k = Kit(name, m)
    floors = int(h / 4.0)
    for i in range(floors):
        z0 = i * 4.0
        sx, sy = w, d
        if setback and z0 > setback:
            sx, sy = w * 0.78, d * 0.78
        box(k["tower_glass"], (0, 0, z0 + 2.0), (sx, sy, 3.0))
        box(k["tower_panel"], (0, 0, z0 + 3.5), (sx + 0.4, sy + 0.4, 1.0))
    top = floors * 4.0
    box(k["tower_panel"], (0, 0, top + crown / 2), (w * 0.6, d * 0.6, crown))
    cylinder(k["galv"], (0, 0, top + crown + 6.0), 0.3, 12.0, 6)
    return k.finish(smooth_angle=20.0)


def prop_skyline(m: dict) -> list[bpy.types.Object]:
    return [
        _tower(m, "PROP_Skyline_A", 34.0, 30.0, 140.0, 10.0, setback=96.0),
        _tower(m, "PROP_Skyline_B", 26.0, 26.0, 104.0, 6.0),
        _tower(m, "PROP_Skyline_C", 44.0, 22.0, 72.0, 4.0),
    ]


def build_all(m: dict) -> list[bpy.types.Object]:
    out = [prop_warehouse(m), prop_sphere_tank(m), prop_pipe_rack(m), prop_stack(m),
           prop_substation(m), prop_pylon(m), prop_cell_tower(m), prop_wifi_mast(m),
           prop_dock_station(m), prop_container(m), prop_barrier(m), prop_road_sign(m)]
    out += prop_tanks(m)
    out += prop_skyline(m)
    return out
