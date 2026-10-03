"""
CONTINUA world - the operations campus.

Buildings and dressing for the facility zone: the operations centre the
session gateway lives in, the gateway data hall itself, the service hangar,
the response station, the gatehouse the route leaves through, and the
carports, cars, fences and trees that make it a place people work.

Every builder returns one finished object named PROP_*, authored at the
origin with its base on z = 0 and its FRONT facing +X.
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
# Operations centre
# ==========================================================================


def prop_hq(m: dict) -> bpy.types.Object:
    """Three-storey operations centre, 42 m long, front (+X) facing the route.

    Ground floor is a recessed glass colonnade under a 1.5 m overhang; two
    white upper floors carry ribbon glazing behind vertical fins; a graphite
    stair/lift core rises above the roof at one end and carries the name; a
    projecting glass lobby sits under a deep entrance canopy.
    """
    k = Kit("PROP_HQ", m)
    L, D = 42.0, 18.0                      # length along y, depth along x
    gf, ff = 4.6, 4.1                      # ground and upper floor heights
    top = gf + 2 * ff                      # 12.8 m
    # --- ground floor: recessed glass box and columns ----------------------
    slab(k["panel_grey"], (-1.2, 0.0, gf / 2), (D - 2.4, L - 0.8, gf), cell=3.0)
    arch.curtain_wall(k, "+x", D / 2 - 1.5, -L / 2 + 1.0, L / 2 - 1.0, 0.0, gf - 0.25,
                      mullion=1.6, transom=2.2, glass="glass_dark")
    for y in [-L / 2 + 1.5 + 6.0 * i for i in range(7)]:
        cylinder(k["panel"], (D / 2 - 0.6, y, gf / 2), 0.32, gf, 16)
    # --- upper floors: white volume with ribbon windows and fins ------------
    slab(k["panel"], (0.0, 0.0, gf + ff), (D, L, 2 * ff), cell=3.0)
    for floor in range(2):
        z0 = gf + floor * ff + 0.95
        z1 = z0 + 2.35
        for axis in ("+x", "-x"):
            arch.ribbon_windows(k, axis, D / 2, -L / 2 + 1.2, L / 2 - 1.2, z0, z1, pane=1.5)
        for axis in ("+y", "-y"):
            arch.ribbon_windows(k, axis, L / 2, -D / 2 + 2.0, D / 2 - 2.0, z0, z1, pane=1.5)
    arch.fins(k, "+x", D / 2, -L / 2 + 1.0, L / 2 - 1.0, gf + 0.4, top - 0.3, spacing=1.5,
              depth=0.6, thickness=0.14, material="panel")
    # Slab edges read as thin graphite bands between floors.
    for z in (gf, gf + ff):
        box(k["graphite"], (0.0, 0.0, z), (D + 0.12, L + 0.12, 0.18))
    box(k["concrete"], (0.0, 0.0, top), (D + 0.12, L + 0.12, 0.18))    # roof membrane
    arch.parapet(k, 0.0, 0.0, D, L, top, height=0.9)
    # --- the core: graphite tower at the +y end, carrying the name ----------
    core_y = L / 2 - 3.2
    slab(k["graphite"], (1.0, core_y, (top + 4.2) / 2), (8.0, 6.4, top + 4.2), cell=3.0)
    arch.curtain_wall(k, "+x", 5.0, core_y - 1.0, core_y + 1.0, 1.0, top + 3.4, mullion=2.0,
                      transom=1.4, glass="glass", frame="graphite")
    box(k["panel"], (1.0, core_y, top + 4.35), (8.3, 6.7, 0.3))
    # --- entrance: projecting glass lobby + canopy --------------------------
    lob_x = D / 2 + 1.6
    slab(k["glass"], (lob_x, -4.0, 4.2), (3.2, 12.0, 8.4), cell=4.0)
    for y in [-10.0 + 1.5 * i for i in range(9)]:
        box(k["graphite"], (lob_x + 1.62, y, 4.2), (0.12, 0.10, 8.4))
    for z in (2.8, 5.6, 8.4):
        box(k["graphite"], (lob_x + 1.62, -4.0, z), (0.12, 12.0, 0.12))
    box(k["panel"], (lob_x + 3.5, -4.0, 5.1), (7.0, 16.0, 0.55))           # canopy
    box(k["graphite"], (lob_x + 7.0, -4.0, 5.1), (0.2, 16.1, 0.62))        # fascia
    for y in (-10.5, 2.5):
        cylinder(k["steel"], (lob_x + 6.4, y, 2.4), 0.16, 4.8, 12)
    door = arch.door
    door(k, "+x", lob_x + 1.6, -4.0, 3.6, 3.0, material="glass_dark")
    # Entrance plaza and steps.
    slab(k["concrete"], (lob_x + 5.0, -4.0, 0.08), (10.0, 22.0, 0.16), cell=4.0)
    # --- roof: plant enclosure, solar rows, comms mast ----------------------
    slab(k["panel_grey"], (-3.0, -11.0, top + 1.4), (8.0, 9.0, 2.8), cell=3.0)
    arch.louvres(k, "+x", 1.0, -15.0, -7.0, top + 0.4, top + 2.4)
    for row in range(4):
        x = -6.5 + row * 3.0
        tilt = Matrix.Rotation(math.radians(-18), 4, "Y")
        box(k["solar"], (x, 1.0, top + 1.0), (2.2, 14.0, 0.06), rotation=tilt)
        box(k["galv"], (x - 0.6, 1.0, top + 0.5), (0.1, 14.0, 0.9))
    # Comms mast on top of the core, with two microwave dishes and a whip.
    mast_x, mast_y, mast_z = 1.0, core_y, top + 4.5
    arch.lattice(k, 8.0, 0.5, 0.25, 4, leg=0.12, brace=0.05, z0=mast_z, origin=(mast_x, mast_y))
    for z, yaw in ((mast_z + 5.0, 0.4), (mast_z + 6.5, -0.9)):
        cylinder(k["panel"], (mast_x + 0.6 * math.cos(yaw), mast_y + 0.6 * math.sin(yaw), z), 0.45,
                 0.25, 18, axis="X")
    cylinder(k["galv"], (mast_x, mast_y, mast_z + 10.0), 0.03, 4.0, 6)
    # --- signage --------------------------------------------------------------
    hq = k.finish(smooth_angle=30.0)
    sign = arch.sign_text("PROP_HQ_sign", "CONTINUA", (lob_x + 7.13, -4.0, 5.12), arch.FACING["+x"],
                          0.42, m["accent"], extrude=0.04)
    sub = arch.sign_text("PROP_HQ_sub", "OPERATIONS CENTRE", (D / 2 + 0.05, -8.0, top + 0.45),
                         arch.FACING["+x"], 0.5, m["graphite"], extrude=0.03)
    return arch.attach(hq, [sign, sub])


def prop_flagpole(m: dict) -> bpy.types.Object:
    """A 10 m flagpole flying a white CONTINUA flag with a blue band."""
    k = Kit("PROP_Flagpole", m)
    cylinder(k["concrete"], (0, 0, 0.15), 0.45, 0.3, 16)
    cylinder(k["galv"], (0, 0, 5.15), 0.07, 10.0, 10)
    lib.bm_sphere(k["galv"], (0, 0, 10.2), 0.1, 10, 6)
    # A flag with a little wind in it: a strip displaced by a travelling sine.
    for material, (v0, v1) in (("fabric", (0.0, 0.9)), ("accent", (0.9, 1.25))):
        rings = []
        cols = 14
        for i in range(cols + 1):
            u = i / cols
            x = 0.08 + u * 2.4
            wave = 0.18 * math.sin(u * math.pi * 1.6) * u
            rings.append([(x, wave + 0.0, 9.9 - v0), (x, wave + 0.0, 9.9 - v1)])
        bm = k[material]
        grid = [[bm.verts.new(p) for p in r] for r in rings]
        for a, b in zip(grid, grid[1:]):
            bm.faces.new((a[0], b[0], b[1], a[1]))
    return k.finish()


# ==========================================================================
# Gateway data hall - where all four links terminate
# ==========================================================================


def prop_gateway(m: dict) -> bpy.types.Object:
    """The session gateway: a windowless data hall with plant on the roof and
    a generator yard. Front (+X) carries the loading door and the sign."""
    k = Kit("PROP_Gateway", m)
    L, D, H = 30.0, 16.0, 7.6
    slab(k["panel_grey"], (0.0, 0.0, H / 2), (D, L, H), cell=3.0)
    # Precast panel joints.
    for y in [-L / 2 + 3.0 * i for i in range(1, 10)]:
        for axis_x in (D / 2 + 0.02, -D / 2 - 0.02):
            box(k["graphite"], (axis_x, y, H / 2), (0.05, 0.06, H))
    for x in [-D / 2 + 4.0 * i for i in range(1, 4)]:
        for axis_y in (L / 2 + 0.02, -L / 2 - 0.02):
            box(k["graphite"], (x, axis_y, H / 2), (0.06, 0.05, H))
    # Louvre band near the top on every face.
    arch.louvres(k, "+x", D / 2, -L / 2 + 1.5, L / 2 - 1.5, H - 2.2, H - 0.8)
    arch.louvres(k, "-x", D / 2, -L / 2 + 1.5, L / 2 - 1.5, H - 2.2, H - 0.8)
    arch.louvres(k, "+y", L / 2, -D / 2 + 1.5, D / 2 - 1.5, H - 2.2, H - 0.8)
    arch.louvres(k, "-y", L / 2, -D / 2 + 1.5, D / 2 - 1.5, H - 2.2, H - 0.8)
    box(k["accent"], (D / 2 + 0.03, 0.0, H - 2.6), (0.04, L, 0.12))      # blue datum line
    arch.door(k, "+x", D / 2, -6.0, 4.0, 4.4, material="steel_dark", panel_lines=6)
    arch.door(k, "+x", D / 2, 2.0, 1.2, 2.3, material="graphite")
    box(k["graphite"], (D / 2 + 1.2, -6.0, 4.75), (2.6, 5.2, 0.25))      # door canopy
    arch.parapet(k, 0.0, 0.0, D, L, H, height=0.7, material="panel_grey")
    # Roof chillers: two rows of fan units.
    for row, x in enumerate((-3.5, 3.5)):
        for i in range(4):
            y = -10.5 + i * 7.0
            slab(k["panel"], (x, y, H + 1.0), (2.6, 5.6, 2.0), cell=2.0)
            for fy in (-1.3, 1.3):
                cylinder(k["graphite"], (x, y + fy, H + 2.02), 1.0, 0.06, 20)
                cylinder(k["steel_dark"], (x, y + fy, H + 2.06), 0.18, 0.08, 10)
    # Cable tray from the roof down to the yard.
    box(k["galv"], (0.0, L / 2 + 0.5, H - 0.4), (1.0, 1.0, 0.2))
    # Generator yard on the +y end: two gensets, a fuel tank, a fence.
    for gx in (-3.5, 3.0):
        slab(k["panel"], (gx, L / 2 + 6.0, 1.45), (5.6, 2.5, 2.6), cell=2.0)
        box(k["graphite"], (gx, L / 2 + 6.0, 2.85), (5.4, 2.3, 0.2))
        cylinder(k["steel_dark"], (gx + 2.0, L / 2 + 6.0, 3.6), 0.18, 1.5, 10)
    cylinder(k["tank_white"], (0.0, L / 2 + 11.0, 1.4), 1.2, 4.6, 20, axis="X")
    slab(k["concrete"], (0.0, L / 2 + 7.0, 0.08), (D + 2.0, 14.0, 0.16), cell=4.0)
    arch.railing(k, [(-D / 2 - 1, L / 2 + 0.2, 0.16), (-D / 2 - 1, L / 2 + 13.8, 0.16),
                     (D / 2 + 1, L / 2 + 13.8, 0.16), (D / 2 + 1, L / 2 + 0.2, 0.16)],
                 height=2.2, post=2.5)
    gw = k.finish(smooth_angle=30.0)
    sign = arch.sign_text("PROP_Gateway_sign", "SESSION GATEWAY", (D / 2 + 0.06, 6.5, 5.0),
                          arch.FACING["+x"], 0.62, m["graphite"], extrude=0.03)
    logo = arch.sign_text("PROP_Gateway_logo", "CONTINUA", (D / 2 + 0.06, 6.5, 4.15),
                          arch.FACING["+x"], 0.42, m["accent"], extrude=0.03)
    return arch.attach(gw, [sign, logo])


# ==========================================================================
# Service hangar
# ==========================================================================


def prop_hangar(m: dict) -> bpy.types.Object:
    """Barrel-vault vehicle hangar, door in the +X gable, ribs over the vault,
    a skylight along the crown and a lean-to workshop on the -y side."""
    k = Kit("PROP_Hangar", m)
    span, length, wall = 24.0, 34.0, 5.0
    rise = 6.0
    half = span / 2
    radius = (half ** 2 + rise ** 2) / (2 * rise)
    centre_z = wall + rise - radius

    def roof_z(y):
        return centre_z + math.sqrt(max(0.0, radius ** 2 - y ** 2))

    # Walls.
    for s in (-1, 1):
        slab(k["panel_grey"], (0.0, s * (half - 0.15), wall / 2), (length, 0.3, wall), cell=3.0)
    # Vault: a lofted shell along x.
    seg = 28
    outer = [(-half + span * i / seg, 0.0) for i in range(seg + 1)]
    for i, (y, _) in enumerate(outer):
        outer[i] = (y, roof_z(y))
    rings = []
    for x in (-length / 2, length / 2):
        ring = [(x, y, z) for (y, z) in outer] + [(x, y, z - 0.25) for (y, z) in reversed(outer)]
        rings.append(ring)
    geo.loft(k["panel"], rings, closed=True, cap_start=True, cap_end=True)
    # Skylight strip along the crown and external ribs every 4 m.
    box(k["glass"], (0.0, 0.0, roof_z(0.0) + 0.06), (length - 1.0, 2.6, 0.12))
    for x in [-length / 2 + 0.3 + 4.2 * i for i in range(9)]:
        path = [(x, y, roof_z(y) + 0.18) for y in [-half + span * i / 16 for i in range(17)]]
        geo.sweep(k["graphite"], geo.rounded_rect(0.24, 0.3, 0.05, 1), path,
                  up_hint=(1.0, 0.0, 0.0))
    # Gable ends: filled walls under the arch.
    for s, axis in ((1, "+x"), (-1, "-x")):
        x = s * (length / 2 - 0.1)
        prof = [(y, roof_z(y)) for y in [-half + span * i / seg for i in range(seg + 1)]]
        bm = k["panel_grey"]
        verts = [bm.verts.new((x, -half, 0.0))] + [bm.verts.new((x, y, z)) for (y, z) in prof] \
            + [bm.verts.new((x, half, 0.0))]
        bm.faces.new(verts if s > 0 else list(reversed(verts)))
    # The door: big sectional panels with horizontal joints.
    door_w, door_h = 16.0, 8.2
    box(k["steel"], (length / 2 + 0.02, 0.0, door_h / 2), (0.12, door_w, door_h))
    for i in range(1, 12):
        z = door_h * i / 12
        box(k["steel_dark"], (length / 2 + 0.09, 0.0, z), (0.04, door_w, 0.05))
    box(k["graphite"], (length / 2 + 0.15, 0.0, door_h + 0.3), (0.3, door_w + 1.0, 0.6))
    for s in (-1, 1):
        box(k["amber"], (length / 2 + 0.3, s * (door_w / 2 + 0.6), 0.6), (0.3, 0.3, 1.2))
    arch.door(k, "+x", length / 2, -door_w / 2 - 2.0, 1.1, 2.3, material="graphite")
    # Lean-to workshop on the -y side.
    slab(k["panel"], (2.0, -half - 3.0, 2.0), (20.0, 6.0, 4.0), cell=3.0)
    arch.ribbon_windows(k, "-y", half + 6.0, -6.0, 10.0, 1.2, 3.2, pane=1.6)
    box(k["graphite"], (2.0, -half - 3.0, 4.06), (20.3, 6.3, 0.12))
    # Apron.
    slab(k["concrete"], (length / 2 + 9.0, 0.0, 0.06), (18.0, span + 4.0, 0.12), cell=4.0)
    hangar = k.finish(smooth_angle=40.0)
    sign = arch.sign_text("PROP_Hangar_sign", "SERVICE BAY", (length / 2 + 0.32, 0.0, door_h + 0.32),
                          arch.FACING["+x"], 0.42, m["panel"], extrude=0.03)
    return arch.attach(hangar, [sign])


# ==========================================================================
# Response station
# ==========================================================================


def prop_response_station(m: dict) -> bpy.types.Object:
    """Three-bay response station with a crew block and a drill tower."""
    k = Kit("PROP_ResponseStation", m)
    # Apparatus bays.
    bay_l, bay_d, bay_h = 22.0, 16.0, 8.0
    slab(k["panel"], (0.0, -4.0, bay_h / 2), (bay_d, bay_l, bay_h), cell=3.0)
    for i in range(3):
        y = -4.0 - 7.0 + i * 7.0
        box(k["glass_dark"], (bay_d / 2 + 0.02, y, 3.0), (0.08, 4.6, 6.0))
        for z in [0.75 * j for j in range(1, 8)]:
            box(k["galv"], (bay_d / 2 + 0.07, y, z), (0.04, 4.6, 0.07))
        for s in (-1, 1):
            box(k["graphite"], (bay_d / 2 + 0.08, y + s * 2.35, 3.05), (0.14, 0.14, 6.1))
        box(k["graphite"], (bay_d / 2 + 0.08, y, 6.1), (0.14, 4.84, 0.14))
    box(k["accent"], (bay_d / 2 + 0.05, -4.0, 6.85), (0.06, bay_l, 0.5))     # blue band
    box(k["graphite"], (0.0, -4.0, bay_h), (bay_d + 0.12, bay_l + 0.12, 0.2))
    # Crew block: two storeys with windows.
    crew_l = 12.0
    slab(k["panel_grey"], (0.0, 13.0, 4.3), (bay_d, crew_l, 8.6), cell=3.0)
    for floor in range(2):
        z0 = 1.0 + floor * 4.2
        arch.ribbon_windows(k, "+x", bay_d / 2, 8.0, 18.0, z0, z0 + 2.2, pane=1.25)
        arch.ribbon_windows(k, "+y", 19.0, -6.0, 6.0, z0, z0 + 2.2, pane=1.5)
    box(k["graphite"], (0.0, 13.0, 8.6), (bay_d + 0.12, crew_l + 0.12, 0.2))
    arch.parapet(k, 0.0, 13.0, bay_d, crew_l, 8.6, height=0.8, material="panel_grey")
    # Drill / lookout tower at the back corner.
    slab(k["panel"], (-5.0, 15.0, 8.5), (4.0, 4.0, 17.0), cell=3.0)
    for z in (5.0, 9.0, 13.0):
        box(k["glass_dark"], (-2.98, 15.0, z), (0.06, 1.2, 1.8))
    box(k["accent"], (-5.0, 15.0, 16.4), (4.1, 4.1, 0.4))
    box(k["graphite"], (-5.0, 15.0, 17.1), (4.6, 4.6, 0.2))
    # Forecourt.
    slab(k["concrete"], (bay_d / 2 + 7.0, 0.0, 0.06), (14.0, 36.0, 0.12), cell=4.0)
    for i in range(3):
        y = -11.0 + i * 7.0
        box(k["paint_line"], (bay_d / 2 + 7.0, y - 2.6, 0.13), (14.0, 0.15, 0.02))
        box(k["paint_line"], (bay_d / 2 + 7.0, y + 2.6, 0.13), (14.0, 0.15, 0.02))
    station = k.finish(smooth_angle=30.0)
    sign = arch.sign_text("PROP_Response_sign", "RESPONSE STATION", (bay_d / 2 + 0.1, -4.0, 7.55),
                          arch.FACING["+x"], 0.6, m["graphite"], extrude=0.03)
    nums = [arch.sign_text(f"PROP_Response_bay{i}", f"0{i + 1}", (bay_d / 2 + 0.12, -11.0 + i * 7.0, 6.45),
                           arch.FACING["+x"], 0.42, m["panel"], extrude=0.02) for i in range(3)]
    return arch.attach(station, [sign] + nums)


def prop_helipad(m: dict) -> bpy.types.Object:
    k = Kit("PROP_Helipad", m)
    cylinder(k["concrete"], (0, 0, 0.1), 11.0, 0.2, 48)
    geo.revolve_profile(k["paint_line"], [(9.0, 0.205), (9.6, 0.205), (9.6, 0.215), (9.0, 0.215)],
                        48, axis="Z")
    for y in (-2.0, 2.0):
        box(k["paint_line"], (0.0, y, 0.21), (7.0, 0.8, 0.02))
    box(k["paint_line"], (0.0, 0.0, 0.21), (0.8, 4.0, 0.02))
    for i in range(12):
        a = 2 * math.pi * i / 12
        cylinder(k["amber"], (10.5 * math.cos(a), 10.5 * math.sin(a), 0.28), 0.12, 0.16, 8)
    return k.finish()


# ==========================================================================
# Gatehouse over the route
# ==========================================================================


def prop_gatehouse(m: dict) -> bpy.types.Object:
    """A canopy over the carriageway with a security booth and raised booms.

    Traffic runs along X through the canopy; the booth sits on the -y kerb.
    """
    k = Kit("PROP_Gatehouse", m)
    span, depth, clear = 17.0, 8.0, 5.6
    for x in (-depth / 2 + 0.6, depth / 2 - 0.6):
        for y in (-span / 2, span / 2):
            box(k["graphite"], (x, y, clear / 2), (0.45, 0.45, clear))
    slab(k["panel"], (0.0, 0.0, clear + 0.45), (depth, span + 1.4, 0.9), cell=3.0)
    box(k["accent"], (depth / 2 + 0.02, 0.0, clear + 0.1), (0.05, span + 1.4, 0.12))
    box(k["accent"], (-depth / 2 - 0.02, 0.0, clear + 0.1), (0.05, span + 1.4, 0.12))
    for x in [-depth / 2 + 1.0 + 1.5 * i for i in range(5)]:
        box(k["lamp"], (x, 0.0, clear - 0.01), (0.25, span - 2.0, 0.04))
    # Booth on the -y side.
    slab(k["panel_grey"], (0.0, -span / 2 - 2.6, 1.6), (4.2, 3.2, 3.2), cell=2.0)
    for axis, off in (("+x", 2.1), ("-x", 2.1)):
        arch.ribbon_windows(k, axis, off, -span / 2 - 3.9, -span / 2 - 1.3, 1.0, 2.6, pane=1.3)
    box(k["graphite"], (0.0, -span / 2 - 2.6, 3.26), (4.6, 3.6, 0.15))
    # Booms, raised - the rover is expected.
    for x, s in ((depth / 2 - 1.4, -1), (-depth / 2 + 1.4, 1)):
        y0 = s * (span / 2 - 0.8)
        box(k["panel_grey"], (x, y0, 0.55), (0.5, 0.5, 1.1))
        rot = Matrix.Rotation(math.radians(80), 4, "X") if s < 0 else Matrix.Rotation(math.radians(-80), 4, "X")
        arm_c = Vector((x, y0, 1.1)) + (rot @ Vector((0.0, -s * 3.0, 0.0)))
        box(k["paint_line"], arm_c, (0.08, 6.0, 0.10), rotation=rot)
        for i in range(3):
            c = Vector((x, y0, 1.1)) + (rot @ Vector((0.0, -s * (1.0 + 2.0 * i), 0.0)))
            box(k["signal_red"], c, (0.085, 0.6, 0.105), rotation=rot)
    # Kerbs and speed hump.
    for y in (-span / 2 - 0.4, span / 2 + 0.4):
        box(k["concrete"], (0.0, y, 0.1), (depth + 6.0, 0.4, 0.2))
    gate = k.finish(smooth_angle=30.0)
    signs = []
    for name, facing, x in (("PROP_Gate_sign_in", "+x", depth / 2 + 0.06),
                            ("PROP_Gate_sign_out", "-x", -depth / 2 - 0.06)):
        signs.append(arch.sign_text(name, "CONTINUA  ·  AUTHORISED ACCESS", (x, 0.0, clear + 0.5),
                                    arch.FACING[facing], 0.42, m["graphite"], extrude=0.02))
    return arch.attach(gate, signs)


# ==========================================================================
# Dressing: fence, carport, cars, water tower, poles
# ==========================================================================


def prop_fence(m: dict) -> bpy.types.Object:
    """A 3 m mesh fence panel along X with its left-hand post."""
    k = Kit("PROP_Fence", m)
    cylinder(k["galv"], (-1.5, 0.0, 1.25), 0.05, 2.5, 8)
    for z in (0.12, 2.35):
        geo.tube(k["galv"], [(-1.5, 0.0, z), (1.5, 0.0, z)], 0.025, 6)
    # The mesh: a thin slab, double-sided by construction, dark and translucent.
    box(k["mesh"], (0.0, 0.0, 1.22), (3.0, 0.01, 2.2))
    return k.finish()


def prop_carport(m: dict) -> bpy.types.Object:
    """Solar carport over six bays, 18 m along X."""
    k = Kit("PROP_Carport", m)
    length, depth = 18.0, 5.6
    for x in (-7.5, -2.5, 2.5, 7.5):
        cylinder(k["galv"], (x, -1.6, 1.6), 0.12, 3.2, 10)
        box(k["galv"], (x, 0.0, 3.25), (0.18, depth, 0.25), rotation=Matrix.Rotation(math.radians(8), 4, "X"))
    tilt = Matrix.Rotation(math.radians(8), 4, "X")
    for col in range(9):
        for row in range(3):
            x = -length / 2 + 1.0 + col * 2.0
            y = -depth / 2 + 0.95 + row * 1.85
            z = 3.42 + math.tan(math.radians(8)) * y
            box(k["solar"], (x, y, z), (1.94, 1.8, 0.05), rotation=tilt)
    box(k["galv"], (0.0, -depth / 2, 3.04), (length, 0.1, 0.18))
    box(k["galv"], (0.0, depth / 2, 3.82), (length, 0.1, 0.18))
    # Bay lines on the ground.
    for i in range(7):
        x = -length / 2 + i * 3.0
        box(k["paint_line"], (x, 0.0, 0.03), (0.12, depth, 0.02))
    return k.finish()


def _car(m: dict, name: str, paint: str, length: float, width: float, height: float,
         van: bool = False) -> bpy.types.Object:
    """A simple passenger car / van, lofted like the rover but at 1/20 the
    detail. Front faces +X."""
    k = Kit(name, m)
    half_w = width / 2
    stations = [
        (-length / 2, 0.35, 0.82 if not van else 1.7, 0.86),
        (-length / 2 + 0.25, 0.30, 0.95 if not van else 1.9, 0.98),
        (-length / 2 + 0.9, 0.28, height if not van else height, 1.0),
        (length / 2 - (1.6 if not van else 0.9), 0.28, height if not van else height, 1.0),
        (length / 2 - (0.9 if not van else 0.5), 0.30, 0.98 if not van else 1.1, 1.0),
        (length / 2 - 0.15, 0.34, 0.82 if not van else 0.95, 0.94),
        (length / 2, 0.40, 0.70 if not van else 0.85, 0.86),
    ]
    rings = []
    for x, z0, z1, s in stations:
        w = half_w * s
        sec = geo.rounded_rect(2 * w, z1 - z0, min(0.25, (z1 - z0) * 0.4), 3)
        rings.append([(x, u, (z0 + z1) / 2 + v) for (u, v) in sec])
    geo.loft(k[paint], rings, closed=True, cap_start=True, cap_end=True)
    # Glasshouse: a dark band round the upper body.
    gz = (0.98 + height) / 2 if not van else 1.45
    gh = height - 1.0 if not van else 0.75
    x0 = -length / 2 + (1.0 if not van else 0.6)
    x1 = length / 2 - (1.6 if not van else 0.6)
    box(k["glass_dark"], ((x0 + x1) / 2, 0.0, gz), (x1 - x0, width * 0.94, gh * 0.75))
    for x in (-length / 2 + 0.75, length / 2 - 0.85):
        for s in (-1, 1):
            cylinder(k["rubber"], (x, s * (half_w - 0.12), 0.33), 0.33, 0.22, 16, axis="Y")
            cylinder(k["galv"], (x, s * (half_w - 0.01), 0.33), 0.2, 0.02, 12, axis="Y")
    for s in (-1, 1):
        box(k["lamp"], (length / 2 + 0.01, s * (half_w - 0.25), 0.75 if not van else 0.85), (0.04, 0.32, 0.1))
        box(k["signal_red"], (-length / 2 - 0.01, s * (half_w - 0.2), 0.8), (0.04, 0.25, 0.1))
    return k.finish(smooth_angle=45.0)


def prop_cars(m: dict) -> list[bpy.types.Object]:
    return [
        _car(m, "PROP_Car_A", "car_white", 4.6, 1.85, 1.45),
        _car(m, "PROP_Car_B", "car_grey", 4.8, 1.9, 1.6),
        _car(m, "PROP_Car_C", "car_blue", 4.4, 1.8, 1.42),
        _car(m, "PROP_Van", "car_white", 5.6, 2.0, 2.4, van=True),
    ]


def prop_water_tower(m: dict) -> bpy.types.Object:
    """A campus water tower: four braced legs, a drum with a cone roof."""
    k = Kit("PROP_WaterTower", m)
    h = 18.0
    for sx, sy in ((1, 1), (1, -1), (-1, -1), (-1, 1)):
        arch.bar(k["galv"], (sx * 3.2, sy * 3.2, 0.0), (sx * 2.2, sy * 2.2, h), 0.3, 0.3)
        cylinder(k["concrete"], (sx * 3.2, sy * 3.2, 0.3), 0.6, 0.6, 12)
    for z in (5.0, 10.0, 15.0):
        hz = 3.2 - 1.0 * z / h
        for (ax, ay), (bx, by) in (((1, 1), (1, -1)), ((1, -1), (-1, -1)), ((-1, -1), (-1, 1)), ((-1, 1), (1, 1))):
            arch.bar(k["galv"], (ax * hz, ay * hz, z), (bx * hz, by * hz, z), 0.12, 0.12)
    cylinder(k["galv"], (0, 0, h / 2), 0.35, h, 12)
    tank = [(0.0, h), (4.0, h), (4.6, h + 0.6), (4.6, h + 5.2), (4.0, h + 5.8), (0.0, h + 7.2)]
    geo.revolve_profile(k["tank_white"], [(r, z) for (r, z) in tank], 40, axis="Z",
                        closed_section=False)
    band = [(4.62, h + 2.6), (4.66, h + 2.6), (4.66, h + 3.4), (4.62, h + 3.4)]
    geo.revolve_profile(k["accent"], band, 40, axis="Z")
    arch.railing(k, [(4.9 * math.cos(a), 4.9 * math.sin(a), h + 0.6)
                     for a in [2 * math.pi * i / 24 for i in range(25)]], height=1.0, post=2.5)
    return k.finish()


def prop_light_pole(m: dict) -> bpy.types.Object:
    """Modern LED street light; the arm reaches toward +X."""
    k = Kit("PROP_LightPole", m)
    cylinder(k["concrete"], (0, 0, 0.2), 0.35, 0.4, 12)
    geo.sweep(k["galv"], geo.circle(0.09, 10), [(0, 0, 0.3), (0, 0, 8.6)], cap=True,
              scale=lambda t: 1.25 - 0.45 * t)
    geo.tube(k["galv"], [(0, 0, 8.4), (0.4, 0, 8.75), (1.6, 0, 8.85)], 0.055, 8)
    box(k["graphite"], (1.85, 0.0, 8.82), (0.9, 0.3, 0.1))
    box(k["lamp"], (1.85, 0.0, 8.765), (0.8, 0.24, 0.02))
    return k.finish()


def prop_bollard(m: dict) -> bpy.types.Object:
    k = Kit("PROP_Bollard", m)
    cylinder(k["graphite"], (0, 0, 0.5), 0.1, 1.0, 12)
    cylinder(k["amber"], (0, 0, 0.82), 0.102, 0.08, 12)
    return k.finish()


def prop_planter(m: dict) -> bpy.types.Object:
    k = Kit("PROP_Planter", m)
    slab(k["concrete_warm"], (0, 0, 0.35), (4.0, 1.6, 0.7), cell=2.0)
    box(k["sand"], (0, 0, 0.66), (3.7, 1.3, 0.1))
    return k.finish()


def build_all(m: dict) -> list[bpy.types.Object]:
    out = [prop_hq(m), prop_flagpole(m), prop_gateway(m), prop_hangar(m),
           prop_response_station(m), prop_helipad(m), prop_gatehouse(m), prop_fence(m),
           prop_carport(m), prop_water_tower(m), prop_light_pole(m), prop_bollard(m),
           prop_planter(m)]
    out += prop_cars(m)
    return out
