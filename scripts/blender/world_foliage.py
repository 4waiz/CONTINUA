"""
CONTINUA - foliage that reads as leaves.

The trees used to carry lumpy spheres of colour, and from a few metres away
they read as toys. Every crown is now built the way real-time foliage is:
clusters of small alpha-clipped cards, each showing a spray of leaves - or of
blossom, or a palm's pinnate frond - from one texture atlas, around a darker
inner shell that keeps the sky from showing through the middle. Each card's
normal points out of its cluster, so a crown is lit as one rounded mass -
bright on top and on the sun side, dark beneath - rather than as a heap of
flat quads, and every card gets a slightly different green after the AO bake.

The atlas is drawn here with numpy from fixed seeds: no image file is read,
and the same script always draws the same leaves. It is about a quarter of
the old blobs' triangles.
"""

from __future__ import annotations

import math
import os
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Vector

import continua_arch as arch
import continua_geo as geo
import continua_lib as lib

ATLAS_NAME = "T_FoliageAtlas"
ATLAS_SIZE = 1024

# Atlas regions in UV space (u0, v0, u1, v1), v up.
REGIONS = {
    "leaf": (0.0, 0.5, 0.5, 1.0),
    "bloom": (0.5, 0.5, 1.0, 1.0),
    "frond": (0.0, 0.0, 1.0, 0.5),
}
# Half a few texels in from each region's edge, so mipmaps never bleed.
_INSET = 3.0 / ATLAS_SIZE

# key -> (material name, tint, roughness). The atlas is grey; the tint is the
# colour, and the AO bake (COLOR_0) the shading.
CARD_MATERIALS = {
    "card_leaf": ("W_LeafCard", "#7AB15A", 0.8),
    "card_leaf_dark": ("W_LeafCard_Dark", "#58934A", 0.82),
    "card_leaf_dry": ("W_LeafCard_Dry", "#9DB75A", 0.84),
    "card_ghaf": ("W_LeafCard_Ghaf", "#8DB268", 0.84),
    "card_flame": ("W_BloomCard_Flame", "#F04A2A", 0.7),
    "card_lilac": ("W_BloomCard_Lilac", "#A688EA", 0.7),
    "card_magenta": ("W_BloomCard_Magenta", "#E23D93", 0.7),
    "card_coral": ("W_BloomCard_Coral", "#F7704E", 0.7),
    "card_yellow": ("W_BloomCard_Yellow", "#F8CC36", 0.7),
    "card_white": ("W_BloomCard_White", "#FBF8F1", 0.7),
    "card_frond": ("W_FrondCard", "#72AA50", 0.78),
}
CARD_MATERIAL_NAMES = {name for name, _, _ in CARD_MATERIALS.values()}


# ==========================================================================
# The atlas
# ==========================================================================


def _lens(alpha, lum, bx, by, angle, length, width, shade, rib=True):
    """Paint one leaf (a pointed lens) whose base is at (bx, by)."""
    h, w = alpha.shape
    reach = length + 2.0
    x0, x1 = int(max(0, bx - reach)), int(min(w, bx + reach + 1))
    y0, y1 = int(max(0, by - reach)), int(min(h, by + reach + 1))
    if x0 >= x1 or y0 >= y1:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    dx = xs + 0.5 - bx
    dy = ys + 0.5 - by
    c, s = math.cos(angle), math.sin(angle)
    u = (dx * c + dy * s) / length
    v = -dx * s + dy * c
    half = 0.5 * width * np.power(np.clip(np.sin(np.pi * np.clip(u, 0.0, 1.0)), 0.0, 1.0), 0.7)
    inside = (u > 0.0) & (u < 1.0) & (np.abs(v) < half)
    if not inside.any():
        return
    rel = np.abs(v) / np.maximum(half, 1e-3)
    value = shade * (0.8 + 0.28 * u) * (1.0 - 0.18 * rel * rel)
    if rib:
        value = np.where(np.abs(v) < width * 0.05, value * 0.78, value)
    sub_a = alpha[y0:y1, x0:x1]
    sub_l = lum[y0:y1, x0:x1]
    sub_a[inside] = 1.0
    sub_l[inside] = value[inside]


def _stroke(alpha, lum, p0, p1, width, shade):
    """Paint a straight twig from p0 to p1."""
    h, w = alpha.shape
    x0 = int(max(0, min(p0[0], p1[0]) - width - 1))
    x1 = int(min(w, max(p0[0], p1[0]) + width + 2))
    y0 = int(max(0, min(p0[1], p1[1]) - width - 1))
    y1 = int(min(h, max(p0[1], p1[1]) + width + 2))
    if x0 >= x1 or y0 >= y1:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    ax, ay = p0
    ex, ey = p1[0] - ax, p1[1] - ay
    length_sq = max(ex * ex + ey * ey, 1e-6)
    t = np.clip(((xs + 0.5 - ax) * ex + (ys + 0.5 - ay) * ey) / length_sq, 0.0, 1.0)
    d = np.hypot(xs + 0.5 - (ax + ex * t), ys + 0.5 - (ay + ey * t))
    inside = d < width * (1.0 - 0.6 * t) * 0.5
    alpha[y0:y1, x0:x1][inside] = 1.0
    lum[y0:y1, x0:x1][inside] = shade


def _disc(alpha, lum, cx, cy, radius, shade):
    h, w = alpha.shape
    x0, x1 = int(max(0, cx - radius - 1)), int(min(w, cx + radius + 2))
    y0, y1 = int(max(0, cy - radius - 1)), int(min(h, cy + radius + 2))
    if x0 >= x1 or y0 >= y1:
        return
    ys, xs = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    inside = np.hypot(xs + 0.5 - cx, ys + 0.5 - cy) < radius
    alpha[y0:y1, x0:x1][inside] = 1.0
    lum[y0:y1, x0:x1][inside] = shade


def _leaf_cluster(size: int, seed: int):
    """A spray of leaves on twigs, inside a rough circle."""
    alpha = np.zeros((size, size), np.float32)
    lum = np.zeros((size, size), np.float32)
    rng = np.random.default_rng(seed)
    centre = size / 2.0
    radius = size * 0.46
    for k in range(8):
        angle = k * 2.0 * math.pi / 8 + rng.uniform(-0.3, 0.3)
        tip = (centre + math.cos(angle) * radius * 0.85, centre + math.sin(angle) * radius * 0.85)
        _stroke(alpha, lum, (centre, centre), tip, size * 0.012, 0.32)
    for _ in range(240):
        angle = rng.uniform(0.0, 2.0 * math.pi)
        reach = radius * (0.1 + 0.76 * math.sqrt(rng.uniform()))
        bx = centre + math.cos(angle) * reach
        by = centre + math.sin(angle) * reach
        length = size * rng.uniform(0.085, 0.13) * (1.0 - 0.25 * reach / radius)
        _lens(alpha, lum, bx, by, angle + rng.uniform(-0.75, 0.75), length,
              length * rng.uniform(0.36, 0.48), rng.uniform(0.6, 1.0))
    return alpha, lum


def _bloom_cluster(size: int, seed: int):
    """Five-petalled flowers and buds, heaped in a rough circle."""
    alpha = np.zeros((size, size), np.float32)
    lum = np.zeros((size, size), np.float32)
    rng = np.random.default_rng(seed)
    centre = size / 2.0
    radius = size * 0.45
    for _ in range(130):
        angle = rng.uniform(0.0, 2.0 * math.pi)
        reach = radius * math.sqrt(rng.uniform()) * 0.92
        fx = centre + math.cos(angle) * reach
        fy = centre + math.sin(angle) * reach
        petal = size * rng.uniform(0.028, 0.045)
        shade = rng.uniform(0.7, 1.0)
        turn = rng.uniform(0.0, 2.0 * math.pi)
        for p in range(5):
            _lens(alpha, lum, fx, fy, turn + p * 2.0 * math.pi / 5, petal, petal * 0.8,
                  shade * rng.uniform(0.9, 1.05), rib=False)
        _disc(alpha, lum, fx, fy, petal * 0.22, shade * 0.55)
    for _ in range(40):
        angle = rng.uniform(0.0, 2.0 * math.pi)
        reach = radius * math.sqrt(rng.uniform())
        _disc(alpha, lum, centre + math.cos(angle) * reach, centre + math.sin(angle) * reach,
              size * rng.uniform(0.008, 0.014), rng.uniform(0.6, 0.85))
    return alpha, lum


def _frond_texture(width: int, height: int, seed: int):
    """A pinnate palm frond along +u: a rachis and two rows of leaflets."""
    alpha = np.zeros((height, width), np.float32)
    lum = np.zeros((height, width), np.float32)
    rng = np.random.default_rng(seed)
    cy = height / 2.0
    count = 52
    for side in (-1.0, 1.0):
        for i in range(count):
            t = (i + 0.5) / count
            x = t * width * 0.97
            length = height * 0.49 * (math.sin(math.pi * min(1.0, t * 1.08)) ** 0.45) * (1.0 - 0.3 * t)
            if length < 2.0:
                continue
            angle = side * rng.uniform(0.8, 1.05)
            _lens(alpha, lum, x, cy, angle, length, length * rng.uniform(0.11, 0.15),
                  rng.uniform(0.68, 1.0))
    _stroke(alpha, lum, (0.0, cy), (width * 0.985, cy), height * 0.035, 0.55)
    return alpha, lum


def _downsample(alpha, lum, factor: int = 2):
    """Box-filter a supersampled drawing: coverage alpha, colour-weighted luminance."""
    h, w = alpha.shape
    a = alpha.reshape(h // factor, factor, w // factor, factor)
    l = (lum * alpha).reshape(h // factor, factor, w // factor, factor)
    coverage = a.mean(axis=(1, 3))
    weighted = l.sum(axis=(1, 3))
    total = a.sum(axis=(1, 3))
    value = np.where(total > 0, weighted / np.maximum(total, 1e-6), 0.0)
    return coverage, value


def _bleed(lum, alpha, passes: int = 24):
    """Carry each leaf's tone outward into the transparent texels around it,
    so filtering at a clipped edge blends leaf into leaf, never into a flat
    fill that rims every leaf with a light or dark fringe."""
    filled = alpha > 0.0
    value = np.where(filled, lum, 0.0).astype(np.float32)
    for _ in range(passes):
        if filled.all():
            break
        weight = filled.astype(np.float32)
        pv = np.pad(value * weight, 1, mode="edge")
        pw = np.pad(weight, 1, mode="edge")
        h, w = value.shape
        sv = sum(pv[1 + dy:1 + dy + h, 1 + dx:1 + dx + w] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        sw = sum(pw[1 + dy:1 + dy + h, 1 + dx:1 + dx + w] for dy in (-1, 0, 1) for dx in (-1, 0, 1))
        grow = (~filled) & (sw > 0.0)
        value = np.where(grow, sv / np.maximum(sw, 1e-6), value)
        filled = filled | grow
    mean = float(lum[alpha > 0.5].mean()) if (alpha > 0.5).any() else 0.75
    return np.where(filled, value, mean)


def atlas() -> bpy.types.Image:
    """Draw (once) and pack the foliage atlas: leaves, blossom, palm frond."""
    if ATLAS_NAME in bpy.data.images:
        return bpy.data.images[ATLAS_NAME]
    n = ATLAS_SIZE
    half = n // 2
    alpha = np.zeros((n, n), np.float32)
    lum = np.zeros((n, n), np.float32)
    # Rows run v up (row 0 is v = 0), as Blender stores pixels.
    a, l = _downsample(*_leaf_cluster(half * 2, 7))
    alpha[half:, :half], lum[half:, :half] = a, l
    a, l = _downsample(*_bloom_cluster(half * 2, 11))
    alpha[half:, half:], lum[half:, half:] = a, l
    a, l = _downsample(*_frond_texture(n * 2, half * 2, 13))
    alpha[:half, :], lum[:half, :] = a, l
    # Transparent texels carry the nearest leaves' tone, so filtering never fringes.
    rgb = _bleed(lum, alpha)
    pixels = np.empty((n, n, 4), np.float32)
    pixels[..., 0] = rgb
    pixels[..., 1] = rgb
    pixels[..., 2] = rgb
    pixels[..., 3] = alpha
    image = bpy.data.images.new(ATLAS_NAME, width=n, height=n, alpha=True)
    image.colorspace_settings.name = "sRGB"
    image.pixels.foreach_set(pixels.ravel())
    # Lossless WebP (quality 100): a third of the PNG's size. The glTF exporter
    # keeps a packed WebP as WebP (EXT_texture_webp), which three.js reads.
    image.file_format = "WEBP"
    path = os.path.join(tempfile.gettempdir(), "continua_foliage_atlas.webp")
    image.filepath_raw = path
    image.save(quality=100)
    image.pack()
    return image


# ==========================================================================
# Materials
# ==========================================================================


def _card_material(name: str, tint: str, roughness: float, image: bpy.types.Image) -> bpy.types.Material:
    """Atlas x AO x tint into base colour, the atlas alpha clipped at 0.5.

    The node layout is the one the glTF exporter recognises: base colour
    factor (the tint) times COLOR_0 times the texture, and Math:Round on the
    texture's alpha, which exports as alphaMode MASK with a 0.5 cutoff.
    """
    if name in bpy.data.materials:
        return bpy.data.materials[name]
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    tree = material.node_tree
    bsdf = next(n for n in tree.nodes if n.type == "BSDF_PRINCIPLED")
    texture = tree.nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Linear"
    texture.extension = "EXTEND"
    ao = tree.nodes.new("ShaderNodeVertexColor")
    ao.layer_name = geo.AO_ATTRIBUTE
    shade = tree.nodes.new("ShaderNodeMix")
    shade.data_type = "RGBA"
    shade.blend_type = "MULTIPLY"
    shade.inputs["Factor"].default_value = 1.0
    tree.links.new(ao.outputs["Color"], shade.inputs[6])
    tree.links.new(texture.outputs["Color"], shade.inputs[7])
    tinted = tree.nodes.new("ShaderNodeMix")
    tinted.data_type = "RGBA"
    tinted.blend_type = "MULTIPLY"
    tinted.inputs["Factor"].default_value = 1.0
    tinted.inputs[6].default_value = lib.srgb(tint)
    tree.links.new(shade.outputs[2], tinted.inputs[7])
    tree.links.new(tinted.outputs[2], bsdf.inputs["Base Color"])
    clip = tree.nodes.new("ShaderNodeMath")
    clip.operation = "ROUND"
    tree.links.new(texture.outputs["Alpha"], clip.inputs[0])
    tree.links.new(clip.outputs[0], bsdf.inputs["Alpha"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    material.use_backface_culling = False
    if hasattr(material, "surface_render_method"):
        material.surface_render_method = "DITHERED"
    material.diffuse_color = lib.srgb(tint)
    return material


def add_materials(materials: dict) -> dict:
    image = atlas()
    for key, (name, tint, roughness) in CARD_MATERIALS.items():
        materials[key] = _card_material(name, tint, roughness, image)
    return materials


# ==========================================================================
# Geometry
# ==========================================================================


def _layers(bm):
    uv = bm.loops.layers.uv.verify()
    names = ("cc_x", "cc_y", "cc_z", "cc_s")
    layers = [bm.faces.layers.float.get(n) or bm.faces.layers.float.new(n) for n in names]
    return uv, layers


def _region_uvs(region: str, flip: bool):
    u0, v0, u1, v1 = REGIONS[region]
    u0, v0, u1, v1 = u0 + _INSET, v0 + _INSET, u1 - _INSET, v1 - _INSET
    uvs = [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]
    if flip:
        uvs = [(u0 + u1 - u, v) for u, v in uvs]
    return uvs


def canopy(bm, centre, radii, count: int, seed: int, *, region: str = "leaf", card: float = 1.1,
           upward: float = 0.0) -> None:
    """`count` cards in an ellipsoid crown cluster, crowded toward its surface.

    `upward` tilts the cards' facing toward the sky (blossom carried on top).
    """
    rng = arch.rng(seed)
    uv, (lx, ly, lz, ls) = _layers(bm)
    ax, ay, az = radii
    c = Vector(centre)
    for _ in range(count):
        z = rng.uniform(-0.55 + 0.6 * upward, 1.0)
        phi = rng.uniform(0.0, 2.0 * math.pi)
        r = math.sqrt(max(0.0, 1.0 - z * z))
        out = Vector((r * math.cos(phi), r * math.sin(phi), z))
        depth = 0.45 + 0.55 * math.sqrt(rng.random())
        p = c + Vector((out.x * ax * depth, out.y * ay * depth, out.z * az * depth))
        jitter = Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)))
        normal = (out * 0.6 + jitter.normalized() * 0.4 + Vector((0, 0, upward))).normalized()
        t1 = normal.orthogonal().normalized()
        t2 = normal.cross(t1).normalized()
        turn = rng.uniform(0.0, 2.0 * math.pi)
        t1, t2 = t1 * math.cos(turn) + t2 * math.sin(turn), t2 * math.cos(turn) - t1 * math.sin(turn)
        s = 0.5 * card * rng.uniform(0.8, 1.2)
        verts = [bm.verts.new(p + a * t1 * s + b * t2 * s) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
        face = bm.faces.new(verts)
        for loop, coords in zip(face.loops, _region_uvs(region, rng.random() < 0.5)):
            loop[uv].uv = coords
        face[lx], face[ly], face[lz] = c.x, c.y, c.z
        face[ls] = az / max(ax, ay)


def shell(bm, centre, radii, seed: int) -> None:
    """The crown's dark core: a coarse, lumpy ellipsoid inside the cards."""
    rng = arch.rng(seed)
    tmp = bmesh.new()
    bmesh.ops.create_icosphere(tmp, subdivisions=1, radius=1.0)
    phase = rng.uniform(0.0, 6.28)
    for v in tmp.verts:
        n = v.co.normalized()
        lump = 0.12 * math.sin(n.x * 4.1 + phase) * math.cos(n.y * 3.3 + phase)
        v.co = Vector((n.x * radii[0], n.y * radii[1], n.z * radii[2])) * (1.0 + lump)
    bmesh.ops.translate(tmp, verts=tmp.verts[:], vec=Vector(centre))
    mesh = bpy.data.meshes.new("tmp_shell")
    tmp.to_mesh(mesh)
    tmp.free()
    bm.from_mesh(mesh)
    bpy.data.meshes.remove(mesh)


def crown(k, card_key: str, shell_key: str | None, centre, radii, count: int, seed: int, *,
          region: str = "leaf", card: float = 1.1, upward: float = 0.0, core: float = 0.68) -> None:
    """One cluster: its cards, and (optionally) its dark core."""
    canopy(k[card_key], centre, radii, count, seed, region=region, card=card, upward=upward)
    if shell_key:
        shell(k[shell_key], centre, tuple(r * core for r in radii), seed + 1)


def frond(bm, base: Vector, direction: float, droop: float, length: float, width: float,
          crown_centre: Vector) -> None:
    """A palm frond: one arching, V-folded sheet carrying the pinnate texture."""
    uv, (lx, ly, lz, ls) = _layers(bm)
    u0, v0, u1, v1 = REGIONS["frond"]
    u0, v0, u1, v1 = u0 + _INSET, v0 + _INSET, u1 - _INSET, v1 - _INSET
    steps = 8
    side = Vector((-math.sin(direction), math.cos(direction), 0.0))
    rows = []
    for i in range(steps + 1):
        t = i / steps
        along = length * t
        centre = base + Vector((math.cos(direction) * along, math.sin(direction) * along,
                                1.08 * length * t * (1.0 - t) - droop * t * t * length))
        w = width * (1.0 - 0.35 * t)
        fold = Vector((0.0, 0.0, -0.22 * w))
        rows.append([bm.verts.new(centre + side * w + fold), bm.verts.new(centre + Vector((0, 0, 0.03))),
                     bm.verts.new(centre - side * w + fold)])
    vs = (v0, (v0 + v1) / 2.0, v1)
    for i in range(steps):
        for j in range(2):
            face = bm.faces.new((rows[i][j], rows[i + 1][j], rows[i + 1][j + 1], rows[i][j + 1]))
            ua = u0 + (u1 - u0) * i / steps
            ub = u0 + (u1 - u0) * (i + 1) / steps
            for loop, coords in zip(face.loops, ((ua, vs[j]), (ub, vs[j]), (ub, vs[j + 1]), (ua, vs[j + 1]))):
                loop[uv].uv = coords
            face[lx], face[ly], face[lz] = crown_centre.x, crown_centre.y, crown_centre.z
            face[ls] = 0.55


# ==========================================================================
# After the prop is joined: normals; after the AO bake: variety
# ==========================================================================


def _card_slots(mesh) -> set[int]:
    return {i for i, m in enumerate(mesh.materials) if m is not None and m.name in CARD_MATERIAL_NAMES}


def finish_cards(obj: bpy.types.Object) -> None:
    """Point every card's normals out of its cluster's ellipsoid (blended
    with the card's own facing), and drop the helper attributes."""
    mesh = obj.data
    slots = _card_slots(mesh)
    names = ("cc_x", "cc_y", "cc_z", "cc_s")
    attrs = [mesh.attributes.get(n) for n in names]
    if slots and all(a is not None for a in attrs):
        polys = len(mesh.polygons)
        centres = np.zeros((4, polys), np.float32)
        for i, a in enumerate(attrs):
            a.data.foreach_get("value", centres[i])
        material = np.zeros(polys, np.int32)
        mesh.polygons.foreach_get("material_index", material)
        starts = np.zeros(polys, np.int32)
        totals = np.zeros(polys, np.int32)
        mesh.polygons.foreach_get("loop_start", starts)
        mesh.polygons.foreach_get("loop_total", totals)
        face_normals = np.zeros(polys * 3, np.float32)
        mesh.polygons.foreach_get("normal", face_normals)
        face_normals = face_normals.reshape(-1, 3)
        loops = len(mesh.loops)
        corner = np.zeros(loops * 3, np.float32)
        mesh.corner_normals.foreach_get("vector", corner)
        corner = corner.reshape(-1, 3)
        coords = np.zeros(len(mesh.vertices) * 3, np.float32)
        mesh.vertices.foreach_get("co", coords)
        coords = coords.reshape(-1, 3)
        loop_vertex = np.zeros(loops, np.int32)
        mesh.loops.foreach_get("vertex_index", loop_vertex)
        smooth = np.zeros(polys, bool)
        mesh.polygons.foreach_get("use_smooth", smooth)
        for p in range(polys):
            if int(material[p]) not in slots:
                continue
            smooth[p] = True
            centre = centres[:3, p]
            squash = max(float(centres[3, p]), 0.2)
            pn = face_normals[p]
            for li in range(starts[p], starts[p] + totals[p]):
                d = coords[loop_vertex[li]] - centre
                d[2] /= squash * squash
                length = float(np.linalg.norm(d))
                out = d / length if length > 1e-5 else np.array((0.0, 0.0, 1.0), np.float32)
                facing = pn if float(np.dot(pn, out)) >= 0.0 else -pn
                n = out * 0.8 + facing * 0.2
                corner[li] = n / max(float(np.linalg.norm(n)), 1e-6)
        mesh.polygons.foreach_set("use_smooth", smooth)
        mesh.normals_split_custom_set(corner.tolist())
    for name in names:
        attribute = mesh.attributes.get(name)
        if attribute is not None:
            mesh.attributes.remove(attribute)
    mesh.update()


def vary_cards(objects, seed: int = 0) -> None:
    """After the AO bake: one random shade per card - some yellower, some
    bluer, some darker - so a crown is not one flat green."""
    for obj in objects:
        if obj.type != "MESH":
            continue
        mesh = obj.data
        slots = _card_slots(mesh)
        attribute = mesh.color_attributes.get(geo.AO_ATTRIBUTE)
        if not slots or attribute is None or attribute.domain != "CORNER":
            continue
        values = np.zeros(len(attribute.data) * 4, np.float32)
        attribute.data.foreach_get("color", values)
        values = values.reshape(-1, 4)
        rng = arch.rng(seed + sum(ord(ch) for ch in obj.name))
        for poly in mesh.polygons:
            if poly.material_index not in slots:
                continue
            f = rng.uniform(0.9, 1.12)
            h = rng.uniform(-1.0, 1.0)
            tint = np.array((f * (1.0 + 0.07 * h), f, f * (1.0 - 0.08 * h)), np.float32)
            for li in poly.loop_indices:
                values[li, :3] = np.clip(values[li, :3] * tint, 0.0, 1.0)
        attribute.data.foreach_set("color", values.ravel())
        mesh.update()
