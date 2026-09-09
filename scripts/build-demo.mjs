#!/usr/bin/env node
/**
 * Assemble the demo video from captured frames, rendered frames and narration.
 *
 * The design goal is that this is a *build*, not an edit: everything it needs
 * is on disk, nothing is decided here, and running it twice produces the same
 * file. `video/timeline.json` is the edit decision list; this script only
 * executes it.
 *
 * How it works, and why:
 *
 * 1. **Claims are checked first.** `scripts/check-claims.mjs` runs before a
 *    single frame is touched, so a banned phrase or an unsourced number stops
 *    the build rather than being discovered in a finished MP4.
 * 2. **Titles are composited onto the rendered shots.** The opening and closing
 *    shots are Blender frames, so their titles cannot be drawn by the running
 *    app. FFmpeg fades the transparent plate captured from `/capture/title`
 *    over them.
 * 3. **Every frame is hard-linked into one ordered sequence.** Rather than
 *    encoding ten segments and concatenating them — which re-encodes, and
 *    invites a frame-count mismatch at every join — the shots are laid into a
 *    single `%06d.png` sequence and encoded once. Hard links cost no disk, and
 *    a card still is simply linked once per frame it is held for.
 * 4. **One encode.** H.264, yuv420p, 30 fps, faststart, AAC narration.
 *
 *   node scripts/build-demo.mjs
 *   node scripts/build-demo.mjs --no-audio      # picture only
 *
 * Outputs into `deliverables/`: the MP4, the SRT, a poster and a contact sheet,
 * plus `video/manifest.json` recording exactly what went in.
 */

import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  linkSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIMELINE = JSON.parse(readFileSync(join(ROOT, 'video/timeline.json'), 'utf8'));
const FRAMES = join(ROOT, 'video', 'frames');
const RENDERS = join(ROOT, 'video', 'renders');
const WORK = join(ROOT, 'video', 'work');
const AUDIO = join(ROOT, 'video', 'audio');
const OUT = join(ROOT, 'deliverables');

const { width, height, fps, duration_s: DURATION } = TIMELINE.video;
const TOTAL_FRAMES = Math.round(DURATION * fps);
const NO_AUDIO = process.argv.includes('--no-audio');

const BASENAME = 'CONTINUA_Team_Kanban_Demo';

const ffmpeg = (args) =>
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });

const ffprobe = (args) => execFileSync('ffprobe', args, { encoding: 'utf8' }).trim();

const pad6 = (n) => String(n).padStart(6, '0');
const pad5 = (n) => String(n).padStart(5, '0');

function die(message) {
  console.error(`\nbuild-demo: ${message}\n`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 1. gate
// ---------------------------------------------------------------------------

console.log('· checking claims');
try {
  execFileSync('node', [join(ROOT, 'scripts', 'check-claims.mjs')], { stdio: 'inherit' });
} catch {
  die('check-claims failed. The video is not built until every claim resolves.');
}

// ---------------------------------------------------------------------------
// 2. titles onto the rendered shots
// ---------------------------------------------------------------------------

/**
 * Composite one transparent title plate over a rendered PNG sequence.
 * The plate fades in and out on the shot's own clock, so the timings in
 * `timeline.json` stay expressed in finished-video time.
 */
function compositeTitle(shot, overlay) {
  const source = join(RENDERS, shot.id === 'S1' ? 'intro' : 'outro');
  const plate = join(FRAMES, `title-${shot.id}`, 'plate.png');
  const target = join(WORK, shot.id);

  if (!existsSync(plate)) die(`missing title plate for ${shot.id}: ${plate}`);
  rmSync(target, { recursive: true, force: true });
  mkdirSync(target, { recursive: true });

  const inAt = Math.max(0, overlay.from - shot.video_from);
  const outAt = Math.max(inAt + 0.5, overlay.to - shot.video_from);
  const fadeIn = 0.7;
  const fadeOut = 0.4;

  ffmpeg([
    '-framerate', String(fps),
    '-i', join(source, '%04d.png'),
    '-loop', '1', '-framerate', String(fps), '-i', plate,
    '-filter_complex',
    `[1:v]format=rgba,fade=t=in:st=${inAt.toFixed(2)}:d=${fadeIn}:alpha=1,` +
      `fade=t=out:st=${(outAt - fadeOut).toFixed(2)}:d=${fadeOut}:alpha=1[plate];` +
      `[0:v][plate]overlay=0:0:shortest=1,format=rgb24[v]`,
    '-map', '[v]',
    '-frames:v', String(countFrames(source)),
    join(target, '%04d.png'),
  ]);

  console.log(`  ${shot.id}  title composited over ${countFrames(source)} rendered frames`);
  return target;
}

function countFrames(directory) {
  if (!existsSync(directory)) return 0;
  return readdirSync(directory).filter((name) => name.endsWith('.png')).length;
}

// ---------------------------------------------------------------------------
// 3. lay every shot into one ordered sequence
// ---------------------------------------------------------------------------

/** Hard link where possible; fall back to a copy across volumes. */
function place(source, target) {
  try {
    linkSync(source, target);
  } catch {
    copyFileSync(source, target);
  }
}

function buildSequence() {
  const sequence = join(WORK, 'seq');
  rmSync(sequence, { recursive: true, force: true });
  mkdirSync(sequence, { recursive: true });

  const titles = Object.fromEntries(
    TIMELINE.overlays.filter((overlay) => overlay.kind === 'title' && overlay.shot).map((o) => [o.shot, o]),
  );

  const placed = [];
  let cursor = 0;

  for (const shot of [...TIMELINE.shots].sort((a, b) => a.video_from - b.video_from)) {
    const want = Math.round(shot.video_to * fps) - Math.round(shot.video_from * fps);
    const startFrame = cursor;

    if (shot.kind === 'card') {
      const still = join(FRAMES, shot.id, 'still.png');
      if (!existsSync(still)) die(`missing card still for ${shot.id}. Run: node scripts/capture-demo.mjs`);
      for (let i = 0; i < want; i += 1) place(still, join(sequence, `${pad6(cursor++)}.png`));
    } else if (shot.kind === 'app') {
      const directory = join(FRAMES, shot.id);
      const available = countFrames(directory);
      if (available === 0) die(`no captured frames for ${shot.id}. Run: node scripts/capture-demo.mjs`);
      if (available < want) {
        die(
          `${shot.id} has ${available} frames but the timeline wants ${want}. ` +
            'Re-capture that shot rather than stretching it.',
        );
      }
      for (let i = 0; i < want; i += 1) place(join(directory, `${pad5(i)}.png`), join(sequence, `${pad6(cursor++)}.png`));
    } else if (shot.kind === 'blender') {
      const overlay = titles[shot.id];
      const directory = overlay ? compositeTitle(shot, overlay) : join(RENDERS, shot.id === 'S1' ? 'intro' : 'outro');
      const available = countFrames(directory);
      if (available === 0) {
        die(`no rendered frames for ${shot.id}. Run: node scripts/run-blender.mjs scripts/blender/render_video_shots.py`);
      }
      for (let i = 0; i < want; i += 1) {
        // A rendered shot one or two frames short of its slot holds its last
        // frame rather than failing the build; anything larger is a real
        // mismatch and is refused above for app shots.
        const index = Math.min(i, available - 1) + 1;
        place(join(directory, `${String(index).padStart(4, '0')}.png`), join(sequence, `${pad6(cursor++)}.png`));
      }
      if (available < want) console.warn(`  note: ${shot.id} held its last frame for ${want - available} frame(s)`);
    }

    placed.push({ shot: shot.id, kind: shot.kind, first_frame: startFrame, frames: cursor - startFrame });
    console.log(`  ${shot.id.padEnd(4)} ${shot.kind.padEnd(8)} frames ${startFrame}–${cursor - 1}`);
  }

  if (cursor !== TOTAL_FRAMES) {
    console.warn(`  note: sequence is ${cursor} frames against ${TOTAL_FRAMES} expected from duration`);
  }
  return { sequence, frames: cursor, placed };
}

// ---------------------------------------------------------------------------
// 4. subtitles
// ---------------------------------------------------------------------------

function srtTime(seconds) {
  const ms = Math.round(seconds * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  return `${h}:${m}:${s},${String(ms % 1000).padStart(3, '0')}`;
}

/** Two lines of at most ~42 characters each is what reads comfortably at 1080p. */
function wrap(text, limit = 42) {
  const words = text.split(/\s+/);
  const lines = [''];
  for (const word of words) {
    const line = lines[lines.length - 1];
    if (line.length === 0) lines[lines.length - 1] = word;
    else if (line.length + 1 + word.length <= limit) lines[lines.length - 1] = `${line} ${word}`;
    else lines.push(word);
  }
  return lines;
}

function buildSubtitles() {
  const cues = [];
  let index = 1;
  for (const cue of TIMELINE.narration) {
    const lines = wrap(cue.text);
    // Long lines become two subtitle events rather than a five-line block.
    const chunks = [];
    for (let i = 0; i < lines.length; i += 2) chunks.push(lines.slice(i, i + 2).join('\n'));
    const span = (cue.to - cue.from) / chunks.length;
    chunks.forEach((chunk, i) => {
      const from = cue.from + i * span;
      cues.push(`${index++}\n${srtTime(from)} --> ${srtTime(from + span)}\n${chunk}\n`);
    });
  }
  const target = join(OUT, `${BASENAME}.srt`);
  writeFileSync(target, `${cues.join('\n')}`, 'utf8');
  console.log(`  ${cues.length} subtitle cues → ${BASENAME}.srt`);
  return target;
}

// ---------------------------------------------------------------------------
// 5. encode
// ---------------------------------------------------------------------------

function encode(sequence, frames) {
  const target = join(OUT, `${BASENAME}.mp4`);
  const seconds = frames / fps;
  const fadeOutAt = Math.max(0, seconds - 0.9);

  const narration = join(AUDIO, 'narration.wav');
  const withAudio = !NO_AUDIO && existsSync(narration);
  if (!NO_AUDIO && !withAudio) {
    die('video/audio/narration.wav is missing. Run: node scripts/build-narration.mjs');
  }

  const args = [
    '-framerate', String(fps),
    '-i', join(sequence, '%06d.png'),
    ...(withAudio ? ['-i', narration] : []),
    '-vf', `fade=t=in:st=0:d=0.5,fade=t=out:st=${fadeOutAt.toFixed(2)}:d=0.9,format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', 'slow',
    '-crf', '18',
    '-profile:v', 'high',
    '-level', '4.1',
    '-r', String(fps),
    '-g', String(fps * 2),
    '-movflags', '+faststart',
  ];

  if (withAudio) {
    args.push(
      '-af', `afade=t=in:st=0:d=0.4,afade=t=out:st=${fadeOutAt.toFixed(2)}:d=0.9`,
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2',
      '-shortest',
    );
  }
  args.push(target);

  console.log(`· encoding ${frames} frames (${seconds.toFixed(2)}s)${withAudio ? ' with narration' : ' silent'}`);
  ffmpeg(args);
  return target;
}

// ---------------------------------------------------------------------------
// 6. poster and contact sheet
// ---------------------------------------------------------------------------

function buildPoster(sequence, frames) {
  // A frame from the middle of the five-step sequence: the product, mid-decision,
  // with a step label and the mode chip both in shot.
  const at = Math.min(frames - 1, Math.round(43 * fps));
  const target = join(OUT, 'CONTINUA_Demo_Poster_1024x576.png');
  ffmpeg(['-i', join(sequence, `${pad6(at)}.png`), '-vf', 'scale=1024:576:flags=lanczos', target]);
  console.log(`  poster from frame ${at} (t+${(at / fps).toFixed(1)}s)`);
  return target;
}

function buildContactSheet(sequence, frames) {
  // One frame from each of the ten shots, in order, so the sheet is a summary of
  // the edit rather than twelve near-identical frames from whatever ffmpeg's
  // thumbnail filter liked best.
  const picks = [...TIMELINE.shots]
    .sort((a, b) => a.video_from - b.video_from)
    .map((shot) => Math.min(frames - 1, Math.round(((shot.video_from + shot.video_to) / 2) * fps)));

  const staging = join(WORK, 'sheet');
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  picks.forEach((frame, index) => place(join(sequence, `${pad6(frame)}.png`), join(staging, `${pad5(index)}.png`)));

  const target = join(OUT, 'CONTINUA_Demo_Contact_Sheet.jpg');
  ffmpeg([
    '-framerate', '1',
    '-i', join(staging, '%05d.png'),
    '-vf', `scale=640:360,tile=2x5:margin=12:padding=8:color=0xF7FAFF`,
    '-frames:v', '1',
    '-q:v', '3',
    target,
  ]);
  console.log(`  contact sheet: one frame from each of ${picks.length} shots`);
  return target;
}

// ---------------------------------------------------------------------------

function main() {
  if (!existsSync(join(FRAMES, 'capture.json'))) {
    die('video/frames/capture.json is missing. Run: node scripts/capture-demo.mjs');
  }
  const capture = JSON.parse(readFileSync(join(FRAMES, 'capture.json'), 'utf8'));
  if (capture.test_mode) die('the capture on disk is a --test capture. Run a full capture before building.');

  mkdirSync(OUT, { recursive: true });
  mkdirSync(WORK, { recursive: true });

  console.log('\n· laying out the sequence');
  const { sequence, frames, placed } = buildSequence();

  console.log('\n· subtitles');
  const srt = buildSubtitles();

  console.log('');
  const mp4 = encode(sequence, frames);

  console.log('\n· stills');
  const poster = buildPoster(sequence, frames);
  const sheet = buildContactSheet(sequence, frames);

  // --- verify what we just made -------------------------------------------
  const probe = JSON.parse(
    ffprobe([
      '-v', 'error',
      '-show_entries', 'format=duration,size,format_name:stream=codec_name,codec_type,width,height,r_frame_rate,pix_fmt,channels,sample_rate',
      '-of', 'json',
      mp4,
    ]),
  );

  const manifest = {
    title: TIMELINE.video.title,
    team: TIMELINE.video.team,
    built_at: new Date().toISOString(),
    code_commit: (() => {
      try {
        return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
      } catch {
        return null;
      }
    })(),
    execution_mode: 'simulation',
    evidence: {
      claims: 'docs/VIDEO_CLAIMS.md',
      cards: 'apps/web/public/video/cards.json',
      representative_selection: 'video/representative.json',
      runs: [...new Set(TIMELINE.shots.filter((s) => s.run_id).map((s) => s.run_id))],
      run_metrics: 'data/evidence/video/<run_id>/metrics.json',
      experiments: JSON.parse(readFileSync(join(ROOT, 'apps/web/public/video/cards.json'), 'utf8')).generated_from
        .experiments,
    },
    capture: {
      viewport: capture.viewport,
      fps: capture.fps,
      captured_at: capture.captured_at,
      source: 'replay of recorded runs (mode chip reads REPLAY · SIMULATION)',
      renderer: 'Chromium via Playwright, --use-gl=angle',
    },
    narration: JSON.parse(readFileSync(join(AUDIO, 'narration.json'), 'utf8')),
    shots: placed,
    output: probe,
    build: [
      'python scripts/build_video_cards.py',
      'node scripts/run-blender.mjs scripts/blender/render_video_shots.py',
      'node scripts/capture-demo.mjs',
      'node scripts/build-narration.mjs',
      'node scripts/build-demo.mjs',
    ],
    attribution: {
      assets: 'All 3D geometry, materials, world and UI are original to this repository.',
      voice: 'Windows System.Speech, local synthesis. No cloned or imitated voice.',
      fonts: 'System UI stack. No licensed font is embedded.',
      music: 'none',
    },
  };
  writeFileSync(join(ROOT, 'video', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  const size = statSync(mp4).size;
  console.log('\n──────────────────────────────────────────────');
  console.log(`  ${BASENAME}.mp4   ${(size / 1e6).toFixed(1)} MB`);
  for (const stream of probe.streams) {
    if (stream.codec_type === 'video') {
      console.log(`  video  ${stream.codec_name} ${stream.width}x${stream.height} ${stream.r_frame_rate} ${stream.pix_fmt}`);
    } else if (stream.codec_type === 'audio') {
      console.log(`  audio  ${stream.codec_name} ${stream.sample_rate} Hz ${stream.channels} ch`);
    }
  }
  console.log(`  duration  ${Number(probe.format.duration).toFixed(2)} s`);
  console.log(`  ${[srt, poster, sheet].map((p) => p.replace(`${OUT}\\`, '').replace(`${OUT}/`, '')).join('\n  ')}`);
  console.log(`  manifest  video/manifest.json`);
  console.log('──────────────────────────────────────────────\n');
}

main();
