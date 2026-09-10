#!/usr/bin/env node
/**
 * Screenshot every page at the three viewports the design targets.
 *
 * This exists because judging a 1920-wide layout from a scaled-down preview
 * pane is how you ship 11px type that looked fine at 40 %. Shots are written at
 * exactly the viewport size, so what is on disk is what a user sees.
 *
 * It also **measures the two things the redesign is accountable for**: whether
 * the page scrolls (it must not), and how small the smallest visible text is.
 *
 *   node scripts/ui-screenshots.mjs
 *   node scripts/ui-screenshots.mjs --only mission --width 1920
 *
 * Output: video/work/ui/<page>-<width>x<height>.png, plus a JSON report.
 */

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'video', 'work', 'ui');
const WEB = process.env.CONTINUA_WEB ?? 'http://localhost:3000';

const PAGES = [
  { id: 'mission', path: '/' },
  { id: 'scenario-lab', path: '/scenario-lab' },
  { id: 'experiments', path: '/experiments' },
  { id: 'decision-log', path: '/decision-log' },
  { id: 'scene-lab', path: '/scene-lab' },
];

const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
];

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const widthOnly = argv.includes('--width') ? Number(argv[argv.indexOf('--width') + 1]) : null;
/** Start a run and let it get past the first handoff before shooting. */
const withRun = argv.includes('--run');
const runSeconds = argv.includes('--run-for') ? Number(argv[argv.indexOf('--run-for') + 1]) : 32;

/**
 * The smallest font-size actually painted, ignoring elements that are hidden or
 * empty. Reported per page so "typography is too small" becomes a number.
 */
async function measure(page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const sizes = new Map();
    for (const element of document.querySelectorAll('body *')) {
      const text = (element.textContent ?? '').trim();
      if (!text) continue;
      // Only count elements that own their text, not wrappers.
      const ownsText = [...element.childNodes].some(
        (node) => node.nodeType === 3 && (node.textContent ?? '').trim().length > 0,
      );
      if (!ownsText) continue;
      const box = element.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
      const size = Math.round(parseFloat(style.fontSize) * 10) / 10;
      const entry = sizes.get(size) ?? { size, count: 0, sample: text.slice(0, 48) };
      entry.count += 1;
      sizes.set(size, entry);
    }
    // Two different questions, and the obvious measurement answers neither.
    //
    // `scrollHeight > clientHeight` counts overflow even when an ancestor clips
    // it, so it claims a page scrolls when the user cannot move it at all. And
    // setting `scrollTop` still "works" under `overflow: hidden`, so trying it
    // is no better. What the user can actually do is decided by the computed
    // overflow of the scrolling element.
    const scroller = document.scrollingElement ?? doc;
    const rootOverflow = getComputedStyle(doc).overflowY;
    const canScrollPage =
      rootOverflow !== 'hidden' && scroller.scrollHeight - scroller.clientHeight > 2;

    // The defect that matters is content pushed out of view with **no**
    // scrollable ancestor to reach it — that is genuinely unreachable, and it is
    // what a fixed-viewport layout gets wrong when a column grows unbounded.
    const unreachable = [];
    for (const element of document.querySelectorAll('body *')) {
      const box = element.getBoundingClientRect();
      if (box.top < window.innerHeight - 2 || box.height < 10) continue;
      if (!(element.textContent ?? '').trim()) continue;
      let ancestor = element.parentElement;
      let reachable = false;
      while (ancestor && ancestor !== document.body) {
        const overflow = getComputedStyle(ancestor).overflowY;
        if (overflow === 'auto' || overflow === 'scroll') {
          reachable = true;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      if (!reachable) {
        unreachable.push({
          tag: element.tagName.toLowerCase(),
          text: (element.textContent ?? '').trim().slice(0, 40),
          top: Math.round(box.top),
        });
      }
    }

    // Regions that scroll inside the shell are by design; report them so a
    // column silently growing unbounded is still visible in the numbers.
    const inner = [...document.querySelectorAll('.scroll-y')]
      .filter((el) => el.scrollHeight - el.clientHeight > 4)
      .map((el) => ({
        cls: (el.className || '').toString().split(' ').slice(0, 3).join(' '),
        hidden: el.scrollHeight - el.clientHeight,
      }));

    return {
      pageScrollsY: canScrollPage,
      unreachable: unreachable.slice(0, 5),
      innerScrollRegions: inner,
      fontSizes: [...sizes.values()].sort((a, b) => a.size - b.size).slice(0, 5),
    };
  });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--hide-scrollbars', '--force-device-scale-factor=1'] });
  const report = [];

  for (const viewport of VIEWPORTS) {
    if (widthOnly && viewport.width !== widthOnly) continue;
    for (const target of PAGES) {
      if (only && target.id !== only) continue;

      const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      page.on('console', (message) => {
        if (message.type() === 'error' && !/hmr|websocket/i.test(message.text())) errors.push(message.text());
      });

      await page.goto(`${WEB}${target.path}`, { waitUntil: 'networkidle', timeout: 45000 });
      // Give the canvas and any dynamic import a moment to settle.
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(3500);

      // The empty state is easy to make look good. The populated state is the
      // one that has to hold up, so shoot that too when asked.
      let suffix = '';
      if (withRun && (target.id === 'mission' || target.id === 'scenario-lab')) {
        const button = page.getByRole('button', { name: /start run|run scenario/i }).first();
        if (await button.count()) {
          await button.click();
          await page.waitForTimeout(runSeconds * 1000);
          suffix = '-running';
        }
      }

      const name = `${target.id}${suffix}-${viewport.width}x${viewport.height}.png`;
      await page.screenshot({ path: join(OUT, name), animations: 'disabled' });
      const metrics = await measure(page);

      report.push({ page: target.id, ...viewport, file: name, ...metrics, errors: errors.slice(0, 4) });
      const flag = metrics.pageScrollsY || metrics.unreachable.length > 0 ? '!' : ' ';
      console.log(
        `${flag} ${target.id.padEnd(13)} ${viewport.width}x${viewport.height}  ` +
          `page-scroll ${metrics.pageScrollsY ? 'YES' : 'none'}  ` +
          `unreachable ${metrics.unreachable.length}  ` +
          `inner-scroll ${metrics.innerScrollRegions.length}  ` +
          `min-font ${metrics.fontSizes[0]?.size ?? '?'}px` +
          (errors.length ? `  ${errors.length} console error(s)` : ''),
      );
      await page.close();
    }
  }

  await browser.close();
  writeFileSync(join(OUT, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`\n${report.length} shots in video/work/ui/`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
