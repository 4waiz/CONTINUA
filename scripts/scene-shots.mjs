#!/usr/bin/env node
/**
 * Deterministic scene captures for art direction.
 *
 * Drives `/scene-lab` through the public `window.__CONTINUA__` API - pause the
 * clock, choose a camera, set a time - and screenshots the canvas at full
 * resolution. The same (time, camera) always produces the same frame, so a
 * before/after pair is a fair comparison.
 *
 *   node scripts/scene-shots.mjs                         # the standard set
 *   node scripts/scene-shots.mjs --out video/work/scene  # where to write
 *   node scripts/scene-shots.mjs --only inspect,follow-dock
 *   node scripts/scene-shots.mjs --set evidence           # the README evidence views
 *   node scripts/scene-shots.mjs --set world --height 1020  # the README world views
 *
 * Uses the GPU when one is available (`--use-gl=angle`), which is what a
 * visitor sees; the Playwright test projects use SwiftShader instead.
 */

import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WEB = process.env.CONTINUA_WEB ?? 'http://localhost:3000';
const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const OUT = resolve(ROOT, arg('--out', join('video', 'work', 'scene')));
const only = arg('--only', null)?.split(',');
const width = Number(arg('--width', 1920));
const height = Number(arg('--height', 1080));

/** [name, sim time (s), settings patch]. */
const SHOTS = [
  ['inspect', 3, { mode: 'inspect', camera: 'follow', showCoverage: false }],
  ['follow-dock', 4, { mode: 'mission', camera: 'follow' }],
  ['closeup-yard', 18, { mode: 'mission', camera: 'closeup' }],
  ['overview-facility', 9, { mode: 'mission', camera: 'overview' }],
  ['overview-courtyard', 26, { mode: 'mission', camera: 'overview' }],
  ['follow-corridor', 44, { mode: 'mission', camera: 'follow' }],
  ['overview-corridor', 55, { mode: 'mission', camera: 'overview' }],
  ['closeup-corridor', 60, { mode: 'mission', camera: 'closeup' }],
  ['overview-remote', 88, { mode: 'mission', camera: 'overview' }],
  ['follow-remote', 92, { mode: 'mission', camera: 'follow' }],
];

/**
 * The inspection set from tests/evidence.spec.ts - same names, times and
 * settings - rendered on the GPU at the high tier. The test project draws it
 * with SwiftShader, which now starts on the low tier, so these are the frames
 * the README shows.
 */
const EVIDENCE = [
  ['view-01-facility-dock', 4, { camera: 'follow', mode: 'mission' }],
  ['view-02-vehicle-closeup', 22, { camera: 'closeup' }],
  ['view-03-courtyard-wifi', 26, { camera: 'overview' }],
  ['view-04-corridor-cellular', 55, { camera: 'overview' }],
  ['view-05-remote-satellite', 88, { camera: 'overview' }],
  ['view-06-remote-follow', 92, { camera: 'follow' }],
  ['view-07-coverage-overlay', 46, { camera: 'overview', showCoverage: true }],
  ['view-08-inspect-turntable', 3, { mode: 'inspect', showCoverage: false }],
];

/** Frames either side of the preview's handoffs (wired->Wi-Fi ~9.7 s, Wi-Fi->cellular ~41.6 s). */
const HANDOFF = [
  ['handoff-wifi-reach', 10.05, { mode: 'mission', camera: 'follow' }],
  ['handoff-wifi-burst', 10.7, { mode: 'mission', camera: 'follow' }],
  ['handoff-cell-reach', 41.95, { mode: 'mission', camera: 'follow' }],
  ['handoff-cell-overview', 42.35, { mode: 'mission', camera: 'overview' }],
  ['handoff-cell-closeup', 42.45, { mode: 'mission', camera: 'closeup' }],
];

/**
 * The README's views of the island, from fixed points rather than a rig:
 * `view` pins the camera's eye, aim and field of view over whatever rig is
 * active, so the frame still goes through the whole pipeline - ambient
 * occlusion, tone mapping - as a visitor's does.
 */
const WORLD = [
  ['world-island', 62, { camera: 'overview', showMarkers: false, view: { eye: [-235, 150, 95], target: [330, -10, -40], fov: 52 } }],
  ['world-waterfront', 62, { camera: 'overview', showMarkers: false, view: { eye: [100, 8, -126], target: [38, 1, -186], fov: 50 } }],
  ['world-headland', 62, { camera: 'overview', showMarkers: false, view: { eye: [868, 58, 42], target: [988, 2, -96], fov: 50 } }],
  ['world-road-end', 99, { camera: 'overview', showMarkers: false, view: { eye: [803, 15, 22], target: [831, 5, 68], fov: 52 } }],
  ['world-campus', 62, { camera: 'overview', showMarkers: false, view: { eye: [-10, 6, 10], target: [-46, 8, 40], fov: 55 } }],
  // Where every run starts: the dock yard, the gantry and the garage behind it.
  ['world-dock', 0, { camera: 'overview', showMarkers: false, view: { eye: [4, 12, -22], target: [-33, 0.5, 1], fov: 40 } }],
  ['world-gantry', 0, { camera: 'overview', showMarkers: false, view: { eye: [-12, 3.4, 6.0], target: [-34, 4.2, -1.2], fov: 46 } }],
];

const SETS = { standard: SHOTS, evidence: EVIDENCE, handoff: HANDOFF, world: WORLD };
const SET = SETS[arg('--set', 'standard')] ?? SHOTS;

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--hide-scrollbars'],
  });
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error' && !/hmr|websocket|DevTools/i.test(message.text())) errors.push(message.text());
  });

  await page.goto(`${WEB}/scene-lab`, { waitUntil: 'domcontentloaded', timeout: 90_000 });
  await page.waitForFunction(() => Boolean(window.__CONTINUA__?.three), undefined, { timeout: 120_000 });
  await page.waitForTimeout(2500);
  // The world views are of the world: the Scene Lab's panels sit over the
  // canvas, and an element screenshot would carry them.
  if (SET === WORLD) {
    await page.addStyleTag({ content: 'body * { visibility: hidden !important; } canvas { visibility: visible !important; }' });
  }

  for (const [name, time, { view, ...settings }] of SET) {
    if (only && !only.includes(name)) continue;
    await page.evaluate(
      ({ t, patch, view }) => {
        const api = window.__CONTINUA__;
        api.clock.pause();
        api.settings.set({ quality: 'high', ...patch });
        api.clock.setTime(t);
        const camera = api.three.camera;
        // Undo the previous shot's pin, if any.
        if (camera.userData.pinnedFov !== undefined) {
          delete camera.position.copy;
          delete camera.lookAt;
          Object.defineProperty(camera, 'fov', {
            configurable: true, enumerable: true, writable: true, value: camera.userData.pinnedFov,
          });
          delete camera.userData.pinnedFov;
        }
        if (!view) return;
        camera.userData.pinnedFov = camera.fov;
        // The rig writes the camera every frame through position.copy, lookAt
        // and fov; pinned on the instance, those writes land on this view.
        const lookAt = Object.getPrototypeOf(camera).lookAt;
        const [ex, ey, ez] = view.eye;
        const [tx, ty, tz] = view.target;
        camera.position.copy = function pinned() {
          return this.set(ex, ey, ez);
        };
        camera.lookAt = function pinned() {
          return lookAt.call(this, tx, ty, tz);
        };
        Object.defineProperty(camera, 'fov', { configurable: true, get: () => view.fov, set: () => {} });
      },
      { t: time, patch: settings, view: view ?? null },
    );
    await page.waitForTimeout(1600);
    const path = join(OUT, `${name}.png`);
    await page.locator('canvas').first().screenshot({ path });
    console.log(`  ${name.padEnd(20)} t=${String(time).padStart(3)}  -> ${path}`);
  }

  const budget = await page.evaluate(() => {
    const info = window.__CONTINUA__.three.gl.info;
    return { calls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries };
  });
  console.log(`  last frame: ${budget.calls} draw calls, ${budget.triangles.toLocaleString()} triangles, ${budget.geometries} geometries`);
  if (errors.length) console.log(`  console errors:\n    ${errors.slice(0, 6).join('\n    ')}`);
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
