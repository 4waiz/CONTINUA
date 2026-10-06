// Frame-exact capture of CONTINUA, for the intro and the walkthrough.
//
// The page runs on Playwright's fake clock: Date, performance.now, timers and
// requestAnimationFrame only move when this script advances them, exactly
// 1/30 s per frame, and CSS animations are seeked to the same clock. So the
// footage is perfectly smooth whatever the GPU, and the same script gives the
// same frames. Every frame is the real app - the public build, replaying the
// engine's recorded runs; nothing is drawn here but a cursor.
//
// A "director" plays each shot: it moves the cursor, clicks, holds keys, and
// waits for the app's own events (a change of network, the road map's banner)
// rather than guessing their times. Each event it sees is logged as a mark
// with its film time, so the voice can be placed on it.
//
//   node capture.mjs walkthrough [--dry]   the two-minute screen recording
//   node capture.mjs walkthrough --from 108.5 --out walkthrough-tail
//                                           its last seconds again, after a page changed
//   node capture.mjs aerial                the island from the air, card hidden
//   node capture.mjs proof                 the brief page's twenty-drive comparison
import { chromium } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FPS = 30;
const SITE = (process.env.SITE ?? 'http://localhost:4321').replace(/\/$/, '');
const SHOT = process.argv[2] ?? 'walkthrough';
const DRY = process.argv.includes('--dry');
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
// Re-shoot only the end of a shot: play the whole thing, save frames from
// `--from` seconds on, into frames/<--out>. The clock makes the frames before
// identical, so the tail drops in over the old one; the marks are compared.
const FROM = Number(arg('--from') ?? 0);
const OUT_NAME = arg('--out') ?? SHOT;
const OUT = path.join(HERE, 'frames', OUT_NAME);
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11', '--force_high_performance_gpu', '--hide-scrollbars'],
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await context.clock.install();
await context.addInitScript(() => {
  // The frame-rate governor stays off: these frames come at the harness's pace.
  window.__CONTINUA_CAPTURE__ = true;
  // The scene times its frames by document.timeline, which the fake clock does
  // not cover; read it from the fake clock too.
  Object.defineProperty(DocumentTimeline.prototype, 'currentTime', {
    configurable: true,
    get() {
      return performance.now();
    },
  });
  // Animation frames run exactly once per captured frame; while the page
  // loads (auto mode) a fake-clock timer flushes them.
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
  // The cursor a screen recording shows: drawn into the page, moved by the director.
  window.addEventListener('DOMContentLoaded', () => {
    const cursor = document.createElement('div');
    cursor.id = '__cursor';
    cursor.innerHTML =
      '<svg width="30" height="34" viewBox="0 0 30 34"><path d="M3 2 L3 26 L9.5 20.2 L13.6 30.2 L18.2 28.3 L14.1 18.6 L23 18.4 Z" fill="#111D3A" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/></svg><span></span>';
    Object.assign(cursor.style, {
      position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', opacity: '0',
      transform: 'translate(-100px,-100px)', filter: 'drop-shadow(0 3px 6px rgb(17 29 58 / 0.35))',
    });
    const ring = cursor.querySelector('span');
    Object.assign(ring.style, {
      position: 'absolute', left: '-13px', top: '-13px', width: '30px', height: '30px', borderRadius: '50%',
      border: '3px solid #176BFF', opacity: '0',
    });
    document.documentElement.appendChild(cursor);
  });
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && !/websocket|favicon/i.test(m.text()) && errors.push(m.text()));

// --- the frame loop -------------------------------------------------------------

let frame = 0;
const marks = {};
const telemetry = [];
const filmTime = () => frame / FPS;

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

const cursor = { x: -100, y: -100, opacity: 0, press: 0 };
async function drawCursor() {
  await page.evaluate((c) => {
    const el = document.getElementById('__cursor');
    if (!el) return;
    el.style.transform = `translate(${c.x - 3}px, ${c.y - 2}px) scale(${1 - 0.12 * c.press})`;
    el.style.opacity = String(c.opacity);
    const ring = el.querySelector('span');
    ring.style.opacity = String(c.press * 0.9);
    ring.style.transform = `scale(${0.6 + c.press * 0.7})`;
  }, cursor);
}

async function readout() {
  return page.evaluate(() => ({
    t: window.__CONTINUA__?.clock?.time ?? null,
    url: location.pathname,
    moment: document.querySelector('.moment')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
    status: [...document.querySelectorAll('.rover-status')].map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
    drive: document.querySelector('.drive-card .drive-speed')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
  }));
}

/** One film frame: advance the clock 1/30 s, run the frame, screenshot it. */
async function step() {
  await page.clock.runFor(1000 / FPS);
  await page.evaluate(() => window.__bragFrames.flush());
  await settleAnimations();
  await drawCursor();
  if (FROM > 0 ? frame / FPS >= FROM : !DRY || frame % 30 === 0) {
    await page.screenshot({ path: path.join(OUT, `${String(frame).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 93 });
  }
  if (frame % 15 === 0) {
    const info = await readout();
    telemetry.push({ frame, film: +filmTime().toFixed(2), ...info });
    if (frame % 150 === 0) console.log(filmTime().toFixed(1).padStart(6), 's', JSON.stringify(info).slice(0, 220));
  }
  frame += 1;
}

async function hold(seconds) {
  const n = Math.round(seconds * FPS);
  for (let i = 0; i < n; i += 1) await step();
}

function mark(name) {
  marks[name] = +filmTime().toFixed(3);
  console.log(`  mark ${name} @ ${marks[name]} s`);
}

/** Step until `test()` is true (checked every frame), or fail after `limit` seconds. */
async function until(name, test, limit = 60) {
  for (let i = 0; i < limit * FPS; i += 1) {
    if (await page.evaluate(test)) {
      mark(name);
      return;
    }
    await step();
  }
  throw new Error(`${name}: not seen within ${limit} s`);
}

const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** Glide the cursor - and the real pointer under it - to (x, y) over `seconds`. */
async function moveTo(x, y, seconds = 0.9) {
  const n = Math.max(1, Math.round(seconds * FPS));
  const x0 = cursor.x;
  const y0 = cursor.y;
  // A gentle arc, as a hand moves a mouse.
  const bend = Math.min(80, Math.hypot(x - x0, y - y0) * 0.12);
  for (let i = 1; i <= n; i += 1) {
    const k = ease(i / n);
    cursor.x = x0 + (x - x0) * k;
    cursor.y = y0 + (y - y0) * k - Math.sin(Math.PI * k) * bend;
    await page.mouse.move(cursor.x, cursor.y);
    await step();
  }
}

async function center(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('target not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

async function fadeCursor(to, seconds = 0.35) {
  const n = Math.max(1, Math.round(seconds * FPS));
  const from = cursor.opacity;
  for (let i = 1; i <= n; i += 1) {
    cursor.opacity = from + (to - from) * (i / n);
    await step();
  }
}

/** Move to an element and click it, with the press shown. */
async function clickOn(locator, seconds = 0.9) {
  const { x, y } = await center(locator);
  if (cursor.opacity < 1) {
    if (cursor.x < 0) {
      cursor.x = x + 160;
      cursor.y = y + 120;
    }
    await fadeCursor(1, 0.25);
  }
  await moveTo(x, y, seconds);
  for (const p of [0.5, 1]) {
    cursor.press = p;
    await step();
  }
  await page.mouse.click(x, y);
  for (const p of [0.7, 0.4, 0.15, 0]) {
    cursor.press = p;
    await step();
  }
}

/** Ease a scrolling region from where it is to `to` px over `seconds`. */
async function scrollTo(selector, to, seconds) {
  const from = await page.evaluate((s) => document.querySelector(s)?.scrollTop ?? 0, selector);
  const n = Math.round(seconds * FPS);
  for (let i = 1; i <= n; i += 1) {
    const y = from + (to - from) * ease(i / n);
    await page.evaluate(([s, top]) => {
      const el = document.querySelector(s);
      if (el) el.scrollTop = top;
    }, [selector, y]);
    await step();
  }
}

/** The main region a document page scrolls in. */
const SCROLLER = '.doc-scroll, main .scroll-y, main';

async function waitReal(test, ms = 60000) {
  // Real time, fake clock still: network and decoding happen while nothing moves on screen.
  await page.waitForFunction(test, null, { timeout: ms });
}

// --- load ------------------------------------------------------------------------

async function open(url, hideUi = '') {
  await page.goto(`${SITE}${url}`, { waitUntil: 'load' });
  const renderer = await page.evaluate(() => {
    const c = document.createElement('canvas').getContext('webgl2');
    const ext = c?.getExtension('WEBGL_debug_renderer_info');
    return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
  });
  console.log('renderer:', renderer);
  if (!/NVIDIA|AMD|Radeon/i.test(renderer)) throw new Error(`no hardware GPU: ${renderer}`);
  if (hideUi) await page.addStyleTag({ content: hideUi });
}

async function sceneReady() {
  await waitReal(() => Boolean(window.__CONTINUA__?.three) && !document.body.innerText.includes('Loading mission scene'), 180000);
  await page.waitForTimeout(2500);
  const quality = await page.evaluate(() => window.__CONTINUA__?.settings?.get?.().quality);
  console.log('quality:', quality);
  if (quality !== 'high') {
    await page.evaluate(() => window.__CONTINUA__.settings.set({ quality: 'high' }));
    await page.waitForTimeout(3000);
  }
}

async function freezeClock() {
  // A little ahead of now: the clock still runs free while this is read.
  const start = await page.evaluate(() => Date.now());
  await page.clock.pauseAt(start + 1000);
  await page.evaluate(() => window.__bragFrames.manual());
  for (let i = 0; i < 3; i += 1) await step();
  frame = 0;
  telemetry.length = 0;
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
}

const button = (name) => page.getByRole('button', { name, exact: typeof name === 'string' });
const navLink = (name) => page.getByRole('link', { name, exact: true });

// --- the shots ----------------------------------------------------------------------

async function walkthrough() {
  await open('/');
  await sceneReady();
  await freezeClock();

  // The landing: what this is, and the one way in.
  mark('landing');
  await hold(2.2);
  cursor.x = 1330;
  cursor.y = 830;
  await fadeCursor(1, 0.4);
  await hold(0.6);
  const drive = button('Drive it yourself');
  const { x: dx, y: dy } = await center(drive);
  await moveTo(dx, dy, 1.6);
  await hold(0.5);
  for (const p of [0.5, 1]) {
    cursor.press = p;
    await step();
  }
  await page.mouse.click(dx, dy);
  mark('drive');
  // The recordings load in real time while the film holds still.
  await waitReal(() => Boolean(document.querySelector('.rover-status')), 60000);
  for (const p of [0.7, 0.4, 0.15, 0]) {
    cursor.press = p;
    await step();
  }
  await moveTo(1500, 980, 0.8);
  await fadeCursor(0, 0.4);

  // The first handoff, flown.
  await until('wifi', () => /Moved to Wi-Fi/.test(document.querySelector('.moment')?.innerText ?? ''), 40);
  await hold(7.6);

  // Slow it down, and show where every network reaches.
  mark('slow');
  await clickOn(button('Change the run'), 0.9);
  await hold(0.4);
  const speed = page.getByLabel('Playback speed');
  const { x: sx, y: sy } = await center(speed);
  await moveTo(sx, sy, 0.7);
  for (const p of [0.5, 1, 0.6, 0.2, 0]) {
    cursor.press = p;
    await step();
  }
  await speed.selectOption('0.5');
  mark('half-speed');
  await hold(0.6);
  await page.keyboard.press('Escape');
  await hold(0.3);
  await clickOn(button(/where each network reaches/), 0.9);
  mark('coverage-on');
  // From above, the discs read: where each access point and the mast reach.
  await clickOn(button('Overview camera'), 0.7);
  mark('overview');
  await moveTo(1500, 760, 0.8);
  await hold(1.8);
  await clickOn(button('Follow camera'), 0.9);
  mark('follow');
  await clickOn(button(/where each network reaches/), 0.6);
  mark('coverage-off');
  await moveTo(1880, 620, 0.9);
  await fadeCursor(0, 0.4);

  // The road map sees the cutting coming.
  await until('warning', () => /Dead zone/.test(document.querySelector('.moment')?.innerText ?? ''), 60);
  await until('satellite', () => /Moved to Satellite/.test(document.querySelector('.moment')?.innerText ?? ''), 60);
  await until('cut-off', () => /Connection lost/.test([...document.querySelectorAll('.rover-status')].map((e) => e.innerText).join(' ')), 30);
  await hold(8.6);

  // Your turn: W takes the wheel. A slow roll first, steered left and right,
  // so the steering reads before the first new link sends the camera flying.
  mark('wheel');
  await page.keyboard.down('KeyW');
  await waitReal(() => Boolean(document.querySelector('.drive-card')), 60000);
  await page.keyboard.up('KeyW');
  await step();
  await page.keyboard.down('KeyW');
  mark('driving');
  await hold(0.9);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyA');
  mark('steer-left');
  await hold(0.9);
  await page.keyboard.up('KeyA');
  await page.keyboard.down('KeyD');
  mark('steer-right');
  await hold(1.0);
  await page.keyboard.up('KeyD');
  await page.keyboard.down('KeyW');
  mark('drive-on');
  await hold(8.8);
  await page.keyboard.up('KeyW');
  await page.keyboard.down('KeyS');
  mark('reverse');
  await hold(3.6);
  await page.keyboard.up('KeyS');
  await hold(0.6);

  // Escape: autopilot. Details: every measurement.
  await page.keyboard.press('Escape');
  mark('autopilot');
  await hold(2.2);
  await clickOn(button('Details'), 1.0);
  mark('details');
  await moveTo(1180, 640, 1.0);
  await hold(3.0);

  // The results, the decision log, the brief, the credits. A page change needs
  // the clock to tick - the router waits on timers - so these waits step frames.
  await clickOn(navLink('Results'), 1.1);
  await until('results', () => location.pathname.startsWith('/experiments') && /kept the link/i.test(document.body.innerText), 20);
  await moveTo(1500, 700, 0.8);
  await fadeCursor(0, 0.4);
  await hold(1.6);
  await scrollTo(SCROLLER, 520, 3.4);
  await hold(1.4);
  await scrollTo(SCROLLER, 1150, 3.0);
  await hold(1.0);

  await clickOn(navLink('Decision log'), 1.0);
  await until('decisions', () => location.pathname.startsWith('/decision-log') && /recorded runs/i.test(document.body.innerText), 20);
  await hold(0.6);
  // One decision opened: the observations it was made on.
  await clickOn(page.getByText(/^Switched to Cellular$/).first(), 0.9);
  await hold(2.6);

  await clickOn(navLink('The brief'), 1.0);
  await until('brief', () => location.pathname.startsWith('/challenge') && /five success criteria/i.test(document.body.innerText), 20);
  await moveTo(1600, 800, 0.8);
  await fadeCursor(0, 0.4);
  await hold(1.4);
  await scrollTo('.doc-scroll', 2050, 3.6);
  await hold(1.0);
  await scrollTo('.doc-scroll', 3350, 2.0);
  await hold(0.6);

  await clickOn(navLink('Credits'), 1.0);
  await until('credits', () => location.pathname.startsWith('/credits') && /made by/i.test(document.body.innerText), 20);
  await moveTo(1700, 900, 0.8);
  await fadeCursor(0, 0.4);
  await hold(5.2);
  mark('end');
}

async function aerial() {
  await open('/', '.topbar{display:none!important} .app-shell{grid-template-rows:minmax(0,1fr)!important} .story-landing{visibility:hidden!important} .mission-root .hud-chip{visibility:hidden!important}');
  await sceneReady();
  await freezeClock();
  // The landing holds its preview still; play it, from the start of the director's aerial.
  await page.evaluate(() => {
    window.__CONTINUA__.clock.setTime(0.5);
    window.__CONTINUA__.clock.play();
  });
  mark('aerial');
  await hold(9.0);
}

async function proof() {
  await open('/challenge');
  await waitReal(() => document.body.innerText.includes('kept the link'), 60000);
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const el = document.getElementById('comparison');
    el?.scrollIntoView({ block: 'start' });
  });
  await page.waitForTimeout(600);
  const block = page.locator('.doc-proof');
  await block.screenshot({ path: path.join(OUT, 'proof.png') });
  console.log('proof.png written');
}

const SHOTS = { walkthrough, aerial, proof };
const began = Date.now();
await SHOTS[SHOT]();
writeFileSync(path.join(HERE, `${OUT_NAME}-capture.json`), JSON.stringify({ fps: FPS, frames: frame, seconds: +filmTime().toFixed(3), marks, errors, telemetry }, null, 1));
console.log(`${SHOT}: ${frame} frames, ${filmTime().toFixed(2)} s, ${((Date.now() - began) / 60000).toFixed(1)} min, errors ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 6));
await browser.close();
