"""
CONTINUA — rover generation.

Builds `CONTINUA Rover Mk1`, a compact off-road inspection SUV, from scratch and
exports it for the browser runtime.

    node scripts/run-blender.mjs scripts/blender/build_vehicle.py

Outputs
    assets/blender/continua_rover.blend             editable source (hero detail)
    apps/web/public/models/continua_rover.glb       runtime hero model
    apps/web/public/models/continua_rover_lod1.glb  low-detail variant

Orientation contract (see docs/ASSET_MANIFEST.md)
    Blender: forward +X, left +Y, up +Z, root at the tyre contact plane z = 0.
    glTF:    forward +X, up +Y; wheel spin = local Z, steering = local Y.
"""

from __future__ import annotations

import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import continua_lib as lib  # noqa: E402

# ==========================================================================
# Dimensions — every number in metres, all in one place
# ==========================================================================

WHEELBASE = 2.85
AXLE_F = WHEELBASE / 2.0          # +1.425
AXLE_R = -WHEELBASE / 2.0         # -1.425
TRACK_Y = 0.845                   # wheel centre, half-track
WHEEL_R = 0.405                   # tyre outer radius -> ride height
TYRE_HALF_W = 0.165

BODY_Y = 0.96                     # body half-width
ROCKER_Z = 0.46                   # body underside / rocker line
BELT_Z = 1.44                     # beltline (top of the painted lower body)
ROOF_Z = 1.84                     # underside of the roof panel
ROOF_TOP = 1.95
BONNET_Z = 1.36
NOSE_X = 2.15
TAIL_X = -2.18
ARCH_R = 0.53

GLASS_Y = 0.895
PILLAR_Y = 0.928
CABIN_REAR_X = -2.10              # rear face of the greenhouse
TWO_TONE_Z = 0.84                 # below this the body wears the grey lower panel


# ==========================================================================
# Body
# ==========================================================================


def body_profile() -> list[tuple[float, float]]:
    """Closed side silhouette in the X-Z plane, including wheel-arch cutouts."""
    points: list[tuple[float, float]] = [
        # --- upper edge, front to rear ---
        (NOSE_X, BONNET_Z - 0.075),      # bonnet nose
        (2.04, BONNET_Z - 0.030),
        (1.14, BONNET_Z),                # bonnet trailing edge
        (1.02, BELT_Z),                  # cowl step up to the beltline
        (-2.02, BELT_Z),
        (TAIL_X, BELT_Z - 0.05),         # rear top corner
        # --- tailgate ---
        (-2.23, 0.94),
        (-2.21, 0.62),
        (-2.10, ROCKER_Z + 0.02),
    ]
    # --- underside, rear to front, arching over each wheel ---
    points.append((-1.98, ROCKER_Z))
    points += lib.arc_points(AXLE_R, ROCKER_Z, ARCH_R, 180.0, 0.0, 16)
    points.append((-0.55, ROCKER_Z))
    points.append((0.55, ROCKER_Z))
    points += lib.arc_points(AXLE_F, ROCKER_Z, ARCH_R, 180.0, 0.0, 16)
    points.append((2.04, ROCKER_Z))
    # --- front fascia, bottom to top ---
    points += [
        (2.19, 0.62),
        (2.245, 0.90),
        (2.235, 1.16),
    ]
    return points


def build_lower_body(materials: dict) -> bpy.types.Object:
    bm = bmesh.new()
    lib.bm_prism(bm, body_profile(), -BODY_Y, BODY_Y)

    # Sculpt the flat slab into something with a waist: tuck the rocker under,
    # narrow the nose a little, pull the tail in very slightly.
    for vert in bm.verts:
        x, y, z = vert.co
        factor = 1.0
        if z < ROCKER_Z + 0.16:
            factor *= 0.945                      # rocker tuck-in
        if x > 1.55:
            # Smooth, quadratic taper. A hard cut-off here creased the bonnet.
            t = min(1.0, (x - 1.55) / (NOSE_X - 1.55))
            factor *= 1.0 - 0.055 * t * t
        if x < -2.06:
            factor *= 0.975                      # tail taper
        if z > BELT_Z - 0.10:
            factor *= 0.99                       # slight shoulder
        vert.co.y = y * factor

    obj = lib.new_mesh_object("CONTINUA_BodyShell", bm, materials["paint"])
    lib.add_bevel(obj, width=0.024, segments=2, angle_deg=40)
    return obj


def apply_two_tone(obj: bpy.types.Object, materials: dict) -> None:
    """Grey lower panel. Breaks up the white and matches the reference vehicle."""
    obj.data.materials.append(materials["paint_lower"])
    index = len(obj.data.materials) - 1
    for polygon in obj.data.polygons:
        if polygon.center.z < TWO_TONE_Z:
            polygon.material_index = index


def build_greenhouse(materials: dict) -> bpy.types.Object:
    """Roof panel and pillars — the painted parts of the cabin above the belt."""
    bm = bmesh.new()

    roof_front, roof_rear = 0.50, -2.16
    lib.bm_box(bm, ((roof_front + roof_rear) / 2, 0.0, (ROOF_Z + ROOF_TOP) / 2),
               (roof_front - roof_rear, 1.87, ROOF_TOP - ROOF_Z))
    for side in (-1, 1):                                   # rain gutters
        lib.bm_bar(bm, (0.46, side * 0.935, ROOF_Z + 0.035),
                   (-2.10, side * 0.935, ROOF_Z + 0.035), 0.05, 0.07)

    for side in (-1, 1):
        y = side * PILLAR_Y
        # A-pillar follows the windscreen rake.
        lib.bm_bar(bm, (1.03, y, BELT_Z - 0.02), (0.53, y * 0.96, ROOF_Z + 0.06), 0.085, 0.11)
        for x in (-0.34, -1.56, CABIN_REAR_X):             # B, C, D pillars
            lib.bm_bar(bm, (x, y, BELT_Z - 0.02), (x, y * 0.985, ROOF_Z + 0.06), 0.095, 0.10)

    lib.bm_bar(bm, (0.53, -0.89, ROOF_Z + 0.01), (0.53, 0.89, ROOF_Z + 0.01), 0.12, 0.10)
    lib.bm_bar(bm, (CABIN_REAR_X, -0.89, ROOF_Z + 0.01),
               (CABIN_REAR_X, 0.89, ROOF_Z + 0.01), 0.10, 0.10)

    obj = lib.new_mesh_object("CONTINUA_Greenhouse", bm, materials["paint"])
    lib.add_bevel(obj, width=0.014, segments=2, angle_deg=40)
    return obj


def build_glass(materials: dict) -> bpy.types.Object:
    bm = bmesh.new()
    # Windscreen: a thin slab following the A-pillar rake.
    lib.bm_bar(bm, (1.02, 0.0, BELT_Z - 0.01), (0.54, 0.0, ROOF_Z + 0.03), 1.70, 0.024)
    # Rear window.
    lib.bm_box(bm, (CABIN_REAR_X - 0.015, 0.0, 1.655), (0.022, 1.66, 0.44))
    # Side glazing: front door, rear door, quarter light.
    for side in (-1, 1):
        y = side * GLASS_Y
        for x_center, length in ((0.29, 1.34), (-0.98, 1.08), (-1.83, 0.44)):
            lib.bm_box(bm, (x_center, y, 1.655), (length, 0.020, 0.44))
    return lib.new_mesh_object("CONTINUA_Glass", bm, materials["glass"])


def build_interior(materials: dict, detail: str) -> list[bpy.types.Object]:
    """A real cabin interior.

    Without this the greenhouse is a hollow glass box you can see straight
    through, which is the single biggest giveaway that a vehicle is fake.
    Seat backs deliberately rise above the beltline so no sightline passes
    cleanly through the cabin.
    """
    shell = bmesh.new()
    soft = bmesh.new()
    accent = bmesh.new()

    # Floor pan, headliner, bulkhead, cargo bay.
    lib.bm_box(shell, (-0.55, 0.0, 0.80), (3.05, 1.76, 0.08))
    lib.bm_box(shell, (-0.80, 0.0, ROOF_Z - 0.04), (2.60, 1.78, 0.07))
    lib.bm_box(shell, (1.00, 0.0, 1.05), (0.10, 1.76, 0.55))            # firewall
    lib.bm_box(shell, (-1.72, 0.0, 1.06), (0.82, 1.74, 0.56))           # cargo module
    lib.bm_box(shell, (-1.72, 0.0, 1.42), (0.74, 1.62, 0.20))           # equipment rack

    # Dashboard, console, steering wheel.
    lib.bm_box(shell, (0.86, 0.0, 1.28), (0.26, 1.74, 0.34))
    lib.bm_box(shell, (0.50, 0.0, 1.02), (0.50, 0.34, 0.36))            # centre console
    lib.bm_cylinder(shell, (0.66, 0.42, 1.32), 0.165, 0.035, 18, axis="X")
    lib.bm_cylinder(shell, (0.68, 0.42, 1.32), 0.045, 0.10, 12, axis="X")

    # Seats: bases and backs. Backs reach above the beltline on purpose.
    for x_base, x_back, y in ((0.30, 0.06, 0.42), (0.30, 0.06, -0.42),
                              (-0.72, -0.96, 0.42), (-0.72, -0.96, -0.42)):
        lib.bm_box(soft, (x_base, y, 1.00), (0.56, 0.52, 0.16))
        lib.bm_box(soft, (x_back, y, 1.34), (0.16, 0.52, 0.62))
        lib.bm_box(soft, (x_back - 0.01, y, 1.68), (0.15, 0.26, 0.16))  # headrest

    # The console screen: the one place a CONTINUA accent belongs inside.
    if detail == "hero":
        lib.bm_box(accent, (0.735, 0.0, 1.34), (0.02, 0.34, 0.19))

    objects = [
        lib.new_mesh_object("CONTINUA_InteriorShell", shell, materials["interior"]),
        lib.new_mesh_object("CONTINUA_InteriorSeats", soft, materials["interior_soft"]),
    ]
    if detail == "hero":
        objects.append(lib.new_mesh_object("CONTINUA_InteriorScreen", accent,
                                           materials["accent_cyan"]))
    else:
        accent.free()
    return objects


# ==========================================================================
# Black trim: arches, bumpers, sills, panel gaps
# ==========================================================================


def build_trim(materials: dict, detail: str) -> bpy.types.Object:
    bm = bmesh.new()
    steps = 20 if detail == "hero" else 10

    # --- wheel arch flares, swept as one continuous solid per wheel ---
    for axle_x in (AXLE_F, AXLE_R):
        outer = lib.arc_points(axle_x, WHEEL_R, ARCH_R + 0.105, 198.0, -18.0, steps)
        inner = lib.arc_points(axle_x, WHEEL_R, ARCH_R + 0.010, -18.0, 198.0, steps)
        for side in (-1, 1):
            center_y = side * 0.95
            lib.bm_prism(bm, outer + inner, center_y - 0.145, center_y + 0.145)

    # --- front bumper, skid plate and brush guard ---
    lib.bm_box(bm, (2.32, 0.0, 0.70), (0.20, 1.98, 0.30))
    lib.bm_box(bm, (2.30, 0.0, 0.50), (0.30, 1.66, 0.06))               # skid plate
    lib.bm_box(bm, (2.40, 0.0, 0.72), (0.10, 0.68, 0.22))               # winch plate
    lib.bm_cylinder(bm, (2.40, 0.0, 0.76), 0.062, 0.52, 14, axis="Y")   # winch drum
    for side in (-1, 1):
        lib.bm_box(bm, (2.42, side * 0.62, 0.70), (0.14, 0.09, 0.10))   # tow hook
        lib.bm_box(bm, (2.30, side * 0.90, 0.86), (0.16, 0.10, 0.14))   # bumper end cap

    # --- rear bumper and tow point ---
    lib.bm_box(bm, (-2.34, 0.0, 0.70), (0.20, 1.98, 0.30))
    lib.bm_box(bm, (-2.32, 0.0, 0.50), (0.28, 1.56, 0.06))
    lib.bm_box(bm, (-2.44, 0.0, 0.66), (0.10, 0.20, 0.12))

    # --- rock sliders / side steps ---
    for side in (-1, 1):
        lib.bm_bar(bm, (-1.02, side * 0.985, 0.44), (1.02, side * 0.985, 0.44), 0.11, 0.09)
        for x in (-0.85, 0.0, 0.85):
            lib.bm_bar(bm, (x, side * 0.94, 0.52), (x, side * 0.985, 0.44), 0.05, 0.05)

    # --- door handles and panel gaps ---
    for side in (-1, 1):
        for x in (0.30, -0.84):
            lib.bm_box(bm, (x, side * 0.973, 1.18), (0.17, 0.035, 0.05))
        if detail == "hero":
            # Shut lines: thin proud strips read as panel gaps at this scale.
            for x in (1.02, -0.36, -1.58):
                lib.bm_box(bm, (x, side * 0.963, 1.00), (0.014, 0.020, 0.86))
            lib.bm_box(bm, (-0.60, side * 0.963, 1.42), (2.00, 0.020, 0.014))

    obj = lib.new_mesh_object("CONTINUA_Trim", bm, materials["trim"])
    lib.add_bevel(obj, width=0.012, segments=2, angle_deg=44)
    return obj


def build_chassis(materials: dict) -> bpy.types.Object:
    """Visible underbody. It is seen from the low overview camera, so it exists."""
    bm = bmesh.new()

    for side in (-1, 1):
        lib.bm_bar(bm, (-2.02, side * 0.42, 0.35), (2.02, side * 0.42, 0.35), 0.11, 0.13)
    for x in (1.72, 0.58, -0.62, -1.78):
        lib.bm_bar(bm, (x, -0.42, 0.35), (x, 0.42, 0.35), 0.09, 0.09)

    for axle_x in (AXLE_F, AXLE_R):
        lib.bm_cylinder(bm, (axle_x, 0.0, WHEEL_R), 0.058, 1.52, 14, axis="Y")
        lib.bm_sphere(bm, (axle_x, 0.13, WHEEL_R), 0.135, 12, 8, scale=(1.0, 0.85, 1.0))
        for side in (-1, 1):
            lib.bm_bar(bm, (axle_x, side * 0.60, WHEEL_R),
                       (axle_x - math.copysign(0.42, axle_x), side * 0.46, 0.40), 0.07, 0.07)
            lib.bm_cylinder(bm, (axle_x - math.copysign(0.06, axle_x), side * 0.58, 0.60),
                            0.042, 0.42, 10, axis="Z")
    lib.bm_box(bm, (0.24, 0.05, 0.36), (0.52, 0.34, 0.28))              # transfer case
    lib.bm_cylinder(bm, (0.95, 0.09, 0.38), 0.036, 0.90, 10, axis="X")
    lib.bm_cylinder(bm, (-0.60, 0.09, 0.38), 0.036, 1.55, 10, axis="X")
    lib.bm_cylinder(bm, (-0.85, -0.56, 0.30), 0.046, 2.30, 10, axis="X")   # exhaust
    lib.bm_cylinder(bm, (-2.08, -0.56, 0.32), 0.058, 0.28, 10, axis="X")
    lib.bm_box(bm, (-0.95, 0.18, 0.36), (0.80, 0.62, 0.24))             # fuel tank
    lib.bm_box(bm, (1.30, 0.0, 0.31), (0.90, 0.80, 0.04))               # skid protection

    obj = lib.new_mesh_object("CONTINUA_Chassis", bm, materials["metal_dark"])
    lib.add_bevel(obj, width=0.010, segments=1, angle_deg=45)
    return obj


# ==========================================================================
# Lighting clusters and mirrors
# ==========================================================================


def build_front_lights(materials: dict) -> list[bpy.types.Object]:
    bezel = bmesh.new()
    lens = bmesh.new()
    amber = bmesh.new()
    for side in (-1, 1):
        y = side * 0.685
        # Round headlamp: bezel behind, reflector, then a proud lens.
        # Nothing opaque may sit in front of the lens or it renders as a dark disc.
        lib.bm_cylinder(bezel, (2.170, y, 1.11), 0.152, 0.10, 22, axis="X")
        lib.bm_cone(bezel, (2.208, y, 1.11), 0.072, 0.132, 0.06, 22, axis="X")
        lib.bm_cylinder(lens, (2.252, y, 1.11), 0.122, 0.036, 22, axis="X")
        # Indicator: amber, recessed into the fascia.
        lib.bm_box(bezel, (2.196, side * 0.845, 1.03), (0.05, 0.13, 0.11))
        lib.bm_box(amber, (2.223, side * 0.845, 1.03), (0.02, 0.09, 0.07))
        # Auxiliary lamp on the bumper.
        lib.bm_cylinder(bezel, (2.398, side * 0.46, 0.74), 0.070, 0.07, 14, axis="X")
        lib.bm_cylinder(lens, (2.438, side * 0.46, 0.74), 0.052, 0.030, 14, axis="X")

    # Upper grille and a lower intake, both recessed behind the fascia line.
    lib.bm_box(bezel, (2.160, 0.0, 1.14), (0.05, 1.00, 0.26))
    for z in (1.05, 1.14, 1.23):
        lib.bm_box(bezel, (2.198, 0.0, z), (0.04, 0.94, 0.036))
    lib.bm_box(bezel, (2.180, 0.0, 0.90), (0.05, 1.24, 0.16))
    for y in (-0.40, 0.0, 0.40):
        lib.bm_box(bezel, (2.208, y, 0.90), (0.04, 0.05, 0.14))

    bezel_obj = lib.new_mesh_object("CONTINUA_LightHousing_Front", bezel, materials["trim"])
    lib.add_bevel(bezel_obj, width=0.008, segments=1)
    lens_obj = lib.new_mesh_object("CONTINUA_Lights_Front", lens, materials["light_front"])
    amber_obj = lib.new_mesh_object("CONTINUA_Indicators", amber, materials["light_amber"])
    return [bezel_obj, lens_obj, amber_obj]


def build_rear_lights(materials: dict) -> list[bpy.types.Object]:
    housing = bmesh.new()
    lens = bmesh.new()
    for side in (-1, 1):
        lib.bm_box(housing, (-2.240, side * 0.775, 1.10), (0.05, 0.23, 0.43))
        lib.bm_box(lens, (-2.268, side * 0.775, 1.16), (0.02, 0.18, 0.26))
        lib.bm_box(lens, (-2.268, side * 0.775, 0.955), (0.02, 0.18, 0.10))
        lib.bm_box(housing, (-2.410, side * 0.84, 0.72), (0.05, 0.16, 0.09))
        lib.bm_box(lens, (-2.437, side * 0.84, 0.72), (0.02, 0.12, 0.06))
    housing_obj = lib.new_mesh_object("CONTINUA_LightHousing_Rear", housing, materials["trim"])
    lib.add_bevel(housing_obj, width=0.008, segments=1)
    lens_obj = lib.new_mesh_object("CONTINUA_Lights_Rear", lens, materials["light_rear"])
    return [housing_obj, lens_obj]


def build_mirrors(materials: dict) -> bpy.types.Object:
    bm = bmesh.new()
    for side in (-1, 1):
        y = side * 0.96
        lib.bm_bar(bm, (1.00, y, 1.50), (1.04, side * 1.13, 1.54), 0.05, 0.05)
        lib.bm_box(bm, (1.05, side * 1.18, 1.54), (0.06, 0.09, 0.17))
    obj = lib.new_mesh_object("CONTINUA_Mirrors", bm, materials["trim"])
    lib.add_bevel(obj, width=0.010, segments=2)
    return obj


# ==========================================================================
# Roof sensor assembly — the reason this rover exists
# ==========================================================================


def build_sensors(materials: dict, detail: str) -> list[bpy.types.Object]:
    frame = bmesh.new()
    housing = bmesh.new()
    lens = bmesh.new()
    accent = bmesh.new()

    rack_z = 2.01
    for side in (-1, 1):
        lib.bm_bar(frame, (0.34, side * 0.84, rack_z), (-2.00, side * 0.84, rack_z), 0.06, 0.055)
        for x in (0.24, -0.62, -1.42, -1.92):
            lib.bm_bar(frame, (x, side * 0.84, ROOF_TOP - 0.01), (x, side * 0.84, rack_z), 0.05, 0.05)
    for x in (0.22, -0.62, -1.42, -1.94):
        lib.bm_bar(frame, (x, -0.85, rack_z + 0.005), (x, 0.85, rack_z + 0.005), 0.05, 0.042)

    # LiDAR: mast, housing, glass band, cap.
    lidar_x = -0.62
    lib.bm_cylinder(housing, (lidar_x, 0.0, rack_z + 0.05), 0.055, 0.10, 12, axis="Z")
    lib.bm_cylinder(housing, (lidar_x, 0.0, rack_z + 0.11), 0.105, 0.06, 24, axis="Z")
    lib.bm_cylinder(lens, (lidar_x, 0.0, rack_z + 0.175), 0.098, 0.075, 24, axis="Z")
    lib.bm_cylinder(housing, (lidar_x, 0.0, rack_z + 0.235), 0.105, 0.05, 24, axis="Z")

    # Forward camera pod with two lenses.
    lib.bm_box(housing, (0.04, 0.0, rack_z + 0.10), (0.24, 0.34, 0.15))
    for y in (-0.09, 0.09):
        lib.bm_cylinder(lens, (0.17, y, rack_z + 0.10), 0.045, 0.05, 14, axis="X")

    # Satellite terminal dome and GNSS puck — the story's remote link.
    lib.bm_cylinder(housing, (-1.42, -0.44, rack_z + 0.035), 0.14, 0.05, 18, axis="Z")
    lib.bm_sphere(housing, (-1.42, -0.44, rack_z + 0.06), 0.125, 16, 8, scale=(1.0, 1.0, 0.80))
    lib.bm_cylinder(housing, (-1.42, 0.44, rack_z + 0.04), 0.075, 0.045, 14, axis="Z")

    for side in (-1, 1):
        lib.bm_cylinder(housing, (-1.94, side * 0.62, rack_z + 0.04), 0.030, 0.05, 10, axis="Z")
        lib.bm_cylinder(housing, (-1.94, side * 0.62, rack_z + 0.26), 0.012, 0.42, 8, axis="Z")

    # Light bar across the front of the rack.
    lib.bm_box(housing, (0.33, 0.0, rack_z + 0.06), (0.07, 1.42, 0.09))
    lib.bm_box(lens, (0.368, 0.0, rack_z + 0.06), (0.03, 1.34, 0.055))

    # Emergency beacons, on proper bases rather than floating.
    if detail == "hero":
        for side in (-1, 1):
            lib.bm_cylinder(housing, (-0.05, side * 0.56, rack_z + 0.045), 0.062, 0.05, 14, axis="Z")
            lib.bm_sphere(accent, (-0.05, side * 0.56, rack_z + 0.07), 0.058, 14, 7,
                          scale=(1.0, 1.0, 0.85))

    objects = [
        lib.new_mesh_object("CONTINUA_SensorFrame", frame, materials["metal_dark"]),
        lib.new_mesh_object("CONTINUA_SensorHousing", housing, materials["sensor"]),
        lib.new_mesh_object("CONTINUA_SensorLens", lens, materials["sensor_lens"]),
    ]
    if detail == "hero":
        objects.append(lib.new_mesh_object("CONTINUA_Beacons", accent, materials["accent_blue"]))
    else:
        accent.free()
    for obj in objects[:2]:
        lib.add_bevel(obj, width=0.008, segments=1)
    return objects


# ==========================================================================
# Identification text — small, and ours
# ==========================================================================


def build_identity(materials: dict) -> list[bpy.types.Object]:
    """Door and tailgate identification.

    Orientation matters: viewed from the +Y flank the vehicle's nose is on the
    observer's left, so that side must read along -X. Getting this wrong prints
    the name backwards, which is exactly what a first pass does.
    """
    half = math.pi / 2

    def text_object(name: str, body: str, location, rotation, size: float,
                    material: bpy.types.Material) -> bpy.types.Object:
        curve = bpy.data.curves.new(name + "_curve", type="FONT")
        curve.body = body
        curve.size = size
        curve.extrude = 0.0035
        curve.align_x = "CENTER"
        curve.align_y = "CENTER"
        curve.space_character = 1.15
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
        return mesh_obj

    created = [
        # Left flank (+Y): normal +Y, reading -X.
        text_object("CONTINUA_Ident_L", "CONTINUA", (0.16, 0.968, 1.02),
                    (half, 0.0, math.pi), 0.105, materials["accent_blue"]),
        text_object("CONTINUA_Unit_L", "INSPECTION UNIT 04", (0.16, 0.968, 0.90),
                    (half, 0.0, math.pi), 0.042, materials["trim"]),
        # Right flank (-Y): normal -Y, reading +X.
        text_object("CONTINUA_Ident_R", "CONTINUA", (0.16, -0.968, 1.02),
                    (half, 0.0, 0.0), 0.105, materials["accent_blue"]),
        text_object("CONTINUA_Unit_R", "INSPECTION UNIT 04", (0.16, -0.968, 0.90),
                    (half, 0.0, 0.0), 0.042, materials["trim"]),
        # Tailgate (-X): normal -X, reading -Y.
        text_object("CONTINUA_Ident_Rear", "CONTINUA", (-2.243, 0.0, 1.20),
                    (half, 0.0, -half), 0.088, materials["accent_blue"]),
    ]
    return created


# ==========================================================================
# Wheels
# ==========================================================================


def build_wheel(materials: dict, name: str, detail: str) -> bpy.types.Object:
    """One wheel, built at the origin with the axle on Y. Origin = wheel centre."""
    segments = 44 if detail == "hero" else 18

    tyre = bmesh.new()
    tyre_profile = [
        (0.276, -TYRE_HALF_W + 0.01), (0.300, -TYRE_HALF_W),
        (0.352, -TYRE_HALF_W - 0.005), (0.392, -0.135),
        (0.402, -0.072), (0.405, 0.0), (0.402, 0.072),
        (0.392, 0.135), (0.352, TYRE_HALF_W + 0.005),
        (0.300, TYRE_HALF_W), (0.276, TYRE_HALF_W - 0.01),
        (0.272, TYRE_HALF_W - 0.01), (0.272, -TYRE_HALF_W + 0.01),
    ]
    lib.bm_revolve(tyre, tyre_profile, segments=segments)

    if detail == "hero":
        blocks = 34
        for row, y_off in ((0, -0.075), (1, 0.075)):
            for index in range(blocks):
                angle = 2 * math.pi * (index + 0.5 * row) / blocks
                center = Matrix.Rotation(angle, 4, "Y") @ Vector((0.402, y_off, 0.0))
                lib.bm_box(tyre, center, (0.055, 0.085, 0.028),
                           rotation=Matrix.Rotation(-angle, 4, "Y"))
        for index in range(blocks // 2):
            angle = 2 * math.pi * index / (blocks // 2)
            for y_off in (-0.150, 0.150):
                center = Matrix.Rotation(angle, 4, "Y") @ Vector((0.372, y_off, 0.0))
                lib.bm_box(tyre, center, (0.075, 0.055, 0.030),
                           rotation=Matrix.Rotation(-angle, 4, "Y"))

    tyre_obj = lib.new_mesh_object(name + "_Tyre", tyre, materials["rubber"])

    rim = bmesh.new()
    lib.bm_revolve(rim, [(0.256, -0.150), (0.274, -0.150), (0.274, 0.150), (0.256, 0.150)],
                   segments=segments)                                       # barrel
    lib.bm_revolve(rim, [(0.232, 0.075), (0.272, 0.075), (0.272, 0.118), (0.232, 0.118)],
                   segments=segments)                                       # outer lip
    lib.bm_cylinder(rim, (0.0, -0.115, 0.0), 0.262, 0.035, segments, axis="Y")
    lib.bm_cylinder(rim, (0.0, 0.098, 0.0), 0.085, 0.055, 16, axis="Y")     # hub
    spokes = 6 if detail == "hero" else 5
    for index in range(spokes):
        angle = 2 * math.pi * index / spokes
        inner = Vector((0.070 * math.cos(angle), 0.095, 0.070 * math.sin(angle)))
        outer = Vector((0.250 * math.cos(angle), 0.088, 0.250 * math.sin(angle)))
        lib.bm_bar(rim, inner, outer, 0.052, 0.085)
    if detail == "hero":
        for index in range(5):
            angle = 2 * math.pi * index / 5
            lib.bm_cylinder(rim, (0.050 * math.cos(angle), 0.126, 0.050 * math.sin(angle)),
                            0.016, 0.028, 8, axis="Y")
    rim_obj = lib.new_mesh_object(name + "_Rim", rim, materials["rim"])

    brake = bmesh.new()
    lib.bm_cylinder(brake, (0.0, -0.010, 0.0), 0.196, 0.026, 22, axis="Y")
    lib.bm_box(brake, (-0.150, -0.010, 0.115), (0.09, 0.10, 0.16))
    brake_obj = lib.new_mesh_object(name + "_Brake", brake, materials["metal_dark"])

    wheel = lib.join_objects([tyre_obj, rim_obj, brake_obj], name)
    lib.shade_auto(wheel, 32.0)
    return wheel


# ==========================================================================
# Assembly
# ==========================================================================


def build_vehicle(detail: str = "hero") -> tuple[bpy.types.Object, list[bpy.types.Object]]:
    materials = lib.continua_materials()

    shell = build_lower_body(materials)
    greenhouse = build_greenhouse(materials)
    glass = build_glass(materials)
    interior = build_interior(materials, detail)
    trim = build_trim(materials, detail)
    chassis = build_chassis(materials)
    front_lights = build_front_lights(materials)
    rear_lights = build_rear_lights(materials)
    mirrors = build_mirrors(materials)
    sensors = build_sensors(materials, detail)

    # Bevels must be real geometry before shading, two-toning and export.
    for obj in [shell, greenhouse, trim, chassis, mirrors] + front_lights + rear_lights + sensors:
        lib.apply_modifiers(obj)

    apply_two_tone(shell, materials)
    identity = build_identity(materials) if detail == "hero" else []

    body = lib.join_objects([shell, greenhouse] + identity, "CONTINUA_Body")
    lib.shade_auto(body, 36.0)

    trim = lib.join_objects([trim, front_lights[0], rear_lights[0]], "CONTINUA_Trim")
    lib.shade_auto(trim, 34.0)

    chassis = lib.join_objects([chassis, mirrors], "CONTINUA_Chassis")
    lib.shade_auto(chassis, 34.0)

    cabin = lib.join_objects(interior, "CONTINUA_Interior")
    lib.shade_auto(cabin, 34.0)

    sensor_assembly = lib.join_objects(sensors, "CONTINUA_SensorAssembly")
    lib.shade_auto(sensor_assembly, 34.0)

    # Headlamps + amber indicators share one node; materials survive the join.
    lights_front = lib.join_objects(front_lights[1:], "CONTINUA_Lights_Front")
    lights_rear = rear_lights[1]
    lights_rear.name = "CONTINUA_Lights_Rear"
    for obj in (lights_front, lights_rear, glass):
        lib.shade_auto(obj, 34.0)

    # --- root, steering pivots and wheels ---
    root = lib.new_empty("CONTINUA_Vehicle", (0.0, 0.0, 0.0), size=0.6, display="ARROWS")
    static_parts = [body, glass, cabin, trim, chassis, lights_front, lights_rear, sensor_assembly]
    for part in static_parts:
        lib.parent_to(part, root)

    wheels: list[bpy.types.Object] = []
    pivots: list[bpy.types.Object] = []
    for tag, axle_x, y, steerable in (
        ("FL", AXLE_F, TRACK_Y, True),
        ("FR", AXLE_F, -TRACK_Y, True),
        ("RL", AXLE_R, TRACK_Y, False),
        ("RR", AXLE_R, -TRACK_Y, False),
    ):
        wheel = build_wheel(materials, f"CONTINUA_Wheel_{tag}", detail)
        if y < 0:  # mirror so the dish and tread face outward on both sides
            wheel.data.transform(Matrix.Diagonal(Vector((1.0, -1.0, 1.0, 1.0))))
            wheel.data.flip_normals()
        if steerable:
            # Steering pivot carries the position; the wheel sits at its origin
            # so `spin` and `steer` stay independent single-axis rotations.
            pivot = lib.new_empty(f"CONTINUA_Steer_{tag}", (axle_x, y, WHEEL_R), size=0.3)
            lib.parent_to(pivot, root, (axle_x, y, WHEEL_R))
            lib.parent_to(wheel, pivot, (0.0, 0.0, 0.0))
            pivots.append(pivot)
        else:
            lib.parent_to(wheel, root, (axle_x, y, WHEEL_R))
        wheels.append(wheel)

    bpy.context.view_layer.update()
    return root, [root] + static_parts + pivots + wheels


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


def main() -> None:
    lib.banner("CONTINUA — building rover (hero detail)")
    lib.reset_scene("CONTINUA_Vehicle")
    _, objects = build_vehicle("hero")
    hero_tris = report(objects)

    lib.save_blend(lib.out_path("assets", "blender", "continua_rover.blend"))
    lib.export_glb(lib.out_path("apps", "web", "public", "models", "continua_rover.glb"), objects)

    lib.banner("CONTINUA — building rover (LOD1)")
    lib.reset_scene("CONTINUA_Vehicle_LOD1")
    _, lod_objects = build_vehicle("lod1")
    lod_tris = report(lod_objects)
    lib.export_glb(lib.out_path("apps", "web", "public", "models", "continua_rover_lod1.glb"),
                   lod_objects)

    lib.banner("Summary")
    print(f"  hero triangles : {hero_tris:,}   (target 30,000 - 80,000)")
    print(f"  lod1 triangles : {lod_tris:,}")
    if not 30_000 <= hero_tris <= 80_000:
        print("  ! hero triangle count is outside the target budget")


if __name__ == "__main__":
    main()
