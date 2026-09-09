#!/usr/bin/env node
/**
 * Deterministic frame capture for the demo video.
 *
 * The whole point is that the video is not a screen recording. A screen
 * recording of a WebGL scene drops frames, stutters when the compositor is
 * busy, and produces a different file every time. Instead this walks the
 * timeline one frame at a time: set the clock, wait for the page to settle,
 * grab a PNG. 30 exact frames per second of finished video, reproducible on a
 * second machine, and slow enough that the GPU is never the limiting factor.
 *
 * Application footage is captured from a **replay** of a recorded run, not a
 * fresh simulation. Two reasons: replay seeks are a cursor move over the
 * events already on disk rather than a re-simulation, and the mode chip then
 * reads `REPLAY · SIMULATION`, which is the honest label for what the viewer
 * is looking at. The run id burned into the frame is the *source* run, so it
 * matches docs/VIDEO_CLAIMS.md.
 *
 *   node scripts/capture-demo.mjs               # everything
 *   node scripts/capture-demo.mjs --test         # 5 s probe, ~150 frames
 *   node scripts/capture-demo.mjs --shots S4,S5  # named shots only
 *
 * Requires the engine on :8000 and the web app on :3000. Frames land in
 * `video/frames/<shot>/` (git-ignored — they are large and regenerable).
 */

import { chromium } from '@playwright/test';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIMELINE = JSON.parse(readFileSync(join(ROOT, 'video/timeline.json'), 'utf8'));
const FRAMES = join(ROOT, 'video', 'frames');

const WEB = process.env.CONTINUA_WEB ?? 'http://127.0.0.1:3000';
const ENGINE = process.env.CONTINUA_ENGINE ?? 'http://127.0.0.1:8000';

const { width, height, fps } = TIMELINE.video;

const argv = process.argv.slice(2);
const TEST_MODE = argv.includes('--test');
const only = (() => {
  const index = argv.indexOf('--shots');
  return index === -1 ? null : new Set(argv[index + 1].split(',').map((id) => id.trim()));
})();

/** Frames per still card. A card is one screenshot held for its duration. */
const pad = (n) => String(n).padStart(5, '0');

// ---------------------------------------------------------------------------
// sim_keys: piecewise-linear map from video time to the run's own clock.
// ---------------------------------------------------------------------------

function simTimeAt(keys, videoT) {
  if (videoT <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i += 1) {
    const [t0, s0] = keys[i - 1];
    const [t1, s1] = keys[i];
    if (videoT <= t1) {
      const span = t1 - t0;
      return span <= 0 ? s1 : s0 + ((videoT - t0) / span) * (s1 - s0);
    }
  }
  return keys[keys.length - 1][1];
}

/** Playback rate at `videoT`, so the frame can say when it is slowed. */
function rateAt(keys, videoT) {
  for (let i = 1; i < keys.length; i += 1) {
    const [t0, s0] = keys[i - 1];
    const [t1, s1] = keys[i];
    if (videoT <= t1 || i === keys.length - 1) {
      const span = t1 - t0;
      return span <= 0 ? 1 : (s1 - s0) / span;
    }
  }
  return 1;
}

/** Overlays live on the finished timeline, so they are picked by video time. */
function overlaysAt(videoT, rate) {
  const active = TIMELINE.overlays
    .filter((overlay) => videoT >= overlay.from && videoT < overlay.to)
    .map((overlay) => ({ kind: overlay.kind, text: overlay.text, sub: overlay.sub }));
  if (active.length === 0) return [];
  return active.map((overlay, index) => (index === 0 ? { ...overlay, rate, videoT } : overlay));
}

// ---------------------------------------------------------------------------

async function engine(path, init) {
  const response = await fetch(`${ENGINE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path} → ${response.status} ${await response.text()}`);
  return response.json();
}

async function startReplay(sourceRunId) {
  const { run_id: replayId } = await engine(`/api/runs/${sourceRunId}/replay`, { method: 'POST' });
  // A replay begins playing; the capture drives the clock itself.
  await engine(`/api/runs/${replayId}/control`, { method: 'POST', body: JSON.stringify({ action: 'pause' }) });
  return replayId;
}

async function seek(replayId, t) {
  await engine(`/api/runs/${replayId}/control`, {
    method: 'POST',
    body: JSON.stringify({ action: 'seek', t: Number(t.toFixed(4)) }),
  });
}

// ---------------------------------------------------------------------------

async function captureCard(browser, shot) {
  const directory = join(FRAMES, shot.id);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });

  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const url = `${WEB}/capture/card/${shot.card}`;
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-capture-ready="true"]', { timeout: 20000 });
  // Web fonts settle a frame or two after the data arrives; a card with
  // fallback metrics would reflow visibly between shots.
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);

  // A card whose content is taller or wider than the frame ships as a cropped
  // table with the honest rows sliced off the bottom — the exact failure this
  // project cannot afford. Refuse rather than warn.
  const overflow = await page.evaluate(() => {
    const frame = document.querySelector('[data-card-frame]');
    if (!frame) return { missing: true };
    const clipped = [...frame.querySelectorAll('*')].filter((element) => {
      const box = element.getBoundingClientRect();
      return box.height > 0 && (box.bottom > 1080.5 || box.right > 1920.5 || box.top < -0.5);
    });
    return {
      missing: false,
      scrollHeight: frame.scrollHeight,
      clientHeight: frame.clientHeight,
      clipped: clipped.slice(0, 4).map((element) => {
        const box = element.getBoundingClientRect();
        return `${element.tagName.toLowerCase()} "${(element.textContent ?? '').trim().slice(0, 48)}" bottom=${box.bottom.toFixed(0)}`;
      }),
    };
  });

  if (overflow.missing) throw new Error(`${shot.id}: card frame not found at ${url}`);
  if (overflow.clipped.length > 0 || overflow.scrollHeight > overflow.clientHeight + 1) {
    throw new Error(
      `${shot.id}: card "${shot.card}" does not fit 1920x1080 ` +
        `(content ${overflow.scrollHeight}px in ${overflow.clientHeight}px).\n` +
        overflow.clipped.map((line) => `    clipped: ${line}`).join('\n'),
    );
  }

  const target = join(directory, 'still.png');
  await page.screenshot({ path: target, animations: 'disabled' });
  await page.close();

  const frames = Math.round((shot.video_to - shot.video_from) * fps);
  console.log(`  ${shot.id}  card ${shot.card}  1 still → ${frames} frames`);
  return { shot: shot.id, kind: 'card', still: `video/frames/${shot.id}/still.png`, frames, url };
}

/**
 * The two title plates that sit over the Blender shots, captured with a
 * transparent background so FFmpeg can fade them in over the rendered frames.
 * Same component and tokens as the in-app overlays — see TitleFrame.tsx.
 */
async function captureTitle(browser, overlay) {
  const directory = join(FRAMES, `title-${overlay.shot}`);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });

  const query = new URLSearchParams({ text: overlay.text, place: overlay.place ?? 'centre' });
  if (overlay.sub) query.set('sub', overlay.sub);
  const url = `${WEB}/capture/title?${query}`;

  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-capture-ready="true"]', { timeout: 20000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);

  const target = join(directory, 'plate.png');
  await page.screenshot({ path: target, omitBackground: true, animations: 'disabled' });
  await page.close();

  console.log(`  title-${overlay.shot}  "${overlay.text}"  → plate.png`);
  return {
    shot: `title-${overlay.shot}`,
    kind: 'title',
    over_shot: overlay.shot,
    plate: `video/frames/title-${overlay.shot}/plate.png`,
    from: overlay.from,
    to: overlay.to,
    frames: 1,
    url,
  };
}

async function captureApp(browser, shot) {
  const directory = join(FRAMES, shot.id);
  rmSync(directory, { recursive: true, force: true });
  mkdirSync(directory, { recursive: true });

  const replayId = await startReplay(shot.run_id);

  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(String(error)));

  const url = `${WEB}/capture?run=${replayId}&fullbleed=1`;
  await page.goto(url, { waitUntil: 'networkidle' });

  // Prime the socket at the start of the window before recording anything, so
  // the first captured frame already has history behind it rather than a
  // half-drawn chart.
  await seek(replayId, simTimeAt(shot.sim_keys, shot.video_from));
  await page.waitForSelector('[data-capture-ready="true"]', { timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);

  const total = TEST_MODE
    ? Math.min(Math.round(5 * fps), Math.round((shot.video_to - shot.video_from) * fps))
    : Math.round((shot.video_to - shot.video_from) * fps);

  const started = Date.now();
  for (let frame = 0; frame < total; frame += 1) {
    const videoT = shot.video_from + frame / fps;
    const simT = simTimeAt(shot.sim_keys, videoT);
    const rate = rateAt(shot.sim_keys, videoT);

    await seek(replayId, simT);
    await page.evaluate((payload) => window.__CONTINUA_OVERLAY__?.(payload), overlaysAt(videoT, rate));
    // One rAF for React to commit the seek, a second for three.js to draw it.
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
    );

    await page.screenshot({ path: join(directory, `${pad(frame)}.png`), animations: 'disabled' });

    if (frame % 60 === 0 || frame === total - 1) {
      const elapsed = (Date.now() - started) / 1000;
      const rate2 = frame ? (frame / elapsed).toFixed(1) : '—';
      process.stdout.write(`\r  ${shot.id}  ${frame + 1}/${total} frames  (${rate2}/s)   `);
    }
  }
  process.stdout.write('\n');

  await page.close();
  await engine(`/api/runs/${replayId}/control`, { method: 'POST', body: JSON.stringify({ action: 'stop' }) }).catch(
    () => {},
  );

  if (errors.length) {
    console.warn(`  ${shot.id}: ${errors.length} console error(s) during capture`);
    for (const message of errors.slice(0, 5)) console.warn(`    ${message}`);
  }

  return {
    shot: shot.id,
    kind: 'app',
    source_run_id: shot.run_id,
    replay_run_id: replayId,
    frames: total,
    sim_from: simTimeAt(shot.sim_keys, shot.video_from),
    sim_to: simTimeAt(shot.sim_keys, shot.video_to),
    console_errors: errors.length,
    url,
  };
}

// ---------------------------------------------------------------------------

async function main() {
  for (const [label, url] of [
    ['engine', `${ENGINE}/api/health`],
    ['web', WEB],
  ]) {
    const response = await fetch(url).catch(() => null);
    if (!response?.ok) {
      console.error(`${label} is not responding at ${url}. Start it before capturing.`);
      process.exit(1);
    }
  }

  const shots = TIMELINE.shots
    .filter((shot) => shot.kind !== 'blender')
    .filter((shot) => !only || only.has(shot.id));

  if (TEST_MODE) {
    console.log('test capture: 5 s of the first application shot only.\n');
  }

  mkdirSync(FRAMES, { recursive: true });
  const browser = await chromium.launch({
    args: [
      // Software WebGL would be both slow and visually different from what the
      // scene looks like on a real machine.
      '--use-gl=angle',
      '--enable-gpu-rasterization',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--disable-lcd-text',
    ],
  });

  const manifest = [];
  const started = Date.now();
  try {
    for (const shot of shots) {
      if (shot.kind === 'card') {
        manifest.push(await captureCard(browser, shot));
      } else if (shot.kind === 'app') {
        manifest.push(await captureApp(browser, shot));
        if (TEST_MODE) break;
      }
    }

    if (!TEST_MODE) {
      const titles = TIMELINE.overlays.filter((overlay) => overlay.kind === 'title' && overlay.shot);
      for (const overlay of titles) {
        if (only && !only.has(overlay.shot)) continue;
        manifest.push(await captureTitle(browser, overlay));
      }
    }
  } finally {
    await browser.close();
  }

  const target = join(FRAMES, TEST_MODE ? 'capture-test.json' : 'capture.json');

  // A `--shots` run re-captures part of the video, so it must *merge* into the
  // existing record rather than replace it. Overwriting left the manifest
  // claiming the whole video was two title plates — exactly the kind of quiet
  // inaccuracy a build manifest exists to prevent.
  let recorded = manifest;
  if (only && existsSync(target)) {
    const previous = JSON.parse(readFileSync(target, 'utf8'));
    const replaced = new Set(manifest.map((entry) => entry.shot));
    recorded = [...(previous.shots ?? []).filter((entry) => !replaced.has(entry.shot)), ...manifest];
  }

  const record = {
    captured_at: new Date().toISOString(),
    test_mode: TEST_MODE,
    partial: only ? [...only] : null,
    viewport: { width, height, device_scale_factor: 1 },
    fps,
    web: WEB,
    engine: ENGINE,
    shots: recorded,
    elapsed_s: Number(((Date.now() - started) / 1000).toFixed(1)),
  };
  writeFileSync(target, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  const totalFrames = manifest.reduce((sum, entry) => sum + entry.frames, 0);
  console.log(`\ncaptured ${manifest.length} shot(s), ${totalFrames} frames in ${record.elapsed_s}s`);
  if (only) console.log(`merged into a manifest of ${record.shots.length} shot(s)`);
  console.log(`manifest: ${target.replace(ROOT, '.')}`);
  if (!existsSync(join(ROOT, 'video/renders/intro'))) {
    console.log('\nstill to render: video/renders/intro and video/renders/outro (npm run video:renders)');
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
