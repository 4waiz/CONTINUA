#!/usr/bin/env node
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-3FCEB1FD94F9 */
/**
 * Record the page's voice: every line it can say - each sentence the drive
 * view says when something changes, each caption of the story - synthesised
 * on this machine with a voice that ships with Windows (`scripts/speak.ps1`,
 * the OneCore voice the demo video's narration uses). No text or audio leaves
 * the host and no service is called; see docs/AI_USE.md.
 *
 * Reads `apps/web/public/voice/lines.json` - its `drive` list from
 * `scripts/voice-lines-drive.mts`, its `story` list from
 * `scripts/voice-lines-story.mjs` - and writes, beside it, one MP3 per line
 * and `index.json`, which maps each line - exactly as the page shows it - to
 * its file. The page plays a line's recording when there is one and otherwise
 * reads it with the browser's own local voice
 * (`apps/web/src/components/mission/voice.ts`).
 *
 * The words are the line's own. Only units are said in full - "4.5 s" is
 * "4.5 seconds", "79 m" is "79 metres", "3.2×" is "3.2 times" - by the same
 * rule the page's fallback voice applies (`spoken` in voice.ts).
 *
 * A line already recorded with the same voice and rate is kept, not redone;
 * a recording no line uses any more is removed.
 *
 *   node scripts/build-voice.mjs
 *   node scripts/build-voice.mjs --voice "Microsoft Zira" --rate 4
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'apps/web/public/voice');
const LINES = join(OUT_DIR, 'lines.json');
const WORK = join(ROOT, 'video/work/voice');
const SPEAK = join(ROOT, 'scripts/speak.ps1');

const argv = process.argv.slice(2);
const arg = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
const VOICE = arg('--voice', 'Microsoft Mark');
/** Percentage against the voice's natural pace; the story's captions are short and plain. */
const RATE = Number(arg('--rate', 0));

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** Units as they are said - the rule `spoken` in apps/web/src/components/mission/voice.ts applies. */
function spoken(text) {
  return text
    .replace(/(\d+(?:\.\d+)?)\s?s\b/g, (_, value) => `${value} ${value === '1' ? 'second' : 'seconds'}`)
    .replace(/(\d+(?:\.\d+)?)\s?m\b/g, (_, value) => `${value} ${value === '1' ? 'metre' : 'metres'}`)
    .replace(/(\d+(?:\.\d+)?)×/g, '$1 times');
}

function durationOf(path) {
  const output = run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', path]);
  return Number(output.trim());
}

if (!existsSync(LINES)) {
  console.error(`No ${LINES}: run scripts/voice-lines-drive.mts and scripts/voice-lines-story.mjs first.`);
  process.exit(1);
}
const lists = JSON.parse(readFileSync(LINES, 'utf8'));
const lines = [...new Set([...(lists.drive ?? []), ...(lists.story ?? [])])];
mkdirSync(WORK, { recursive: true });
mkdirSync(OUT_DIR, { recursive: true });

const previous = existsSync(join(OUT_DIR, 'index.json')) ? JSON.parse(readFileSync(join(OUT_DIR, 'index.json'), 'utf8')) : null;
let engine = previous?.engine ?? null;
const index = { voice: VOICE, rate: RATE, engine, lines: [] };

for (const text of lines) {
  const say = spoken(text);
  const id = createHash('sha1').update(`${VOICE}|${RATE}|${say}`).digest('hex').slice(0, 12);
  const file = `${id}.mp3`;
  const mp3 = join(OUT_DIR, file);
  if (!existsSync(mp3)) {
    const wav = join(WORK, `${id}.wav`);
    const output = run('powershell', [
      '-NoProfile',
      '-ExecutionPolicy', 'Bypass',
      '-File', SPEAK,
      '-Text', say,
      '-Out', wav,
      '-RatePercent', String(RATE),
      '-Voice', VOICE,
    ]);
    const reported = /engine=(\w+) voice=(.+)/.exec(output.trim());
    if (reported) engine = { engine: reported[1], voice: reported[2].trim() };
    // Mono, 24 kHz, 48 kb/s: a voice, not music - about 6 kB a second.
    run('ffmpeg', ['-y', '-v', 'error', '-i', wav, '-ac', '1', '-ar', '24000', '-codec:a', 'libmp3lame', '-b:a', '48k', mp3]);
  }
  const seconds = Math.round(durationOf(mp3) * 100) / 100;
  index.lines.push({ text, spoken: say, file, seconds });
  console.log(`${seconds.toFixed(2).padStart(6)} s  ${file}  ${text}`);
}
index.engine = engine;

for (const name of readdirSync(OUT_DIR)) {
  if (name.endsWith('.mp3') && !index.lines.some((line) => line.file === name)) {
    unlinkSync(join(OUT_DIR, name));
    console.log(`removed ${name}: no line uses it`);
  }
}
writeFileSync(join(OUT_DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
console.log(`${index.lines.length} lines, ${engine ? `${engine.engine} / ${engine.voice}` : 'engine unknown'} -> ${join(OUT_DIR, 'index.json')}`);
