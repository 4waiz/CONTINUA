#!/usr/bin/env node
/**
 * How smooth is it, on this machine's GPU?
 *
 * Opens a page in Chromium on the real GPU (ANGLE), optionally starts a run,
 * and reports what a viewer feels: frame-interval percentiles, long main-thread
 * tasks (a dropped frame's usual cause), and the renderer's per-frame budget.
 *
 *   node scripts/perf-probe.mjs                       # Mission, with a run
 *   node scripts/perf-probe.mjs --page scene-lab
 *   node scripts/perf-probe.mjs --dsf 1.5             # a 150 % Windows display
 *   node scripts/perf-probe.mjs --quality balanced
 *   node scripts/perf-probe.mjs --chrome              # installed Chrome, its own GPU choice
 *
 * Needs the app on CONTINUA_WEB (default http://localhost:3000) and, for a
 * run, the engine it is built against.
 */

import { chromium } from '@playwright/test';

const WEB = process.env.CONTINUA_WEB ?? 'http://localhost:3000';
const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const pageId = arg('--page', 'mission');
const dsf = Number(arg('--dsf', 1));
const seconds = Number(arg('--seconds', 8));
const quality = arg('--quality', null);
const width = Number(arg('--width', 1920));
const height = Number(arg('--height', 1080));
const noBackdrop = argv.includes('--no-backdrop');

// `--chrome` uses the installed Google Chrome, which - unlike Playwright's
// Chromium - picks the GPU the way a visitor's browser does. On a laptop with
// integrated and discrete graphics that is often the integrated one.
const useChrome = argv.includes('--chrome');
const browser = await chromium.launch({
  ...(useChrome ? { channel: 'chrome' } : {}),
  args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--disable-frame-rate-limit'],
});
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dsf });
await page.addInitScript(() => {
  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.__longTasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
  } catch {
    /* not supported */
  }
});

const path = pageId === 'mission' ? '/' : `/${pageId}`;
await page.goto(`${WEB}${path}`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => Boolean(window.__CONTINUA__?.three), undefined, { timeout: 120_000 });
await page.waitForTimeout(2500);
if (noBackdrop) {
  await page.addStyleTag({ content: '* { backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' });
}
if (quality) await page.evaluate((q) => window.__CONTINUA__.settings.set({ quality: q }), quality);

if (pageId === 'mission' && !argv.includes('--no-run')) {
  // Mission opens on its introduction; the run's controls are one click in.
  await page.getByRole('button', { name: 'Drive it yourself' }).click();
  await page.getByRole('button', { name: /Start run/ }).click();
  await page.waitForFunction(() => Boolean(window.__CONTINUA__?.getFrame().active), undefined, { timeout: 60_000 });
  await page.waitForTimeout(9000); // past the dock dwell, into the drive
} else {
  await page.evaluate(() => window.__CONTINUA__.clock.play());
  await page.waitForTimeout(1500);
}

const result = await page.evaluate(async (ms) => {
  window.__longTasks = [];
  const deltas = [];
  const info = window.__CONTINUA__.three.gl.info;
  const f0 = info.render.frame;
  await new Promise((resolve) => {
    let last = performance.now();
    const start = last;
    const tick = (now) => {
      deltas.push(now - last);
      last = now;
      if (now - start < ms) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  const frames = info.render.frame - f0;
  const sorted = [...deltas].sort((a, b) => a - b);
  const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const gl = window.__CONTINUA__.three.gl;
  const ctx = gl.getContext();
  const ext = ctx.getExtension('WEBGL_debug_renderer_info');
  const canvas = gl.domElement;
  return {
    renderer: ext ? ctx.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown',
    quality: JSON.parse(JSON.stringify(window.__CONTINUA__.settings)).settings?.quality,
    buffer: `${canvas.width}x${canvas.height}`,
    fps: (deltas.length / (ms / 1000)).toFixed(1),
    renders: (frames / (ms / 1000)).toFixed(1),
    p50: pct(0.5).toFixed(1),
    p95: pct(0.95).toFixed(1),
    p99: pct(0.99).toFixed(1),
    worst: sorted[sorted.length - 1].toFixed(1),
    over25: deltas.filter((d) => d > 25).length,
    longTasks: window.__longTasks.length,
    longTaskMs: Math.round(window.__longTasks.reduce((a, b) => a + b, 0)),
    calls: info.render.calls,
    triangles: info.render.triangles,
    programs: info.programs?.length ?? -1,
  };
}, seconds * 1000);

console.log(
  `${pageId} dsf ${dsf}${quality ? ` q=${quality}` : ''}${noBackdrop ? ' no-backdrop' : ''} | ${result.renderer}\n` +
    `  quality ${result.quality}, buffer ${result.buffer}\n` +
    `  ${result.fps} fps (renders ${result.renders}/s) | frame p50 ${result.p50} ms, p95 ${result.p95}, p99 ${result.p99}, worst ${result.worst} | ${result.over25} frames > 25 ms\n` +
    `  long tasks ${result.longTasks} (${result.longTaskMs} ms) | ${result.calls} draw calls, ${result.triangles.toLocaleString()} triangles, ${result.programs} programs`,
);
await browser.close();
