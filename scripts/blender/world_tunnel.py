"""
CONTINUA world - the ridge tunnel.

Where the industrial corridor gives way to the remote hills, the road goes
through a ridge: a two-lane road tunnel, 56.4 m portal to portal, the way one
is actually built - a precast portal in a cut with splayed wing walls, a
horseshoe lining clad in pale enamel panels to shoulder height, two rows of
luminaires, a pair of jet fans, emergency stations, a cable tray, and the
radiating cable a tunnel carries along its wall so that the mobile network
reaches the inside of it.

The hill over it, the cut in front of each portal and where each piece stands
are the scene's (packages/scene/src/world/tunnel.ts, components/Tunnel.tsx);
the dimensions below are a contract with that file. Node names are a contract
with Tunnel.tsx:

    PROP_TunnelPortal     headwall with the opening, portal frame, coping, the
                          wing walls, the tunnel's name, the lane signals, and
                          the walkways through the headwall. +X points OUT of
                          the tunnel; the origin is on the road's centre line
                          in the face of the headwall; z = 0 is the road.
    PROP_TunnelSegment    6 m of lined tunnel along X, centred on the origin,
                          z = 0 the road. Laid end to end; each is 8 cm longer
                          than its pitch, and the overlap is a dark ring joint.
    PROP_TunnelFans       a pair of jet fans hung from the crown.
    PROP_TunnelSOS        an emergency station on the +Y wall, an exit sign on
                          the -Y wall.
    PROP_PipelineBury     the above-ground pipeline turning down into the
                          ground where it meets the ridge; +X is the way it
                          goes under. Its level end meets a 12 m PROP_Pipeline
                          run's end at the origin.
    PROP_PipelineMarker   a marker post over the buried pipeline.

Front faces +X unless stated otherwise; authored at the origin; metres, Z up.
"""

from __future__ import annotations

import math

import bmesh
import bpy
from mathutils import Matrix

import continua_arch as arch
import continua_geo as geo
import continua_lib as lib
from continua_arch import Kit, box, cylinder, slab

# --------------------------------------------------------------------------
# Dimensions (mirrored in packages/scene/src/world/tunnel.ts)
# --------------------------------------------------------------------------

R = 5.35            # inner radius of the arch, and half the width between the walls
SPRING = 1.6        # springline: the walls are vertical below it, the arch above
LINING = 0.45       # lining thickness
WALK_IN = 4.05      # the walkways' kerb line, from the centre line
WALK_TOP = 0.22     # the walkways' top above the road
GUTTER_IN = 3.9     # the carriageway's edge (ROAD_HALF_WIDTH), where the gutter starts
DADO_TOP = 0.62     # the dark band along the foot of the walls
CLAD_TOP = 3.4      # the enamel cladding reaches this high
PANEL_ROW = 2.0     # the cladding's horizontal joint

SEGMENT = 6.0       # segment pitch
OVERLAP = 0.04      # each segment runs on this far past its pitch at both ends

HEAD_DEPTH = 1.2    # the headwall's thickness, behind its face
HEAD_HALF = 8.2     # half its width
HEAD_TOP = 9.2      # its top, under the coping
COPING_TOP = 9.4
COPING_HALF = 8.35
FRAME_W = 0.55      # the portal frame round the opening
FRAME_PROUD = 0.25

WING_LEN = 14.0     # the wing walls run out this far from the face
WING_IN0 = 7.6      # their road face, from the centre line, at the headwall...
WING_SPLAY = 3.4 / WING_LEN   # ...splaying outward this much per metre
WING_THICK = 0.6
WING_TOP0 = 9.4     # their coping's top at the headwall (the headwall's coping)
WING_TOP1 = 1.2     # and at their far end
WING_COPING = 0.12

NAME = "RIDGE TUNNEL"

# The arch's angles at the cladding's joint and top, measured from the
# springline.
A_ROW = math.asin((PANEL_ROW - SPRING) / R)
A_CLAD = math.asin((CLAD_TOP - SPRING) / R)


def tunnel_materials(m: dict) -> dict:
    """The world's palette plus the tunnel's own finishes."""
    pbr = lib.pbr
    out = dict(m)
    out.update({
        # Enamelled steel panels to shoulder height: bright and easy to wash,
        # the reason tunnel walls are pale.
        "t_clad": pbr("W_Tunnel_Cladding", "#EEF1F3", roughness=0.32),
        "t_arch": pbr("W_Tunnel_Arch", "#C4C8CC", roughness=0.86),
        "t_dado": pbr("W_Tunnel_Dado", "#6E747B", roughness=0.62),
        "t_joint": pbr("W_Tunnel_Joint", "#40454C", roughness=0.7),
        "t_walk": pbr("W_Tunnel_Walkway", "#BBBFC2", roughness=0.9),
        "t_kerb": pbr("W_Tunnel_Kerb", "#E7EAEC", roughness=0.55),
        "t_light": pbr("W_Tunnel_Light", "#FFF7EA", roughness=0.25, emission="#FFF0D4",
                       emission_strength=4.0),
        "t_portal": pbr("W_Portal_Concrete", "#CDC7BC", roughness=0.9),
        "t_frame": pbr("W_Portal_Frame", "#E3DFD6", roughness=0.72),
        "sign_blue": pbr("W_Sign_Blue", "#1F5FD6", roughness=0.4, emission="#2A6BFF",
                         emission_strength=0.55),
        "sign_green": pbr("W_Sign_Green", "#0E8C4B", roughness=0.4, emission="#17B85F",
                          emission_strength=0.6),
        "sign_white": pbr("W_Sign_White", "#F6F7F9", roughness=0.4, emission="#FFFFFF",
                          emission_strength=0.5),
        "signal_green": pbr("W_Signal_Green", "#1FD164", roughness=0.3, emission="#2BE870",
                            emission_strength=2.2),
        "reflector": pbr("W_Reflector", "#F2A71B", roughness=0.35, emission="#F2A71B",
                         emission_strength=0.7),
        "marker": pbr("W_Marker_Yellow", "#F2C230", roughness=0.55),
    })
    return out


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------


class _Verts:
    """Vertices shared by position, so faces built one by one close up into a
    manifold solid - which is what lets the normals be recalculated outward."""

    def __init__(self, bm: bmesh.types.BMesh) -> None:
        self.bm = bm
        self.cache: dict[tuple[float, float, float], bmesh.types.BMVert] = {}

    def __call__(self, x: float, y: float, z: float) -> bmesh.types.BMVert:
        key = (round(x, 5), round(y, 5), round(z, 5))
        vert = self.cache.get(key)
        if vert is None:
            vert = self.bm.verts.new((x, y, z))
            self.cache[key] = vert
        return vert

    def quad(self, points) -> None:
        verts = [self(*p) for p in points]
        if len({id(v) for v in verts}) < 3:
            return
        try:
            self.bm.faces.new(verts)
        except ValueError:
            pass


def _arch_point(a: float, radius: float = R) -> tuple[float, float]:
    """(y, z) on an arch of `radius` round the springline's centre, `a` from
    the +Y springline (0) over the crown (pi/2) to the -Y one (pi)."""
    return radius * math.cos(a), SPRING + radius * math.sin(a)


def _inward(a: float) -> tuple[float, float]:
    """The arch's normal toward the tunnel's axis, (y, z)."""
    return -math.cos(a), -math.sin(a)


def _facing(ny: float, nz: float) -> Matrix:
    """Turns a box's local +Z onto the direction (0, ny, nz)."""
    return Matrix.Rotation(math.atan2(-ny, nz), 4, "X")


def _flat(bm: bmesh.types.BMesh, outline, x0: float, x1: float) -> None:
    """A thin plate: a polygon in the Y-Z plane, from x0 to x1."""
    verts = _Verts(bm)
    front = [verts(x1, y, z) for y, z in outline]
    back = [verts(x0, y, z) for y, z in outline]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    count = len(outline)
    for i in range(count):
        j = (i + 1) % count
        bm.faces.new((back[i], back[j], front[j], front[i]))


# --------------------------------------------------------------------------
# The lining
# --------------------------------------------------------------------------


def _lining_rings(xs):
    """The lining's cross-section - the inner face from the +Y walkway, over
    the crown, to the -Y walkway, then the outer face back - at each x."""
    inner: list[tuple[float, float]] = [(R, WALK_TOP), (R, DADO_TOP), (R, 1.1), (R, SPRING)]
    angles = sorted({math.pi * i / 44 for i in range(1, 44)} | {A_ROW, A_CLAD, math.pi - A_CLAD, math.pi - A_ROW})
    inner += [_arch_point(a) for a in angles]
    inner += [(-R, SPRING), (-R, 1.1), (-R, DADO_TOP), (-R, WALK_TOP)]
    outer_radius = R + LINING
    outer = [(-R, -0.6), (-outer_radius, -0.6), (-outer_radius, SPRING)]
    outer += [_arch_point(math.pi * (24 - i) / 24, outer_radius) for i in range(1, 24)]
    outer += [(outer_radius, SPRING), (outer_radius, -0.6), (R, -0.6)]
    ring = inner + outer
    return [[(x, y, z) for (y, z) in ring] for x in xs], len(inner)


def _lining(name: str, m: dict, x0: float, x1: float, joints: bool) -> bpy.types.Object:
    """The lining between x0 and x1 as one closed solid, its inner face zoned
    by height - dado, cladding, painted arch - and, with `joints`, a dark ring
    joint 8 cm wide at each end."""
    xs = [x0]
    if joints:
        xs.append(x0 + 2 * OVERLAP)
    # Stations every metre for the AO bake, on the half-metres: on the
    # panel joints (every 2 m), the joints' own occlusion shaded each panel
    # like a cushion.
    step = 1.0
    x = math.floor(x0) + 0.5
    while x < x1 - 2 * OVERLAP - 1e-6:
        if x > xs[-1] + 0.2:
            xs.append(x)
        x += step
    if joints:
        xs.append(x1 - 2 * OVERLAP)
    xs.append(x1)
    rings, inner_count = _lining_rings(xs)
    bm = bmesh.new()
    _grid, faces, caps = geo.loft(bm, rings, closed=True, cap_start=True, cap_end=True)
    slots = ["t_arch", "t_clad", "t_dado", "t_joint"]
    for i, row in enumerate(faces):
        end_band = joints and (i == 0 or i == len(faces) - 1)
        for j, face in enumerate(row):
            if face is None:
                continue
            if j >= inner_count - 1:
                face.material_index = 0          # outer face and the closing edges: hidden
                continue
            z = (rings[0][j][2] + rings[0][j + 1][2]) / 2
            if end_band:
                face.material_index = 3
            elif z < DADO_TOP:
                face.material_index = 2
            elif z < CLAD_TOP:
                face.material_index = 1
            else:
                face.material_index = 0
    for cap in caps:
        cap.material_index = 0
    obj = geo.to_object(name, bm, [m[s] for s in slots])
    geo.smooth(obj, 30.0)
    return obj


def _cladding_joints(k: Kit, x0: float, x1: float) -> None:
    """The cladding's panel joints: vertical every 2 m, and one along each wall."""
    for side in (1, -1):
        y_row = side * R * math.cos(A_ROW)
        box(k["t_joint"], ((x0 + x1) / 2, y_row, PANEL_ROW), (x1 - x0, 0.01, 0.03))
        x = math.ceil(x0 / 2.0) * 2.0
        while x < x1 - 0.3:
            if x > x0 + 0.3:
                path = [(x, side * R, DADO_TOP), (x, side * R, SPRING)]
                path += [(x, side * yy, zz) for yy, zz in
                         (_arch_point(A_CLAD * i / 6) for i in range(1, 7))]
                geo.sweep(k["t_joint"], [(-0.014, -0.004), (0.014, -0.004), (0.014, 0.004), (-0.014, 0.004)],
                          path, up_hint=(1.0, 0.0, 0.0))
            x += 2.0


def _floor(k: Kit, x0: float, x1: float) -> None:
    """Walkways, their kerb faces and the gutters, both sides."""
    length = x1 - x0
    cx = (x0 + x1) / 2
    for side in (1, -1):
        box(k["t_walk"], (cx, side * (WALK_IN + R) / 2, (-0.6 + WALK_TOP) / 2), (length, R - WALK_IN, 0.6 + WALK_TOP))
        box(k["t_kerb"], (cx, side * (WALK_IN - 0.004), WALK_TOP / 2), (length, 0.008, WALK_TOP))
        box(k["t_dado"], (cx, side * (GUTTER_IN + WALK_IN) / 2, -0.02), (length, WALK_IN - GUTTER_IN, 0.05))


# --------------------------------------------------------------------------
# Props
# --------------------------------------------------------------------------


def prop_tunnel_segment(m: dict) -> bpy.types.Object:
    """6 m of tunnel: the lined horseshoe, two rows of luminaires, the cable
    tray on the -Y wall, the radiating cable on the +Y wall - the cable that
    carries the mobile network into a tunnel - and reflective delineators."""
    half = SEGMENT / 2 + OVERLAP
    k = Kit("PROP_TunnelSegment", m)
    _floor(k, -half, half)
    _cladding_joints(k, -half, half)
    # Luminaires: two rows high on the arch, each fitting 1.5 m long, two to a
    # segment per row - continuous-looking lines of light down the tunnel.
    a_light = math.acos(3.25 / R)
    for side in (1, -1):
        a = a_light if side > 0 else math.pi - a_light
        ny, nz = _inward(a)
        rot = _facing(ny, nz)
        y, z = _arch_point(a)
        for x in (-1.5, 1.5):
            box(k["graphite"], (x, y + ny * 0.065, z + nz * 0.065), (1.5, 0.32, 0.12), rotation=rot)
            box(k["t_light"], (x, y + ny * 0.13, z + nz * 0.13), (1.42, 0.25, 0.012), rotation=rot)
    # Cable tray, level, on brackets off the -Y wall.
    tray_y, tray_z = -4.25, 4.2
    box(k["galv"], (0.0, tray_y, tray_z), (2 * half, 0.42, 0.012))
    for dy in (-0.21, 0.21):
        box(k["galv"], (0.0, tray_y + dy, tray_z + 0.04), (2 * half, 0.012, 0.08))
    for dy, r in ((-0.11, 0.035), (0.0, 0.03), (0.1, 0.04)):
        geo.tube(k["rubber"], [(-half, tray_y + dy, tray_z + 0.01 + r), (half, tray_y + dy, tray_z + 0.01 + r)], r, 8)
    wall_y = -math.sqrt(R * R - (tray_z - SPRING) ** 2)
    for x in (-2.25, -0.75, 0.75, 2.25):
        box(k["steel_dark"], (x, (wall_y + tray_y - 0.21) / 2, tray_z - 0.03), (0.05, tray_y - 0.21 - wall_y, 0.05))
        box(k["steel_dark"], (x, wall_y + 0.04, tray_z - 0.2), (0.05, 0.05, 0.4))
    # The radiating cable: coax with slots cut in its outer conductor, clipped
    # to the +Y wall, so a phone - or a rover - in the tunnel stays on the
    # mobile network.
    feeder_z = 4.9
    feeder_wall = math.sqrt(R * R - (feeder_z - SPRING) ** 2)
    feeder_y = feeder_wall - 0.12
    geo.tube(k["rubber"], [(-half, feeder_y, feeder_z), (half, feeder_y, feeder_z)], 0.024, 10)
    for x in (-2.5, -1.5, -0.5, 0.5, 1.5, 2.5):
        box(k["galv"], (x, (feeder_y + feeder_wall) / 2 + 0.01, feeder_z), (0.04, feeder_wall - feeder_y + 0.04, 0.07))
    # Delineators: an amber reflector on each wall every segment.
    for side in (1, -1):
        box(k["reflector"], (0.0, side * (R - 0.008), 0.85), (0.12, 0.016, 0.06))
    body = k.finish(smooth_angle=35.0)
    lining = _lining("PROP_TunnelSegment_lining", m, -half, half, joints=True)
    return arch.attach(body, [lining])


def _headwall(bm: bmesh.types.BMesh) -> None:
    """The headwall as one closed solid: its face from x = 0 back to
    -HEAD_DEPTH, the opening's arch and the piers either side of it."""
    verts = _Verts(bm)
    corner = math.atan2(HEAD_TOP - SPRING, HEAD_HALF)
    angles = sorted({math.pi * i / 36 for i in range(37)} | {corner, math.pi - corner})
    steps = 5

    def outer(a: float) -> tuple[float, float]:
        dy, dz = math.cos(a), math.sin(a)
        reach = []
        if abs(dy) > 1e-9:
            reach.append(HEAD_HALF / abs(dy))
        if dz > 1e-9:
            reach.append((HEAD_TOP - SPRING) / dz)
        t = min(reach)
        return dy * t, SPRING + dz * t

    def spandrel(a: float, r: int) -> tuple[float, float]:
        (iy, iz), (oy, oz) = _arch_point(a), outer(a)
        f = r / steps
        return iy + (oy - iy) * f, iz + (oz - iz) * f

    pier_z = [-0.6, 0.0, WALK_TOP, 0.9, SPRING]
    for x in (0.0, -HEAD_DEPTH):
        for a0, a1 in zip(angles, angles[1:]):
            for r in range(steps):
                pts = [spandrel(a0, r), spandrel(a1, r), spandrel(a1, r + 1), spandrel(a0, r + 1)]
                verts.quad([(x, y, z) for y, z in pts])
        for side in (1, -1):
            ys = [side * (R + (HEAD_HALF - R) * r / steps) for r in range(steps + 1)]
            for z0, z1 in zip(pier_z, pier_z[1:]):
                for y0, y1 in zip(ys, ys[1:]):
                    verts.quad([(x, y0, z0), (x, y1, z0), (x, y1, z1), (x, y0, z1)])
    # Round the outline and the opening, front to back.
    for a0, a1 in zip(angles, angles[1:]):
        for fn in (_arch_point, outer):
            (y0, z0), (y1, z1) = fn(a0), fn(a1)
            verts.quad([(0.0, y0, z0), (0.0, y1, z1), (-HEAD_DEPTH, y1, z1), (-HEAD_DEPTH, y0, z0)])
    for side in (1, -1):
        for y in (side * R, side * HEAD_HALF):
            for z0, z1 in zip(pier_z, pier_z[1:]):
                verts.quad([(0.0, y, z0), (0.0, y, z1), (-HEAD_DEPTH, y, z1), (-HEAD_DEPTH, y, z0)])
        ys = [side * (R + (HEAD_HALF - R) * r / steps) for r in range(steps + 1)]
        for y0, y1 in zip(ys, ys[1:]):
            verts.quad([(0.0, y0, -0.6), (0.0, y1, -0.6), (-HEAD_DEPTH, y1, -0.6), (-HEAD_DEPTH, y0, -0.6)])


def _portal_frame(bm: bmesh.types.BMesh) -> None:
    """The precast frame round the opening, standing proud of the face."""
    verts = _Verts(bm)
    angles = [math.pi * i / 36 for i in range(37)]
    legs = [WALK_TOP, 0.9, SPRING]
    inner = [(R, z) for z in legs] + [_arch_point(a) for a in angles[1:-1]] + [(-R, z) for z in reversed(legs)]
    outer = ([(R + FRAME_W, z) for z in legs] + [_arch_point(a, R + FRAME_W) for a in angles[1:-1]]
             + [(-R - FRAME_W, z) for z in reversed(legs)])
    x0, x1 = 0.0, FRAME_PROUD
    for i in range(len(inner) - 1):
        for x in (x0, x1):
            verts.quad([(x, *inner[i]), (x, *inner[i + 1]), (x, *outer[i + 1]), (x, *outer[i])])
        for line in (inner, outer):
            verts.quad([(x0, *line[i]), (x0, *line[i + 1]), (x1, *line[i + 1]), (x1, *line[i])])
    for i in (0, len(inner) - 1):
        verts.quad([(x0, *inner[i]), (x0, *outer[i]), (x1, *outer[i]), (x1, *inner[i])])


def _wing_wall_top(x: float) -> float:
    return WING_TOP0 + (WING_TOP1 - WING_TOP0) * x / WING_LEN


def _wing_walls(k: Kit) -> None:
    """Splayed wing walls holding back the cut, their copings stepping down
    from the headwall's to just over a metre at their ends."""
    xs = [i * 1.0 for i in range(int(WING_LEN) + 1)]
    for side in (1, -1):
        body, coping = [], []
        for x in xs:
            road = WING_IN0 + WING_SPLAY * x
            back = road + WING_THICK
            top = _wing_wall_top(x)
            body.append([(x, side * road, -0.6), (x, side * road, top - WING_COPING),
                         (x, side * back, top - WING_COPING), (x, side * back, -0.6)])
            coping.append([(x, side * (road - 0.06), top - WING_COPING), (x, side * (road - 0.06), top),
                           (x, side * (back + 0.06), top), (x, side * (back + 0.06), top - WING_COPING)])
        geo.loft(k["t_portal"], body, closed=True, cap_start=True, cap_end=True)
        geo.loft(k["t_frame"], coping, closed=True, cap_start=True, cap_end=True)


def _lane_signals(k: Kit) -> None:
    """Lane control signals just inside the portal, one over each lane: a green
    arrow pointing down - the lane is open. Each hangs from the arch on its own
    bracket, high under it: no gantry across the tunnel for the follow camera
    to pass under."""
    x = -2.4
    centre_z = 6.0
    half = 0.27
    for y in (-1.75, 1.75):
        top = SPRING + math.sqrt(R * R - y * y)
        box(k["steel_dark"], (x, y, (centre_z + half + top) / 2 + 0.02), (0.07, 0.07, top - centre_z - half + 0.06))
        box(k["graphite"], (x, y, centre_z), (0.2, 2 * half, 2 * half))
        arrow = [(y - 0.06, centre_z + 0.17), (y + 0.06, centre_z + 0.17), (y + 0.06, centre_z - 0.01),
                 (y + 0.16, centre_z - 0.01), (y, centre_z - 0.19), (y - 0.16, centre_z - 0.01),
                 (y - 0.06, centre_z - 0.01)]
        _flat(k["signal_green"], list(reversed(arrow)), x + 0.1, x + 0.112)


def prop_tunnel_portal(m: dict) -> bpy.types.Object:
    """A tunnel portal in its cut: the headwall with the opening, a precast
    frame round it, the coping, the splayed wing walls, the tunnel's name in
    raised letters, lane signals over both lanes and the walkways carried
    through the headwall. +X points out of the tunnel."""
    k = Kit("PROP_TunnelPortal", m)
    _headwall(k["t_portal"])
    _portal_frame(k["t_frame"])
    slab(k["t_frame"], (-(HEAD_DEPTH + 0.15) / 2 + 0.075, 0.0, (HEAD_TOP + COPING_TOP) / 2),
         (HEAD_DEPTH + 0.15 + 0.15, 2 * COPING_HALF, COPING_TOP - HEAD_TOP), cell=1.5)
    _wing_walls(k)
    _floor(k, -HEAD_DEPTH - OVERLAP, 0.4)
    _lane_signals(k)
    portal = k.finish(smooth_angle=35.0)
    name = arch.sign_text("PROP_TunnelPortal_name", NAME, (0.02, 0.0, 8.12), arch.FACING["+x"], 0.62,
                          m["graphite"], extrude=0.05)
    return arch.attach(portal, [name])


def prop_tunnel_fans(m: dict) -> bpy.types.Object:
    """A pair of jet fans under the crown, each on two hangers - clear of the
    follow camera's line down the middle of the tunnel."""
    k = Kit("PROP_TunnelFans", m)
    z = 5.5
    for side in (1, -1):
        y = side * 2.2
        cylinder(k["galv"], (0.0, y, z), 0.45, 2.4, 28, axis="X")
        for x in (-1.45, 1.45):
            cylinder(k["steel_dark"], (x, y, z), 0.47, 0.5, 28, axis="X")
            end = x + (0.255 if x > 0 else -0.255)
            cylinder(k["graphite"], (end, y, z), 0.44, 0.012, 28, axis="X")
            for i in range(-3, 4):
                box(k["steel_dark"], (end, y + i * 0.11, z), (0.03, 0.02, 0.84))
        box(k["graphite"], (0.0, y, z + 0.47), (1.6, 0.12, 0.05))
        top = SPRING + math.sqrt(R * R - (abs(y) + 0.15) ** 2)
        for x in (-0.7, 0.7):
            box(k["steel_dark"], (x, y, (z + 0.47 + top) / 2), (0.08, 0.26, top - z - 0.47 + 0.08))
    return k.finish(smooth_angle=40.0)


def prop_tunnel_sos(m: dict) -> bpy.types.Object:
    """An emergency station in the +Y wall - door, extinguisher, a lit SOS
    sign over it - and a lit exit sign on the -Y wall."""
    k = Kit("PROP_TunnelSOS", m)
    box(k["graphite"], (0.0, R - 0.03, WALK_TOP + 1.15), (1.36, 0.06, 2.3))
    box(k["panel_grey"], (0.0, R - 0.07, WALK_TOP + 1.07), (1.12, 0.04, 2.1))
    box(k["steel_dark"], (0.4, R - 0.1, 1.28), (0.05, 0.04, 0.24))
    sign_z = 2.95
    sign_y = math.sqrt(R * R - (sign_z - SPRING) ** 2)
    box(k["sign_blue"], (0.0, sign_y - 0.08, sign_z), (1.1, 0.1, 0.48))
    box(k["signal_red"], (1.18, R - 0.085, 1.12), (0.5, 0.17, 0.86))
    box(k["sign_white"], (1.18, R - 0.172, 1.36), (0.3, 0.008, 0.11))
    exit_z = 2.55
    exit_y = -math.sqrt(R * R - (exit_z - SPRING) ** 2)
    box(k["sign_green"], (0.0, exit_y + 0.06, exit_z), (1.0, 0.08, 0.36))
    station = k.finish(smooth_angle=35.0)
    sos = arch.sign_text("PROP_TunnelSOS_sos", "SOS", (0.0, sign_y - 0.135, sign_z), arch.FACING["-y"], 0.3,
                         m["sign_white"], extrude=0.008)
    exit_sign = arch.sign_text("PROP_TunnelSOS_exit", "EXIT", (0.0, exit_y + 0.105, exit_z), arch.FACING["+y"],
                               0.22, m["sign_white"], extrude=0.008)
    return arch.attach(station, [sos, exit_sign])


def _marker_post(k: Kit, x: float, y: float) -> None:
    box(k["marker"], (x, y, 0.65), (0.1, 0.1, 1.3))
    box(k["graphite"], (x, y, 1.33), (0.14, 0.14, 0.06))
    box(k["signal_red"], (x, y, 1.12), (0.115, 0.115, 0.16))


def prop_pipeline_bury(m: dict) -> bpy.types.Object:
    """The pipeline leaving its supports and turning down into the ground, a
    concrete anchor where it enters and a marker post: what a pipeline does at
    a ridge it is not worth carrying over. +X is the way it goes under; the
    level end meets a PROP_Pipeline run's end at the origin."""
    k = Kit("PROP_PipelineBury", m)
    level, radius = 1.3, 0.46
    slope = math.radians(25.0)
    bend = 2.0
    path = [(-0.3, 0.0, level), (0.6, 0.0, level)]
    for i in range(1, 7):
        a = slope * i / 6
        path.append((0.6 + bend * math.sin(a), 0.0, level - bend * (1 - math.cos(a))))
    ex, _, ez = path[-1]
    path.append((ex + 4.2 * math.cos(slope), 0.0, ez - 4.2 * math.sin(slope)))
    geo.tube(k["galv"], path, radius, 20)
    # Where the pipe meets the ground: an anchor block round it.
    ground_x = ex + (ez - 0.25) / math.tan(slope)
    slab(k["concrete"], (ground_x, 0.0, 0.3), (1.4, 1.6, 1.0), cell=0.7)
    # One H-support under the level run, as on every pipeline run.
    for y in (-0.55, 0.55):
        box(k["steel_dark"], (0.0, y, 0.45), (0.2, 0.12, 0.9))
    box(k["steel_dark"], (0.0, 0.0, 0.85), (0.24, 1.3, 0.14))
    box(k["concrete"], (0.0, 0.0, 0.08), (0.8, 1.6, 0.16))
    _marker_post(k, ground_x + 1.8, 1.4)
    return k.finish(smooth_angle=40.0)


def prop_pipeline_marker(m: dict) -> bpy.types.Object:
    """A marker post over the buried pipeline."""
    k = Kit("PROP_PipelineMarker", m)
    _marker_post(k, 0.0, 0.0)
    return k.finish(smooth_angle=30.0)


def build_all(m: dict) -> list[bpy.types.Object]:
    m = tunnel_materials(m)
    return [prop_tunnel_portal(m), prop_tunnel_segment(m), prop_tunnel_fans(m), prop_tunnel_sos(m),
            prop_pipeline_bury(m), prop_pipeline_marker(m)]
