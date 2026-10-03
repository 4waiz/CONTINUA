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

  for (const [name, time, settings] of SHOTS) {
    if (only && !only.includes(name)) continue;
    await page.evaluate(
      ({ t, patch }) => {
        const api = window.__CONTINUA__;
        api.clock.pause();
        api.settings.set(patch);
        api.clock.setTime(t);
      },
      { t: time, patch: settings },
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
