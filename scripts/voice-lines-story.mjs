#!/usr/bin/env node
/**
 * Collect the lines the story's voice reads, from a run of the story in 3D
 * (`?story` opens the film; its "Replay it in 3D" plays the story).
 *
 * The captions are built from the run's own events, so the way to know them is
 * to play the story: this opens the Mission page's story in a browser and
 * records every caption that appears in the story's bar and every line the
 * narrator is asked to read - the settled captions and the proof card's text at
 * the end. They become the `story` list of `apps/web/public/voice/lines.json`,
 * which `scripts/build-voice.mjs` records; the drive's lines are
 * `scripts/voice-lines-drive.mts`'s.
 *
 * Needs the web app and the engine running (or the static export, which plays
 * the recorded runs):
 *
 *   node scripts/voice-lines-story.mjs
 *   CONTINUA_WEB=http://localhost:4321 node scripts/voice-lines-story.mjs
 */

import { chromium } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'apps/web/public/voice/lines.json');
const WEB = process.env.CONTINUA_WEB ?? 'http://localhost:3000';
/** The story runs about fifty seconds; past this something is wrong. */
const TIMEOUT_MS = 180_000;

const browser = await chromium.launch({ args: ['--use-gl=angle', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.addInitScript(() => {
  window.__CONTINUA_VOICE_LOG__ = [];
});
// `?story` opens the film; its "Replay it in 3D" plays the story in the app.
await page.goto(`${WEB}/?story`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForFunction(() => Boolean(window.__CONTINUA__?.three), undefined, { timeout: 180_000 });
const replay = page.getByRole('dialog', { name: /one-minute film/ }).getByRole('button', { name: 'Replay it in 3D' });
await replay.waitFor({ timeout: 60_000 });
await page.waitForFunction(
  () => {
    const button = [...document.querySelectorAll('button')].find((element) => element.textContent?.includes('Replay it in 3D'));
    return Boolean(button && !button.disabled);
  },
  undefined,
  { timeout: 60_000 },
);
await replay.click();

const seen = [];
const started = Date.now();
let proofAt = null;
for (;;) {
  const caption = await page.evaluate(() => document.querySelector('.story-bar-caption')?.textContent?.trim() ?? null);
  if (caption && !seen.includes(caption)) seen.push(caption);
  if (proofAt === null && (await page.locator('section[aria-label="The proof"] li').count()) > 0) proofAt = Date.now();
  // The proof's text is handed to the voice once its figures have loaded.
  if (proofAt !== null && Date.now() - proofAt > 2_000) break;
  if (Date.now() - started > TIMEOUT_MS) throw new Error('the story did not reach its proof card');
  await page.waitForTimeout(100);
}
const said = await page.evaluate(() => window.__CONTINUA_VOICE_LOG__);
await browser.close();

// Every line the voice may be asked for: what it was asked for this time, and
// every caption shown - a caption that held for less than the voice's settling
// time this time may hold longer on a slower machine.
const lines = [...new Set([...said, ...seen])];
mkdirSync(dirname(OUT), { recursive: true });
const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
writeFileSync(OUT, `${JSON.stringify({ ...existing, story: lines }, null, 2)}\n`);
console.log(`${lines.length} story lines (${said.length} read aloud this run) -> ${OUT}`);
for (const line of lines) console.log(`  ${said.includes(line) ? 'read ' : 'shown'}  ${line}`);
