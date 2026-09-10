#!/usr/bin/env node
/**
 * Synthesise the narration and lay it on the video's timeline.
 *
 * Voice: the Windows speech API, running locally on this machine. Nothing is
 * uploaded, no paid service is called, and no real person is imitated or
 * cloned - see `docs/AI_USE.md` and `scripts/speak.ps1`.
 *
 * The interesting part is the fitting. Each cue in `video/timeline.json` owns a
 * window, and a clip that overruns its window would either collide with the
 * next line or run past the cut it belongs to. So each line is synthesised at a
 * slow, readable rate first, measured with ffprobe, and re-synthesised faster
 * only if it does not fit. If a line still will not fit at the fastest rate
 * this script is willing to use, it **fails** and names the cue: the fix is to
 * shorten the sentence or widen the window in the timeline, not to let the
 * audio drift out of sync with the picture.
 *
 * That ceiling is deliberately low. The first cut let lines run at the fastest
 * rate the speech API offers, and the result was a script full of decimals read
 * at three and a half words a second with no pauses - technically in sync, and
 * unlistenable. Anything above +18 % now fails the build instead.
 *
 *   node scripts/build-narration.mjs
 *   node scripts/build-narration.mjs --voice "Microsoft Zira"
 *
 * Outputs `video/audio/narration.wav` (the full 105 s bed) and
 * `video/audio/narration.json` (per-cue rate, measured duration, headroom).
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIMELINE = JSON.parse(readFileSync(join(ROOT, 'video/timeline.json'), 'utf8'));
const AUDIO = join(ROOT, 'video', 'audio');

const argv = process.argv.slice(2);
const voiceIndex = argv.indexOf('--voice');
// Mark is a OneCore voice: it is not visible to System.Speech at all, and it
// reads a technical script noticeably better than the old "Desktop" voices.
const VOICE = voiceIndex === -1 ? 'Microsoft Mark' : argv[voiceIndex + 1];

/**
 * Percentage rates to try, slowest first, against the voice's natural pace.
 * The script is dense with numbers, so it starts below natural and the ceiling
 * is +18 %: past that the decimals stop being followable.
 */
const RATES = [-8, -4, 0, 5, 10, 14, 18];
/** Leave a beat at the end of each window so lines never butt against a cut. */
const TAIL_S = 0.15;

const run = (command, args) => execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

function durationOf(path) {
  const output = run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    path,
  ]);
  return Number.parseFloat(output.trim());
}

let engineUsed = null;

function speak(text, out, rate) {
  const output = run('powershell', [
    '-NoProfile',
    '-ExecutionPolicy', 'Bypass',
    '-File', join(ROOT, 'scripts', 'speak.ps1'),
    '-Text', text,
    '-Out', out,
    '-RatePercent', String(rate),
    '-Voice', VOICE,
  ]);
  const reported = /engine=(\w+) voice=(.+)/.exec(output.trim());
  if (reported) engineUsed = { engine: reported[1], voice: reported[2].trim() };
  return durationOf(out);
}

function main() {
  mkdirSync(AUDIO, { recursive: true });

  const total = TIMELINE.video.duration_s;
  const report = [];
  const problems = [];

  for (const cue of TIMELINE.narration) {
    const window = cue.to - cue.from - TAIL_S;
    const path = join(AUDIO, `${cue.id}.wav`);

    let chosen = null;
    for (const rate of RATES) {
      const seconds = speak(cue.text, path, rate);
      if (seconds <= window) {
        chosen = { rate, seconds };
        break;
      }
      chosen = { rate, seconds };
    }

    const fits = chosen.seconds <= window;
    report.push({
      id: cue.id,
      from: cue.from,
      to: cue.to,
      window_s: Number(window.toFixed(2)),
      rate: chosen.rate,
      measured_s: Number(chosen.seconds.toFixed(2)),
      headroom_s: Number((window - chosen.seconds).toFixed(2)),
      fits,
      words: cue.text.split(/\s+/).length,
    });

    const flag = fits ? ' ' : '!';
    console.log(
      `${flag} ${cue.id}  ${cue.from.toFixed(1)}–${cue.to.toFixed(1)}s  ` +
        `rate ${`${chosen.rate > 0 ? '+' : ''}${chosen.rate}%`.padStart(5)}  ` +
        `${chosen.seconds.toFixed(2)}s / ${window.toFixed(2)}s`,
    );
    if (!fits) {
      problems.push(
        `${cue.id} needs ${chosen.seconds.toFixed(2)}s but its window is ${window.toFixed(2)}s ` +
          `even at +${chosen.rate}%, the fastest this build will read. ` +
          'Shorten the line or widen the window in video/timeline.json.',
      );
    }
  }

  if (problems.length) {
    console.error('\nnarration does not fit the timeline:\n');
    for (const problem of problems) console.error(`  ✗ ${problem}`);
    process.exit(1);
  }

  // --- lay every clip on a silent bed at its cue time ----------------------
  // One filter graph rather than fourteen concat steps: each clip is delayed to
  // its own start and mixed onto silence, so a clip that finishes early leaves
  // real silence rather than pulling the next line forward.
  const inputs = [];
  const filters = [];
  TIMELINE.narration.forEach((cue, index) => {
    inputs.push('-i', join(AUDIO, `${cue.id}.wav`));
    const delayMs = Math.round(cue.from * 1000);
    filters.push(
      `[${index}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=mono,adelay=${delayMs}|${delayMs}[a${index}]`,
    );
  });
  const mixInputs = TIMELINE.narration.map((_cue, index) => `[a${index}]`).join('');
  filters.push(
    `${mixInputs}amix=inputs=${TIMELINE.narration.length}:normalize=0:dropout_transition=0[mixed]`,
  );
  // A little headroom, then a hard limit so the AAC encoder never clips.
  filters.push(`[mixed]volume=1.35,alimiter=limit=0.95,apad,atrim=0:${total}[out]`);

  const target = join(AUDIO, 'narration.wav');
  run('ffmpeg', [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...inputs,
    '-filter_complex', filters.join(';'),
    '-map', '[out]',
    '-ac', '1', '-ar', '48000', '-c:a', 'pcm_s16le',
    target,
  ]);

  const measured = durationOf(target);
  writeFileSync(
    join(AUDIO, 'narration.json'),
    `${JSON.stringify(
      {
        voice: engineUsed?.voice ?? VOICE,
        synthesiser:
          engineUsed?.engine === 'winrt'
            ? 'Windows.Media.SpeechSynthesis (OneCore, local)'
            : 'Windows System.Speech (SAPI5, local)',
        prosody: 'SSML: sentence and clause breaks, percentage rate, ceiling +18%',
        total_s: measured,
        cues: report,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(
    `\nnarration.wav  ${measured.toFixed(2)}s  voice "${engineUsed?.voice ?? VOICE}"` +
      ` via ${engineUsed?.engine ?? 'unknown'}`,
  );
  console.log(`report: video/audio/narration.json`);
  if (Math.abs(measured - total) > 0.05) {
    console.warn(`note: bed is ${measured.toFixed(2)}s against a ${total}s timeline`);
  }
}

if (!existsSync(join(ROOT, 'video/timeline.json'))) {
  console.error('video/timeline.json is missing');
  process.exit(1);
}
main();
