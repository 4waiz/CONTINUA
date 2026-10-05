// Render the composition one frame at a time.
//   node render.mjs --stills=20,60,...   PNG stills to work/stills/
//   node render.mjs --all                every frame to work/frames/film/
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = pathToFileURL(path.join(HERE, '..', 'composition', 'index.html')).href;
const stillsArg = process.argv.find((a) => a.startsWith('--stills='));
const ALL = process.argv.includes('--all');

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--use-angle=d3d11', '--force_high_performance_gpu', '--allow-file-access-from-files', '--hide-scrollbars'],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await page.goto(PAGE, { waitUntil: 'load' });
await page.evaluate(() => window.ready);
const total = await page.evaluate(() => window.TOTAL_FRAMES);

const frames = ALL ? [...Array(total).keys()] : stillsArg.split('=')[1].split(',').map(Number);
const out = path.join(HERE, ALL ? 'frames/film' : 'stills');
mkdirSync(out, { recursive: true });
const began = Date.now();
for (const f of frames) {
  const info = await page.evaluate((x) => window.renderFrame(x), f);
  const file = path.join(out, ALL ? `${String(f).padStart(5, '0')}.jpg` : `s${String(f).padStart(5, '0')}.png`);
  await page.screenshot({ path: file, ...(ALL ? { type: 'jpeg', quality: 94 } : {}) });
  if (!ALL || f % 150 === 0) console.log(f, JSON.stringify(info), ((Date.now() - began) / 1000).toFixed(1) + 's');
}
console.log('total frames', total, 'rendered', frames.length, 'errors', errors.slice(0, 5));
await browser.close();
