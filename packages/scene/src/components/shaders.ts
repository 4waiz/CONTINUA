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

import { Color, MeshStandardMaterial, type WebGLProgramParametersWithUniforms } from 'three';

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
  },
): MeshStandardMaterial {
  material.customProgramCacheKey = () => options.key;
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, options.uniforms ?? {});
    const uniformDecl = Object.entries(options.uniforms ?? {})
      .map(([name, entry]) => {
        const value = entry.value;
        const type =
          value instanceof Color ? 'vec3' : typeof value === 'number' ? 'float' : Array.isArray(value) ? `vec${value.length}` : 'vec4';
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
  sandLight: string;
  sand: string;
  sandDark: string;
  rock: string;
  campusRect: [number, number, number, number];
}): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.96, metalness: 0 });
  return patchStandard(material, {
    key: 'continua-terrain-v1',
    uniforms: {
      uCampus: { value: new Color(palette.campus) },
      uSandLight: { value: new Color(palette.sandLight) },
      uSand: { value: new Color(palette.sand) },
      uSandDark: { value: new Color(palette.sandDark) },
      uRock: { value: new Color(palette.rock) },
      uCampusRect: { value: palette.campusRect },
    },
    header: /* glsl */ `
      float ctCampusMask(vec2 p) {
        vec4 r = uCampusRect; // minX, maxX, minZ, maxZ
        float inside = smoothstep(r.x - 6.0, r.x + 6.0, p.x) * (1.0 - smoothstep(r.y - 6.0, r.y + 6.0, p.x))
                     * smoothstep(r.z - 6.0, r.z + 6.0, p.y) * (1.0 - smoothstep(r.w - 6.0, r.w + 6.0, p.y));
        return inside;
      }
      // Wind ripples across the open desert: long, slightly wavering crests.
      float ctRipple(vec2 p) {
        vec2 q = vec2(p.x * 0.8 + p.y * 0.6, -p.x * 0.6 + p.y * 0.8);
        float warp = ctNoise(q * 0.05) * 6.0;
        return 0.5 + 0.5 * sin(q.x * 0.9 + warp);
      }
    `,
    colour: /* glsl */ `
      vec2 p = vCtWorld.xz;
      float campus = ctCampusMask(p);
      float remote = smoothstep(380.0, 620.0, p.x);
      float broad = ctFbm(p * 0.0045);
      float mid = ctFbm(p * 0.035 + 11.0);
      float fine = ctNoise(p * 1.7);
      float fineFade = 1.0 - smoothstep(60.0, 220.0, vCtDist);

      vec3 desert = mix(uSand, uSandLight, smoothstep(0.32, 0.72, broad));
      desert = mix(desert, uSandDark, smoothstep(0.55, 0.85, mid) * 0.45);
      // Remote sand is paler and carries ripples.
      desert = mix(desert, uSandLight, remote * 0.35);
      desert *= 1.0 - remote * 0.05 * ctRipple(p) * fineFade;

      vec3 graded = uCampus * (0.97 + 0.06 * mid);
      vec3 ground = mix(desert, graded, campus);
      // Slopes read darker and warmer, so the hills have form under flat light.
      vec3 worldNormal = normalize(inverseTransformDirection(vNormal, viewMatrix));
      float slope = 1.0 - clamp(worldNormal.y, 0.0, 1.0);
      ground = mix(ground, uRock, smoothstep(0.08, 0.35, slope) * 0.55);
      ground *= 0.97 + 0.06 * fine * fineFade;
      diffuseColor.rgb *= ground;
    `,
    normal: /* glsl */ `
      {
        vec2 p = vCtWorld.xz;
        float remote = smoothstep(380.0, 620.0, p.x);
        float fade = 1.0 - smoothstep(30.0, 140.0, vCtDist);
        float h = ctRipple(p) * 0.35 * remote + ctNoise(p * 2.2) * 0.12;
        normal = ctBump(-vViewPosition, normal, h * fade, 1.0);
      }
    `,
  });
}

// ---------------------------------------------------------------------------
// Roads
// ---------------------------------------------------------------------------

/**
 * Asphalt with markings drawn from the ribbon's UVs: u runs 0..1 across the
 * carriageway, v is distance along it divided by 12 m.
 */
export function roadMaterial(palette: { road: string; line: string; centre: string }, options: {
  centreLine: boolean;
  key: string;
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
      vec3 colour = mix(asphalt, uLine, clamp(edge, 0.0, 1.0) * 0.92);
      colour = mix(colour, uCentre, clamp(centre, 0.0, 1.0) * 0.9);
      diffuseColor.rgb *= colour;
    `,
  });
}

/** Concrete hardstanding with saw-cut joints every 4 m. */
export function concreteMaterial(colour: string, key = 'continua-concrete-v1'): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: '#ffffff', roughness: 0.9, metalness: 0 });
  return patchStandard(material, {
    key,
    uniforms: { uConcrete: { value: new Color(colour) } },
    colour: /* glsl */ `
      vec2 p = vCtWorld.xz;
      vec3 c = uConcrete * (0.95 + 0.07 * ctFbm(p * 0.18));
      vec2 cell = abs(fract(p / 4.0) - 0.5);
      float w = fwidth(p.x / 4.0) * 1.5;
      float joint = 1.0 - smoothstep(0.0, w + 0.004, 0.5 - max(cell.x, cell.y));
      float fade = 1.0 - smoothstep(60.0, 200.0, vCtDist);
      c *= 1.0 - joint * 0.16 * fade;
      diffuseColor.rgb *= c;
    `,
  });
}
