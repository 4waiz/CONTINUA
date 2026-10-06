// Ten stills of CONTINUA running, for the submission: the same frame-exact
// harness as capture.mjs (Playwright's fake clock, one animation frame per
// 1/30 s), no cursor, PNG at 1920x1080. Every still is the public build
// replaying the engine's recorded runs; the director waits for the app's own
// events (a change of network, the road map's banner) before it shoots.
//
//   node stills.mjs <out-dir>
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const FPS = 30;
const SITE = (process.env.SITE ?? 'http://localhost:4321').replace(/\/$/, '');
const OUT = path.resolve(process.argv[2] ?? 'stills');
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11', '--force_high_performance_gpu', '--hide-scrollbars'],
});
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
await context.clock.install();
await context.addInitScript(() => {
  window.__CONTINUA_CAPTURE__ = true;
  Object.defineProperty(DocumentTimeline.prototype, 'currentTime', {
    configurable: true,
    get() {
      return performance.now();
    },
  });
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
page.on('console', (m) => m.type() === 'error' && !/websocket|favicon/i.test(m.text()) && errors.push(m.text()));

let frame = 0;
const shots = [];

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
  frame += 1;
}

async function hold(seconds) {
  const n = Math.round(seconds * FPS);
  for (let i = 0; i < n; i += 1) await step();
}

async function until(name, test, limit = 60) {
  for (let i = 0; i < limit * FPS; i += 1) {
    if (await page.evaluate(test)) {
      console.log(`  ${name} @ ${(frame / FPS).toFixed(2)} s`);
      return;
    }
    await step();
  }
  throw new Error(`${name}: not seen within ${limit} s`);
}

async function snap(name, note) {
  const file = path.join(OUT, `${name}.png`);
  await page.mouse.move(1919, 1079);
  await step();
  await page.screenshot({ path: file });
  const info = await page.evaluate(() => ({
    t: window.__CONTINUA__?.clock?.time ?? null,
    url: location.pathname,
    moment: document.querySelector('.moment')?.innerText.replace(/\s+/g, ' ').trim() ?? null,
    status: [...document.querySelectorAll('.rover-status')].map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
  }));
  shots.push({ file: path.basename(file), note, ...info });
  console.log(`snap ${name}`, JSON.stringify(info).slice(0, 200));
}

async function click(locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error('target not visible');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await step();
}

async function scrollTo(selector, to) {
  await page.evaluate(([s, top]) => {
    const el = document.querySelector(s);
    if (el) el.scrollTop = top;
  }, [selector, to]);
  await hold(0.4);
}

const button = (name) => page.getByRole('button', { name, exact: typeof name === 'string' });
const navLink = (name) => page.getByRole('link', { name, exact: true });

// --- load ---------------------------------------------------------------------------

await page.goto(`${SITE}/`, { waitUntil: 'load' });
const renderer = await page.evaluate(() => {
  const c = document.createElement('canvas').getContext('webgl2');
  const ext = c?.getExtension('WEBGL_debug_renderer_info');
  return ext ? c.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'unknown';
});
console.log('renderer:', renderer);
if (!/NVIDIA|AMD|Radeon/i.test(renderer)) throw new Error(`no hardware GPU: ${renderer}`);
await page.waitForFunction(() => Boolean(window.__CONTINUA__?.three) && !document.body.innerText.includes('Loading mission scene'), null, { timeout: 180000 });
await page.waitForTimeout(2500);
if ((await page.evaluate(() => window.__CONTINUA__?.settings?.get?.().quality)) !== 'high') {
  await page.evaluate(() => window.__CONTINUA__.settings.set({ quality: 'high' }));
  await page.waitForTimeout(3000);
}
const start = await page.evaluate(() => Date.now());
await page.clock.pauseAt(start + 1000);
await page.evaluate(() => window.__bragFrames.manual());
await hold(0.2);

// --- the director ------------------------------------------------------------------------

await hold(1.8);
await snap('01-mission-landing', 'The Mission landing: one way in, the intro, and the keys.');

await click(button('Drive it yourself'));
await page.waitForFunction(() => Boolean(document.querySelector('.rover-status')), null, { timeout: 60000 });
await until('wifi', () => /Moved to Wi-Fi/.test(document.querySelector('.moment')?.innerText ?? ''), 40);
await hold(2.6);
await snap('02-handoff-flight', 'A change of network: the camera flies out to the access point the new link comes from, then rides the beam back.');
await hold(4.2);

await until('warning', () => /Dead zone/.test(document.querySelector('.moment')?.innerText ?? ''), 60);
await hold(1.0);
await snap('03-dead-zone-ahead', "The road map's warning: a dead zone ahead, satellite warmed up before Wi-Fi and cellular drop.");
await until('satellite', () => /Moved to Satellite/.test(document.querySelector('.moment')?.innerText ?? ''), 60);
await until('cut-off', () => /Connection lost/.test([...document.querySelectorAll('.rover-status')].map((e) => e.innerText).join(' ')), 30);
await hold(1.9);
await snap('04-satellite-vs-cut-off', 'In the cutting: CONTINUA on satellite, still connected; the normal rover has lost its link.');
await hold(6.0);

await page.keyboard.down('KeyW');
await page.waitForFunction(() => Boolean(document.querySelector('.drive-card')), null, { timeout: 60000 });
await page.keyboard.up('KeyW');
await step();
await page.keyboard.down('KeyW');
await hold(0.9);
await page.keyboard.up('KeyW');
await page.keyboard.down('KeyA');
await hold(0.9);
await page.keyboard.up('KeyA');
await page.keyboard.down('KeyD');
await hold(1.0);
await page.keyboard.up('KeyD');
await page.keyboard.down('KeyW');
await hold(5.2);
await snap('05-you-drive', 'Taken the wheel: W A S D drives the rover along the road; the network is the recorded run at that point of the road.');
await page.keyboard.up('KeyW');
await page.keyboard.press('Escape');
await hold(2.2);
await click(button('Details'));
await hold(2.0);
await snap('06-details', 'Details: every measurement for both rovers at this moment, down to each kind of traffic.');

await click(navLink('Results'));
await until('results', () => location.pathname.startsWith('/experiments') && /kept the link/i.test(document.body.innerText), 20);
await hold(1.6);
await snap('07-results', 'Results: every strategy on the same road, twenty paired drives each.');

await click(navLink('Decision log'));
await until('decisions', () => location.pathname.startsWith('/decision-log') && /recorded runs/i.test(document.body.innerText), 20);
await hold(0.6);
await click(page.getByText(/^Switched to Cellular$/).first());
await hold(1.6);
await snap('08-decision-log', 'The decision log: every choice the controller made, the observations behind it, and why.');

await click(navLink('The brief'));
await until('brief', () => location.pathname.startsWith('/challenge') && /five success criteria/i.test(document.body.innerText), 20);
await hold(1.2);
await snap('09-the-brief', "The brief: the EDGE challenge's success criteria, each mapped to its evidence.");

await click(navLink('Credits'));
await until('credits', () => location.pathname.startsWith('/credits') && /made by/i.test(document.body.innerText), 20);
await hold(1.6);
await snap('10-credits', 'Credits: Team Kanban, the stack, and where every figure comes from.');

writeFileSync(path.join(OUT, 'stills.json'), JSON.stringify({ site: SITE, shots, errors }, null, 1));
console.log(`stills: ${shots.length}, errors ${errors.length}`);
if (errors.length) console.log(errors.slice(0, 6));
await browser.close();
