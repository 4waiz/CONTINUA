/**
 * Deterministic value noise.
 *
 * No `Math.random`, no time input, no external dependency: the same coordinates
 * always produce the same height. Terrain, scatter placement and the preview
 * telemetry all depend on this, and Phase 3 video capture depends on all three
 * being reproducible frame for frame.
 */

/** Integer hash -> [0, 1). Deterministic across engines (all ops stay in int32). */
export function hash2(ix: number, iy: number, seed = 0): number {
  let h = (ix | 0) * 374761393 + (iy | 0) * 668265263 + (seed | 0) * 1274126177;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smoothstepUnit(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Bilinear value noise on the unit lattice, smoothed. Range [0, 1]. */
export function valueNoise2(x: number, y: number, seed = 0): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = smoothstepUnit(x - ix);
  const fy = smoothstepUnit(y - iy);

  const a = hash2(ix, iy, seed);
  const b = hash2(ix + 1, iy, seed);
  const c = hash2(ix, iy + 1, seed);
  const d = hash2(ix + 1, iy + 1, seed);

  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** Fractal Brownian motion. Range roughly [-1, 1]. */
export function fbm2(x: number, y: number, octaves = 4, seed = 0): number {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let norm = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += amplitude * (valueNoise2(x * frequency, y * frequency, seed + octave * 17) * 2 - 1);
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.03;
  }
  return norm === 0 ? 0 : sum / norm;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  return smoothstepUnit(clamp((x - edge0) / (edge1 - edge0), 0, 1));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Shortest signed difference between two angles, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return delta;
}

/** A tiny seeded PRNG for one-time deterministic scatter layouts. */
export function makeRandom(seed: number): () => number {
  let state = (seed | 0) || 1;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return ((state >>> 0) % 16777216) / 16777216;
  };
}
