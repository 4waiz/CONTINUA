// Frame-exact capture of CONTINUA's in-app story, for the "Watch the story" film.
//
// The page runs on Playwright's fake clock: Date, performance.now, timers and
// requestAnimationFrame only move when this script advances them, exactly
// 1/30 s per frame. CSS animations are paused and seeked to the same clock.
// Every frame is the real app replaying the recorded runs; nothing is drawn
// here. Per-frame telemetry (captions, link states, scene time) is written so
// the edit can quote what the run showed, frame for frame.
//
//   node capture-story.mjs --dry            telemetry only, plus a few stills
//   node capture-story.mjs                  every frame to frames/story/
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const DRY = process.argv.includes('--dry');
const SITE = process.env.SITE ?? 'http://localhost:4321/';
const TAIL_FRAMES = 8 * FPS; // keep rolling this long once the proof card is up
const MAX_FRAMES = 150 * FPS;
const LANDING_FRAMES = 10 * FPS;
const OUT = path.join(HERE, 'frames', 'story');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11', '--force_high_performance_gpu', '--hide-scrollbars'],
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await context.clock.install();
// The scene times its frames by document.timeline (the compositor's vsync
// clock), which the fake clock does not cover. Read it from the fake clock too.
await context.addInitScript(() => {
  Object.defineProperty(DocumentTimeline.prototype, 'currentTime', {
    configurable: true,
    get() {
      return performance.now();
    },
  });
  // Animation frames: queued here and run exactly once per captured frame.
  // While the page loads (auto mode) a timer flushes them every 16 ms of the
  // fake clock, which runs free until capture pauses it.
  const queue = new Map();
  let nextId = 1;
  let auto = true;
  let pending = false;
  const flush = () => {
    pending = false;
    const callbacks = [...queue.values()];
    queue.clear();
    const stamp = performance.now();
    for (const callback of callbacks) {
      try {
        callback(stamp);
      } catch (error) {
        console.error(error);
      }
    }
  };
  window.requestAnimationFrame = (callback) => {
    const id = nextId++;
    queue.set(id, callback);
    if (auto && !pending) {
      pending = true;
      setTimeout(flush, 16);
    }
    return id;
  };
  window.cancelAnimationFrame = (id) => queue.delete(id);
  window.__bragFrames = {
    manual() {
      auto = false;
    },
    flush,
  };
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));

await page.goto(SITE, { waitUntil: 'load' });
const renderer = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const ext = c?.getExtension('WEBGL_debug_renderer_info');
  return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('renderer:', renderer);
if (!/NVIDIA/.test(renderer)) throw new Error('not on the discrete GPU');

await page.waitForFunction(() => Boolean(window.__CONTINUA__?.three) && !document.body.innerText.includes('Loading mission scene'), null, {
  timeout: 180000,
});
await page.waitForTimeout(2500);
const quality = await page.evaluate(() => window.__CONTINUA__?.settings?.get?.().quality);
console.log('quality:', quality);
if (quality !== 'high') throw new Error(`quality tier is ${quality}`);

const start = await page.evaluate(() => Date.now());
await page.clock.pauseAt(start + 50);
await page.evaluate(() => window.__bragFrames.manual());

async function settleAnimations() {
  await page.evaluate(() => {
    const w = window;
    w.__bragAnim ??= new WeakMap();
    const now = performance.now();
    for (const a of document.getAnimations()) {
      let s = w.__bragAnim.get(a);
      if (s === undefined) {
        s = now;
        w.__bragAnim.set(a, s);
        a.pause();
      }
      a.currentTime = now - s;
    }
  });
}

async function step() {
  await page.clock.runFor(1000 / FPS);
  await page.evaluate(() => window.__bragFrames.flush());
  await settleAnimations();
}

// --- extra shots from the landing's preview, by seeking its own clock -------
const SHOTS = [{ name: 'orbit', at: 31.6, frames: 300 }];
await page.addStyleTag({
  content: `.topbar{display:none!important} .app-shell{grid-template-rows:minmax(0,1fr)!important} .story-landing{visibility:hidden!important} .mission-root .chip, .mission-root [class*="chip"]{visibility:hidden!important}`,
});
await page.waitForTimeout(500);
for (const shot of SHOTS) {
  const dir = path.join(HERE, 'frames', shot.name);
  mkdirSync(dir, { recursive: true });
  await page.evaluate((t) => window.__CONTINUA__.clock.setTime(t), shot.at);
  for (let i = 0; i < 3; i += 1) await step();
  for (let f = 0; f < shot.frames; f += 1) {
    await step();
    await page.screenshot({ path: path.join(dir, `${String(f).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 95 });
  }
  console.log(shot.name, shot.frames, 'frames from preview t =', shot.at);
}
console.log('errors:', errors.length);
await browser.close();
