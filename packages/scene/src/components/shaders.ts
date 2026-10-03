/**
 * Procedural surface shading for the ground, the roads and the sky.
 *
 * Everything is computed in the fragment shader from world position - no
 * texture files, no download, nothing to tile visibly - and it is all a pure
 * function of position, so a frame captured twice is identical.
 *
 * The shaders patch three's `MeshStandardMaterial` through `onBeforeCompile`
 * rather than replacing it, so lighting, shadows, fog and tone mapping are the
 * renderer's own and match every other object in the scene.
 */

import { Color, MeshStandardMaterial, Texture, type WebGLProgramParametersWithUniforms } from 'three';

/** Value noise, fbm and a screen-space bump: shared by every patched shader. */
export const GLSL_NOISE = /* glsl */ `
  float ctHash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float ctNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = ctHash(i);
    float b = ctHash(i + vec2(1.0, 0.0));
    float c = ctHash(i + vec2(0.0, 1.0));
    float d = ctHash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float ctFbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * ctNoise(p);
      p = p * 2.03 + vec2(17.1, 9.2);
      amp *= 0.5;
    }
    return sum;
  }
  // Two octaves, for broad patterns where the fine ones are never seen.
  float ctFbm2(vec2 p) {
    return (ctNoise(p) * 0.5 + ctNoise(p * 2.03 + vec2(17.1, 9.2)) * 0.25) / 0.75;
  }
  // Bump mapping from a scalar height in screen space (Mikkelsen 2010).
  vec3 ctBump(vec3 surfPos, vec3 surfNorm, float height, float scale) {
    vec3 sigmaX = dFdx(surfPos);
    vec3 sigmaY = dFdy(surfPos);
    vec3 r1 = cross(sigmaY, surfNorm);
    vec3 r2 = cross(surfNorm, sigmaX);
    float det = dot(sigmaX, r1);
    vec3 grad = sign(det) * (dFdx(height) * scale * r1 + dFdy(height) * scale * r2);
    return normalize(abs(det) * surfNorm - grad);
  }
`;

type Uniforms = Record<string, { value: unknown }>;

/**
 * Patch a standard material: world position as a varying, extra uniforms, and
 * custom colour / roughness / normal code at the right points of three's
 * shader. `colour` writes `diffuseColor.rgb`; `normal` may perturb `normal`
 * (view space) using `ctBump`. Both see `vCtWorld` and `vCtDist` (distance to
 * the camera) for level-of-detail fades.
 */
export function patchStandard(
  material: MeshStandardMaterial,
  options: {
    key: string;
    uniforms?: Uniforms;
    header?: string;
    colour: string;
    roughness?: string;
    normal?: string;
    /** The low tier's variant: `CT_LITE` is defined, and the shader skips detail. */
    lite?: boolean;
  },
): MeshStandardMaterial {
  const key = options.lite ? `${options.key}-lite` : options.key;
  material.customProgramCacheKey = () => key;
  if (options.lite) material.defines = { ...(material.defines ?? {}), CT_LITE: '' };
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, options.uniforms ?? {});
    const uniformDecl = Object.entries(options.uniforms ?? {})
      .map(([name, entry]) => {
        const value = entry.value;
        const type =
          value instanceof Texture
            ? 'sampler2D'
            : value instanceof Color
              ? 'vec3'
              : typeof value === 'number'
                ? 'float'
                : Array.isArray(value)
                  ? `vec${value.length}`
                  : 'vec4';
        return `uniform ${type} ${name};`;
      })
      .join('\n');

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vCtWorld;
         varying float vCtDist;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vec4 ctWorld = modelMatrix * vec4(transformed, 1.0);
         #ifdef USE_INSTANCING
           ctWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
         #endif
         vCtWorld = ctWorld.xyz;
         vCtDist = distance(ctWorld.xyz, cameraPosition);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vCtWorld;
         varying float vCtDist;
         ${uniformDecl}
         ${GLSL_NOISE}
         ${options.header ?? ''}`,
      )
      .replace('#include <color_fragment>', `#include <color_fragment>\n${options.colour}`);
    if (options.roughness) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\n${options.roughness}`,
      );
    }
    if (options.normal) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>\n${options.normal}`,
      );
    }
  };
  material.needsUpdate = true;
  return material;
}

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

export function terrainMaterial(palette: {
  campus: string;
  grass: string;
  grassLush: string;
  grassDry: string;
  heath: string;
  beach: string;
  rock: string;
  flowers: readonly [string, string, string, string];
  seaLevel: number;
  campusRect: [number, number, number, number];
  /** Scene time, for the cloud shadows; the caller keeps it current. */
  time: { value: number };
}, lite = false): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.94, metalness: 0 });
  return patchStandard(material, {
    key: 'continua-terrain-v6',
    lite,
    uniforms: {
      uCampus: { value: new Color(palette.campus) },
      uGrass: { value: new Color(palette.grass) },
      uGrassLush: { value: new Color(palette.grassLush) },
      uGrassDry: { value: new Color(palette.grassDry) },
      uHeath: { value: new Color(palette.heath) },
      uBeach: { value: new Color(palette.beach) },
      uRock: { value: new Color(palette.rock) },
      uFlowerA: { value: new Color(palette.flowers[0]) },
      uFlowerB: { value: new Color(palette.flowers[1]) },
      uFlowerC: { value: new Color(palette.flowers[2]) },
      uFlowerD: { value: new Color(palette.flowers[3]) },
      uSeaLevel: { value: palette.seaLevel },
      uCampusRect: { value: palette.campusRect },
      uTime: palette.time,
    },
    header: /* glsl */ `
      float ctCampusMask(vec2 p) {
        vec4 r = uCampusRect; // minX, maxX, minZ, maxZ
        float inside = smoothstep(r.x - 6.0, r.x + 6.0, p.x) * (1.0 - smoothstep(r.y - 6.0, r.y + 6.0, p.x))
                     * smoothstep(r.z - 6.0, r.z + 6.0, p.y) * (1.0 - smoothstep(r.w - 6.0, r.w + 6.0, p.y));
        return inside;
      }
      // Wildflowers: one bloom in some cells of a fine grid, a round dot of
      // colour, faded out with distance before it can shimmer.
      vec4 ctBloom(vec2 p, float dist) {
        vec2 grid = p * 4.0;
        vec2 cell = floor(grid);
        float chance = ctHash(cell + 3.1);
        vec2 centre = vec2(ctHash(cell + 7.3), ctHash(cell + 1.9)) * 0.6 + 0.2;
        float r = length(fract(grid) - centre);
        float aa = fwidth(grid.x) * 0.9;
        float bloomDot = 1.0 - smoothstep(0.16 - aa, 0.16 + aa, r);
        float pick = ctHash(cell + 11.7);
        vec3 colour = pick < 0.34 ? uFlowerA : pick < 0.6 ? uFlowerB : pick < 0.82 ? uFlowerC : uFlowerD;
        return vec4(colour, bloomDot * step(0.86, chance) * (1.0 - smoothstep(18.0, 55.0, dist)));
      }
    `,
    colour: /* glsl */ `
      vec2 p = vCtWorld.xz;
      float y = vCtWorld.y;
      float campus = ctCampusMask(p);
      #ifdef CT_LITE
        float broad = ctFbm2(p * 0.0045);
        float mid = ctFbm2(p * 0.035 + 11.0);
      #else
        float broad = ctFbm(p * 0.0045);
        float mid = ctFbm(p * 0.035 + 11.0);
      #endif
      float fine = ctNoise(p * 1.7);
      float fineFade = 1.0 - smoothstep(60.0, 220.0, vCtDist);

      // Meadow: fresh green, lusher hollows, sun-bleached patches, heath -
      // a patchwork at the scale of fields, mottled at the scale of tussocks.
      vec3 meadow = mix(uGrass, uGrassLush, smoothstep(0.3, 0.7, broad));
      meadow = mix(meadow, uGrassDry * 0.92, smoothstep(0.58, 0.86, mid) * 0.35);
      #ifndef CT_LITE
        meadow = mix(meadow, uGrassDry, smoothstep(0.5, 0.8, ctFbm2(p * 0.011 + vec2(-6.0, 2.5))) * 0.7);
        float heath = smoothstep(0.52, 0.74, ctFbm(p * 0.0021 + vec2(3.7, -8.1)));
        meadow = mix(meadow, uHeath, heath * 0.45);
        meadow *= 0.9 + 0.2 * ctFbm2(p * 0.09 + 21.0);
        // Flowering meadows: broad drifts, seen as a tint far away and as
        // single blooms close up.
        float drift = smoothstep(0.52, 0.78, ctFbm2(p * 0.009 + vec2(4.0, -2.0)));
        vec3 driftTint = mix(uFlowerA, uFlowerC, step(0.5, ctNoise(p * 0.004 + 9.0)));
        meadow = mix(meadow, driftTint, drift * 0.16 * smoothstep(40.0, 180.0, vCtDist));
        // Single blooms only where they can be seen.
        if (vCtDist < 55.0) {
          vec4 bloom = ctBloom(p, vCtDist);
          meadow = mix(meadow, bloom.rgb, bloom.a * (0.35 + 0.65 * drift));
        }
      #endif

      // Campus lawn, mown in alternating stripes: the stripes catch the light
      // differently, strongly near and fading with distance; broad patches
      // where it is greener or drier, and blade-scale grain close up.
      float stripeAA = fwidth(p.x / 7.0) * 1.5;
      float stripe = smoothstep(0.5 - stripeAA, 0.5 + stripeAA, fract(p.x / 7.0));
      float stripeNear = 1.0 - smoothstep(60.0, 300.0, vCtDist);
      vec3 lawn = uCampus * (0.9 + 0.14 * mid) * (0.94 + 0.12 * stripe * stripeNear);
      lawn = mix(lawn, uGrassDry * 0.95, smoothstep(0.6, 0.9, broad) * 0.22);
      lawn = mix(lawn, uGrassLush, smoothstep(0.62, 0.9, ctFbm2(p * 0.02 + 5.0)) * 0.3);
      #ifndef CT_LITE
        lawn *= 0.93 + 0.14 * (ctNoise(p * 3.1) * 0.6 + ctNoise(p * 7.7) * 0.4) * (1.0 - smoothstep(25.0, 90.0, vCtDist));
      #endif
      vec3 ground = mix(meadow, lawn, campus);

      // Slopes turn to rock - the headland's cliffs above the sea.
      vec3 worldNormal = normalize(inverseTransformDirection(vNormal, viewMatrix));
      float slope = 1.0 - clamp(worldNormal.y, 0.0, 1.0);
      ground = mix(ground, uRock * (0.92 + 0.12 * mid), smoothstep(0.16, 0.42, slope) * 0.85);
      ground *= 0.965 + 0.07 * fine * fineFade;

      // The shore: a pale beach above the waterline, wet sand at it, and a
      // sandy shelf below that the shallows show through.
      float beach = 1.0 - smoothstep(uSeaLevel + 0.9, uSeaLevel + 2.3, y + 0.5 * (mid - 0.5));
      ground = mix(ground, uBeach * (0.95 + 0.08 * mid), beach * (1.0 - smoothstep(0.3, 0.5, slope)));
      float wet = 1.0 - smoothstep(uSeaLevel - 0.15, uSeaLevel + 0.35, y);
      ground = mix(ground, uBeach * vec3(0.80, 0.80, 0.78), wet * 0.7);
      #ifndef CT_LITE
        // Cloud shadows drifting over the island on the breeze - a function of
        // the scene clock alone, so a captured frame is still exact.
        float cloudShade = smoothstep(0.5, 0.74, ctFbm2(p * 0.0055 + vec2(uTime * 0.03, uTime * 0.011)));
        ground *= 1.0 - 0.15 * cloudShade;
      #endif
      diffuseColor.rgb *= ground;
    `,
    normal: /* glsl */ `
      #ifndef CT_LITE
      {
        vec2 p = vCtWorld.xz;
        float fade = 1.0 - smoothstep(30.0, 140.0, vCtDist);
        // Tussocky turf; fine ripples on the beach.
        float beach = 1.0 - smoothstep(uSeaLevel + 0.9, uSeaLevel + 2.3, vCtWorld.y);
        float turf = ctNoise(p * 2.4) * 0.12 + ctNoise(p * 6.5) * 0.05;
        float ripple = 0.5 + 0.5 * sin(p.x * 1.9 + p.y * 1.1 + ctNoise(p * 0.3) * 4.0);
        float h = mix(turf, ripple * 0.08, beach);
        normal = ctBump(-vViewPosition, normal, h * fade, 1.0);
      }
      #endif
    `,
  });
}

// ---------------------------------------------------------------------------
// Roads
// ---------------------------------------------------------------------------

/**
 * Asphalt with markings drawn from the ribbon's UVs: u runs 0..1 across the
 * carriageway, v is distance along it divided by 12 m. `linesEnd` (metres
 * along) is where the painted lines stop - where the road opens into the
 * turning circle at its end; the centre line stops a little before the edges.
 * `linesStart` is where they begin - at the dock yard's mouth, where the
 * yard's own lead lines meet them - with a give-way line across the road
 * just inside it.
 */
export function roadMaterial(palette: { road: string; line: string; centre: string }, options: {
  centreLine: boolean;
  key: string;
  linesEnd?: number;
  linesStart?: number;
}): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 });
  // The ribbon carries UVs, but a material with no texture maps does not ask
  // three to pass them through; USE_UV makes `vUv` available.
  material.defines = { ...(material.defines ?? {}), USE_UV: '' };
  return patchStandard(material, {
    key: options.key,
    uniforms: {
      uRoad: { value: new Color(palette.road) },
      uLine: { value: new Color(palette.line) },
      uCentre: { value: new Color(palette.centre) },
      uCentreLine: { value: options.centreLine ? 1 : 0 },
      uLinesEnd: { value: (options.linesEnd ?? 1e6) / 12 },
      uLinesStart: { value: (options.linesStart ?? -1e6) / 12 },
    },
    colour: /* glsl */ `
      #ifdef USE_UV
        vec2 ruv = vUv;
      #else
        vec2 ruv = vec2(0.5);
      #endif
      vec2 p = vCtWorld.xz;
      float fade = 1.0 - smoothstep(80.0, 260.0, vCtDist);
      vec3 asphalt = uRoad * (0.92 + 0.12 * ctFbm(p * 0.25));
      // Wheel paths wear lighter.
      float wear = exp(-pow((ruv.x - 0.30) / 0.07, 2.0)) + exp(-pow((ruv.x - 0.70) / 0.07, 2.0));
      asphalt *= 1.0 + 0.07 * wear;
      asphalt *= 0.96 + 0.08 * ctNoise(p * 3.1) * fade;
      float aa = fwidth(ruv.x) * 1.2;
      float edge = smoothstep(0.035 - aa, 0.035, ruv.x) * (1.0 - smoothstep(0.058, 0.058 + aa, ruv.x))
                 + smoothstep(0.942 - aa, 0.942, ruv.x) * (1.0 - smoothstep(0.965, 0.965 + aa, ruv.x));
      float dash = step(fract(ruv.y), 0.34);
      float centre = (1.0 - smoothstep(0.011, 0.011 + aa, abs(ruv.x - 0.5))) * dash * uCentreLine;
      edge *= step(ruv.y, uLinesEnd) * step(uLinesStart, ruv.y);
      centre *= step(ruv.y, uLinesEnd - 0.75) * step(uLinesStart + 0.25, ruv.y);
      // Give way: a row of short dashes across the road, a metre in from
      // where it begins, between the edge lines.
      float metres = (ruv.y - uLinesStart) * 12.0;
      float across = ruv.x * 7.8;
      float aaV = fwidth(metres) * 1.2;
      float giveWay = (smoothstep(0.9 - aaV, 0.9 + aaV, metres) - smoothstep(1.2 - aaV, 1.2 + aaV, metres))
                    * step(0.058, ruv.x) * step(ruv.x, 0.942)
                    * step(fract(across / 0.9), 0.6);
      vec3 colour = mix(asphalt, uLine, clamp(edge + giveWay, 0.0, 1.0) * 0.92);
      colour = mix(colour, uCentre, clamp(centre, 0.0, 1.0) * 0.9);
      diffuseColor.rgb *= colour;
    `,
  });
}

/**
 * The turning circle where the road ends: the same asphalt, and the road's
 * edge line carried round it - drawn per pixel from world position, so the
 * line is exactly as wide as the road's and stops exactly where it meets the
 * road's own two lines, open across the way in.
 */
export function turningCircleMaterial(
  palette: { road: string; line: string },
  circle: {
    x: number;
    z: number;
    ring: number;
    back: { x: number; z: number };
    lineOffset: number;
    lineHalf: number;
  },
): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 });
  return patchStandard(material, {
    key: 'continua-turning-circle-v1',
    uniforms: {
      uRoad: { value: new Color(palette.road) },
      uLine: { value: new Color(palette.line) },
      uCircle: { value: [circle.x, circle.z, circle.ring, circle.lineHalf] },
      uBack: { value: [circle.back.x, circle.back.z] },
      uLineOffset: { value: circle.lineOffset },
    },
    colour: /* glsl */ `
      vec2 p = vCtWorld.xz;
      float fade = 1.0 - smoothstep(80.0, 260.0, vCtDist);
      vec3 asphalt = uRoad * (0.92 + 0.12 * ctFbm(p * 0.25));
      asphalt *= 0.96 + 0.08 * ctNoise(p * 3.1) * fade;
      vec2 d = p - uCircle.xy;
      float r = length(d);
      float aa = fwidth(r) * 1.2;
      float ring = 1.0 - smoothstep(uCircle.w - aa, uCircle.w + aa, abs(r - uCircle.z));
      // Open across the way in, between the road's two lines.
      float along = dot(d, uBack);
      float across = abs(dot(d, vec2(-uBack.y, uBack.x)));
      float inside = step(0.0, along) * (1.0 - smoothstep(uLineOffset - uCircle.w - aa, uLineOffset - uCircle.w + aa, across));
      diffuseColor.rgb *= mix(asphalt, uLine, ring * (1.0 - inside) * 0.92);
    `,
  });
}

/**
 * The dock yard (world/dock.ts): the pads' concrete, joint for joint, so the
 * yard runs into the forecourt and the gateway yard without a seam - and the
 * yard's own paint. White lead lines carry the road's edge lines in from the
 * yard's mouth to the bay's front corners; a yellow keep-clear box with
 * diagonal hatching lies round the equipment beside the bay; and the tyre
 * paths the rover leaves by every run are a shade darker.
 */
export function dockYardMaterial(
  palette: { concrete: string; line: string; hatch: string },
  yard: {
    centreZ: number;
    lead: { fromX: number; fromOffset: number; toX: number; toOffset: number; half: number };
    keepClear: { minX: number; maxX: number; minZ: number; maxZ: number };
    parking: { minX: number; maxX: number; minZ: number; maxZ: number; bay: number };
  },
): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 });
  const { lead, keepClear, parking } = yard;
  return patchStandard(material, {
    key: 'continua-dock-yard-v3',
    uniforms: {
      uConcrete: { value: new Color(palette.concrete) },
      uLine: { value: new Color(palette.line) },
      uHatch: { value: new Color(palette.hatch) },
      uLead: { value: [lead.fromX, lead.toX, lead.fromOffset, lead.toOffset] },
      uLeadHalf: { value: lead.half },
      uCentreZ: { value: yard.centreZ },
      uKeep: { value: [keepClear.minX, keepClear.maxX, keepClear.minZ, keepClear.maxZ] },
      uPark: { value: [parking.minX, parking.maxX, parking.minZ, parking.maxZ] },
      uParkBay: { value: parking.bay },
    },
    header: GLSL_CONCRETE,
    colour: /* glsl */ `
      vec2 p = vCtWorld.xz;
      vec3 c = ctConcrete(uConcrete, p, vCtDist);

      float side = abs(p.y - uCentreZ);
      float span = smoothstep(uLead.x - 0.4, uLead.x + 0.6, p.x) * (1.0 - smoothstep(uLead.y - 0.6, uLead.y + 0.2, p.x));
      // Tyre paths, the wheels 0.95 m either side of the rover's centre line,
      // and the odd drip where it stands before the road.
      float tyre = exp(-pow((side - 0.95) / 0.24, 2.0)) * span;
      c *= 1.0 - 0.075 * tyre * (0.75 + 0.25 * ctNoise(p * vec2(0.6, 4.0)));
      float drip = smoothstep(0.66, 0.8, ctFbm(p * 1.3 + 7.0)) * exp(-pow(side / 1.6, 2.0)) * span;
      c *= 1.0 - 0.1 * drip;

      // Lead lines: straight from the bay's front corners to the road's edge lines.
      float t = clamp((p.x - uLead.x) / (uLead.y - uLead.x), 0.0, 1.0);
      float d = abs(side - mix(uLead.z, uLead.w, t));
      float aa = fwidth(d) * 1.2;
      float lead = (1.0 - smoothstep(uLeadHalf - aa, uLeadHalf + aa, d)) * step(uLead.x, p.x) * step(p.x, uLead.y);
      c = mix(c, uLine, lead * 0.92);

      // Keep clear: a border and diagonal hatching round the equipment.
      vec4 k = uKeep;
      float edge = min(min(p.x - k.x, k.y - p.x), min(p.y - k.z, k.w - p.y));
      float aaE = fwidth(edge) * 1.2;
      float inside = smoothstep(-aaE, aaE, edge);
      float border = inside * (1.0 - smoothstep(0.1 - aaE, 0.1 + aaE, edge));
      float stripe = fract((p.x + p.y) / 0.85);
      float aaS = fwidth(stripe) * 1.5;
      float hatch = inside * smoothstep(0.62 - aaS, 0.62 + aaS, stripe) * (1.0 - smoothstep(0.98 - aaS, 0.98, stripe));
      c = mix(c, uHatch, clamp(border + hatch, 0.0, 1.0) * 0.88);

      // Parking bays: a line between each pair, and the back line.
      vec4 pk = uPark;
      float inPark = step(pk.x - 0.06, p.x) * step(p.x, pk.y + 0.06) * step(pk.z - 0.06, p.y) * step(p.y, pk.w);
      float bayD = abs(fract((p.x - pk.x) / uParkBay + 0.5) - 0.5) * uParkBay;
      float aaB = fwidth(p.x) * 1.2;
      float bayLine = 1.0 - smoothstep(0.05 - aaB, 0.05 + aaB, bayD);
      float backLine = 1.0 - smoothstep(0.05 - aaB, 0.05 + aaB, abs(p.y - pk.z));
      c = mix(c, uLine, clamp(max(bayLine, backLine) * inPark, 0.0, 1.0) * 0.9);
      diffuseColor.rgb *= c;
    `,
  });
}

/**
 * Precast kerb units, 915 mm long: `uv.x` is metres along the run. Each unit
 * a slightly different tone, a fine joint between them.
 */
export function kerbMaterial(colour: string): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.82, metalness: 0 });
  material.defines = { ...(material.defines ?? {}), USE_UV: '' };
  return patchStandard(material, {
    key: 'continua-kerb-v1',
    uniforms: { uKerb: { value: new Color(colour) } },
    colour: /* glsl */ `
      #ifdef USE_UV
        float along = vUv.x;
      #else
        float along = 0.0;
      #endif
      float unit = floor(along / 0.915);
      vec3 c = uKerb * (0.93 + 0.08 * ctHash(vec2(unit, 3.7))) * (0.96 + 0.06 * ctNoise(vCtWorld.xz * 3.0));
      float g = abs(fract(along / 0.915) - 0.5);
      float aa = fwidth(along / 0.915) * 1.2;
      float joint = 1.0 - smoothstep(0.0, 0.006 + aa, 0.5 - g);
      c *= 1.0 - 0.35 * joint * (1.0 - smoothstep(30.0, 90.0, vCtDist));
      diffuseColor.rgb *= c;
    `,
  });
}

/**
 * Concrete laid in 4 m bays: each bay poured on its own day, a shade lighter
 * or darker than its neighbours, with a saw-cut joint between them. Shared by
 * the pads and the dock yard, which overlap: the same function of position on
 * both, so the overlap has no seam.
 */
const GLSL_CONCRETE = /* glsl */ `
  vec3 ctConcrete(vec3 base, vec2 p, float dist) {
    vec3 c = base * (0.95 + 0.07 * ctFbm(p * 0.18));
    vec2 bay = floor(p / 4.0);
    c *= 0.965 + 0.06 * ctHash(bay + 0.37);
    vec2 cell = abs(fract(p / 4.0) - 0.5);
    float w = fwidth(p.x / 4.0) * 1.5;
    float joint = 1.0 - smoothstep(0.0, w + 0.004, 0.5 - max(cell.x, cell.y));
    float fade = 1.0 - smoothstep(60.0, 200.0, dist);
    return c * (1.0 - joint * 0.18 * fade);
  }
`;

/** Concrete hardstanding (GLSL_CONCRETE). */
export function concreteMaterial(colour: string, key = 'continua-concrete-v2'): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 });
  return patchStandard(material, {
    key,
    uniforms: { uConcrete: { value: new Color(colour) } },
    header: GLSL_CONCRETE,
    colour: /* glsl */ `
      diffuseColor.rgb *= ctConcrete(uConcrete, vCtWorld.xz, vCtDist);
    `,
  });
}
