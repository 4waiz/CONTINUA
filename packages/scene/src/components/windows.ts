/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-99F9C8C48F77 */
/**
 * Rooms behind the glass.
 *
 * Glazing drawn as a tinted plane reads as paint: a building is a box with
 * dark panels on it. Real glass shows two things - the sky, mirrored more and
 * more toward a grazing angle, and the lit room behind it, with depth that
 * shifts as the camera moves. This draws both. The reflection is the
 * renderer's own (the material's environment map); the room is found by
 * interior mapping (van Dongen, 2008): the view ray is followed into a box
 * room behind each pane, and whichever of its walls, floor or ceiling the ray
 * meets first is what that pixel shows - a back wall with desks and screens,
 * a ceiling with a light panel, blinds part-drawn, some rooms dark. No
 * geometry, no texture; a pure function of position and view, so a captured
 * frame is still exact.
 *
 * Rooms are laid out in the building's own frame, sized per building so the
 * floors line up with its slab edges (`ROOMS` in WorldProps.tsx). Horizontal
 * glass - a skylight - keeps the plain material.
 */

import { MeshStandardMaterial, Vector4, type Material } from 'three';
import { GLSL_NOISE } from './shaders';

export interface RoomSpec {
  /** Room width along the facade, metres. */
  width: number;
  /** Storey height, metres. */
  storey: number;
  /** Room depth into the building, metres. */
  depth: number;
  /** Height of a floor line above the building's base, metres. */
  floor: number;
  /** Where along the facade a partition falls, metres. */
  shift?: number;
  /** 'garage' rooms hold a fire appliance instead of desks. */
  kind?: 'office' | 'garage';
}

const ROOM_GLSL = /* glsl */ `
  // A fire appliance seen head-on, filling the lower middle of a bay: red
  // body, windscreen, light bar, grille, headlamps, bumper.
  vec3 ctAppliance(vec2 q) {
    vec3 c = vec3(0.55, 0.05, 0.04);
    c = mix(c, vec3(0.86), step(abs(q.y - 0.205), 0.008));
    c = mix(c, vec3(0.05, 0.07, 0.1), step(abs(q.y - 0.29), 0.05) * step(abs(q.x - 0.5), 0.15));
    c = mix(c, vec3(0.12), step(abs(q.y - 0.15), 0.05) * step(abs(q.x - 0.5), 0.06));
    float lamp = step(abs(q.y - 0.13), 0.02) * step(abs(abs(q.x - 0.5) - 0.13), 0.025);
    c = mix(c, vec3(1.6, 1.55, 1.4), lamp);
    c = mix(c, vec3(0.62, 0.64, 0.66), step(abs(q.y - 0.045), 0.02));
    vec3 bar = mix(vec3(0.15, 0.35, 1.6), vec3(1.6, 0.15, 0.1), step(0.5, q.x));
    c = mix(c, bar, step(abs(q.y - 0.415), 0.012) * step(abs(q.x - 0.5), 0.12));
    return c;
  }

  // The room a view ray meets behind the glass. at: facade coordinates in
  // rooms (along, up); d: the ray in rooms, z into the building.
  vec3 ctRoom(vec2 at, vec3 d) {
    vec2 cell = floor(at);
    vec3 o = vec3(fract(at), 0.0);
    // Never a zero component: a ray along a wall would divide by it.
    d.x = abs(d.x) < 1e-5 ? 1e-5 : d.x;
    d.y = abs(d.y) < 1e-5 ? 1e-5 : d.y;
    vec3 t = (step(0.0, d) - o) / d;
    float hitAt = min(min(t.x, t.y), t.z);
    vec3 hit = o + d * hitAt;
    float depth = hit.z;

    float rnd = ctHash(cell + 0.37);
    float rnd2 = ctHash(cell + 7.11);
    float garage = uRoomExtra.y;
    // Most rooms have their lights on; a garage always does.
    float lit = max(step(0.26, rnd), garage);
    vec3 wall = mix(vec3(0.80, 0.75, 0.66), vec3(0.66, 0.70, 0.73), step(0.62, rnd2));
    wall = mix(wall, vec3(0.70, 0.72, 0.74), garage);

    vec3 colour;
    if (hitAt == t.y && d.y < 0.0) {
      // Floor: carpet, or a garage's sealed concrete with a bay line.
      colour = mix(vec3(0.2, 0.17, 0.14) * (0.8 + 0.4 * rnd2), vec3(0.42, 0.43, 0.44), garage);
      colour = mix(colour, vec3(0.75, 0.62, 0.15), garage * step(abs(hit.x - 0.5), 0.012));
    } else if (hitAt == t.y) {
      // Ceiling, with a light panel.
      vec2 c = abs(hit.xz - vec2(0.5, 0.42));
      float panel = step(c.x, 0.3) * step(c.y, 0.09);
      colour = vec3(0.66, 0.64, 0.6) + panel * lit * vec3(1.8, 1.7, 1.45);
    } else if (hitAt == t.x) {
      // Side walls, shaded a little against the back wall.
      colour = wall * 0.82;
    } else {
      colour = wall;
      if (garage < 0.5) {
        // Desks along the back wall, a screen or two on them.
        float desk = step(hit.y, 0.26) * step(0.06, hit.y) * step(0.25, rnd2);
        colour = mix(colour, vec3(0.32, 0.28, 0.24), desk);
        float screenX = 0.25 + 0.5 * rnd;
        float screen = step(abs(hit.x - screenX), 0.07) * step(abs(hit.y - 0.33), 0.045) * step(0.25, rnd2);
        colour = mix(colour, vec3(0.22, 0.32, 0.46) * (0.5 + lit), screen);
        // A plant in the corner of some rooms.
        float plant = step(0.8, rnd) * step(length((hit.xy - vec2(0.12, 0.2)) * vec2(1.0, 0.7)), 0.09);
        colour = mix(colour, vec3(0.12, 0.25, 0.1), plant);
      } else {
        // Lockers and hose racks along the back of the bay.
        float locker = step(hit.y, 0.24) * step(0.12, abs(hit.x - 0.5)) * step(abs(hit.x - 0.5), 0.42);
        colour = mix(colour, vec3(0.46, 0.08, 0.06) * (0.9 + 0.1 * step(0.5, fract(hit.x * 14.0))), locker);
      }
    }
    if (garage > 0.5) {
      // The appliance stands a third of the way into the bay, nose out:
      // it is in front of whatever wall the ray would meet behind it.
      float tTruck = 0.35 / d.z;
      vec2 q = o.xy + d.xy * tTruck;
      if (tTruck < hitAt && abs(q.x - 0.5) < 0.18 && q.y < 0.43) {
        colour = ctAppliance(q);
        depth = 0.35;
      }
    }
    // Light falls off into the room; a room with its lights off is dim.
    colour *= mix(1.0, 0.6, clamp(depth, 0.0, 1.0)) * mix(0.32, 1.0, lit);
    // Blinds part-drawn at the top of some windows, just behind the glass.
    float blind = step(0.58, rnd2) * (0.12 + 0.45 * ctHash(cell + 3.3)) * (1.0 - garage);
    if (o.y > 1.0 - blind) {
      colour = vec3(0.56, 0.57, 0.58) * (0.86 + 0.14 * step(0.5, fract(o.y * uRoom.y * 8.0)));
    }
    return colour;
  }
`;

const VARIANTS = new Map<string, MeshStandardMaterial>();

/**
 * A glazing material with rooms behind it: the source material (its
 * reflection, roughness, tint) with the diffuse turned down - glass does not
 * scatter light - and the room added as emitted light, dimmed by the glass's
 * tint and by the Fresnel reflection that replaces it at a grazing angle.
 * One variant per building and glazing, shared by every copy of that building.
 */
export function windowMaterial(source: MeshStandardMaterial, room: RoomSpec, key: string): MeshStandardMaterial {
  const cached = VARIANTS.get(key);
  if (cached) return cached;
  const material = source.clone();
  material.name = `${source.name}_Rooms`;
  // Office glazing is coated against the sun: it mirrors a good deal of the
  // sky, blue-grey, even face-on.
  material.color.set('#7F95B0');
  material.metalness = 0.55;
  material.roughness = 0.06;
  material.userData.continuaWindowSource = source;
  const uRoom = { value: new Vector4(room.width, room.storey, room.depth, room.floor) };
  const uRoomExtra = { value: new Vector4(room.shift ?? 0, room.kind === 'garage' ? 1 : 0, 0, 0) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRoom = uRoom;
    shader.uniforms.uRoomExtra = uRoomExtra;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vCtLocal;
         varying vec3 vCtLocalCam;
         varying vec3 vCtLocalNormal;
         varying vec3 vCtAlongView;
         varying vec3 vCtUpView;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         {
           mat4 ctModel = modelMatrix;
           #ifdef USE_INSTANCING
             ctModel = modelMatrix * instanceMatrix;
           #endif
           vCtLocal = transformed;
           vCtLocalCam = (inverse(ctModel) * vec4(cameraPosition, 1.0)).xyz;
           vCtLocalNormal = objectNormal;
           // The facade's own axes in view space, to tilt a pane about.
           vec3 ctAlongLocal = normalize(cross(vec3(0.0, 1.0, 0.0), objectNormal) + vec3(1e-5, 0.0, 0.0));
           vCtAlongView = normalize((viewMatrix * ctModel * vec4(ctAlongLocal, 0.0)).xyz);
           vCtUpView = normalize((viewMatrix * ctModel * vec4(0.0, 1.0, 0.0, 0.0)).xyz);
         }`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform vec4 uRoom;
         uniform vec4 uRoomExtra;
         varying vec3 vCtLocal;
         varying vec3 vCtLocalCam;
         varying vec3 vCtLocalNormal;
         varying vec3 vCtAlongView;
         varying vec3 vCtUpView;
         ${GLSL_NOISE}
         ${ROOM_GLSL}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         // Glass scatters almost no light of its own: what is seen in it is
         // the sky it mirrors and the room behind it.
         diffuseColor.rgb *= 0.18;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
         {
           // No two panes hang at quite the same angle: each mirrors its own
           // patch of sky, so a facade of glass is never one flat tone.
           vec3 ctNl = normalize(vCtLocalNormal);
           vec3 ctAl = normalize(cross(vec3(0.0, 1.0, 0.0), ctNl) + vec3(1e-5, 0.0, 0.0));
           vec2 ctPaneAt = vec2(dot(vCtLocal, ctAl) - uRoomExtra.x, vCtLocal.y - uRoom.w) / uRoom.xy;
           vec2 ctPane = floor(ctPaneAt);
           vec2 ctTilt = (vec2(ctHash(ctPane + 4.1), ctHash(ctPane + 9.3)) - 0.5) * 0.07;
           normal = normalize(normal + vCtAlongView * ctTilt.x + vCtUpView * ctTilt.y);
         }`,
      )
      .replace(
        '#include <lights_fragment_maps>',
        `#include <lights_fragment_maps>
         #if defined( USE_ENVMAP ) && defined( RE_IndirectSpecular )
           // The scene's environment intensity (0.38) keeps paint and leaves
           // from being flooded by the bright sky, and three applies it to
           // every material the scene's environment lights, whatever that
           // material's own envMapIntensity. Glass is the exception: it is
           // what it mirrors, so it raises its own reflection back up.
           radiance *= 4.2;
         #endif`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         {
           vec3 ctN = normalize(vCtLocalNormal);
           // Facade coordinates: along it, up it, and into the building.
           vec3 ctAlong = normalize(cross(vec3(0.0, 1.0, 0.0), ctN) + vec3(1e-5, 0.0, 0.0));
           vec2 ctAt = vec2(dot(vCtLocal, ctAlong) - uRoomExtra.x, vCtLocal.y - uRoom.w) / uRoom.xy;
           vec3 ctDir = normalize(vCtLocal - vCtLocalCam);
           vec3 ctInto = vec3(dot(ctDir, ctAlong), ctDir.y, max(-dot(ctDir, ctN), 1e-3)) / uRoom.xyz;
           // Rooms a few pixels across would only shimmer: they fade to the
           // average of a lit floor before they get there.
           float ctDetail = 1.0 - smoothstep(0.12, 0.35, max(fwidth(ctAt.x), fwidth(ctAt.y)));
           vec3 ctSeen = mix(vec3(0.34, 0.34, 0.33), ctRoom(ctAt, ctInto), ctDetail);
           // At a grazing angle the glass is a mirror and the room is gone.
           float ctFacing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
           float ctFresnel = 0.2 + 0.8 * pow(1.0 - ctFacing, 5.0);
           float ctVertical = 1.0 - step(0.5, abs(ctN.y));
           // Through tinted glass in daylight a room is darker than the sunlit
           // facade around it.
           totalEmissiveRadiance += ctSeen * vec3(0.4, 0.42, 0.43) * (1.0 - ctFresnel) * ctVertical;
         }`,
      );
  };
  material.customProgramCacheKey = () => 'continua-window-rooms-v3';
  material.needsUpdate = true;
  VARIANTS.set(key, material);
  return material;
}

/** The plain glazing a rooms variant was made from (the low tier draws it). */
export function plainGlazing(material: Material): Material {
  return (material.userData.continuaWindowSource as Material | undefined) ?? material;
}
