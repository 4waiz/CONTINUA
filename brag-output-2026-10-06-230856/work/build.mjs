// Build the two HyperFrames compositions from what the capture saw and what the voice measured.
//
//   node build.mjs footage      encode the captured frames: aerial.mp4, walk.mp4
//   node build.mjs intro        composition/index.html - the 30-second intro
//   node build.mjs walkthrough  walkthrough/index.html - the two-minute recording, voiced
//
// Every time in the edit comes from a file: the footage windows from the
// capture's marks (when the app showed a change of network, the road map's
// banner, the wheel), the voice's starts from its measured lengths. Nothing is
// typed in twice.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const what = process.argv[2] ?? 'intro';
const read = (file) => JSON.parse(readFileSync(path.join(HERE, file), 'utf8'));
const r2 = (x) => Math.round(x * 100) / 100;
const r3 = (x) => Math.round(x * 1000) / 1000;

function encode(frames, out) {
  mkdirSync(path.dirname(out), { recursive: true });
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-framerate', '30', '-i', path.join(frames, '%05d.jpg'),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ]);
  console.log('encoded', path.relative(ROOT, out));
}

/** A media file's length in seconds, as ffprobe reads it. */
function mediaSeconds(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file]);
  return Number(String(out).trim());
}

/** Put one file in two compositions without copying 200 MB: a hard link, or a copy where links fail. */
function place(from, to) {
  mkdirSync(path.dirname(to), { recursive: true });
  rmSync(to, { force: true });
  try {
    linkSync(from, to);
  } catch {
    copyFileSync(from, to);
  }
}

/** A music bed's volume lane: up at `base`, down to `duck` under every line, out at the end. */
function duckLane(lines, total, { base, duck, fadeIn = 0.4, fadeOut = 1.5 }) {
  const windows = [];
  for (const line of lines) {
    const a = line.start - 0.14;
    const b = line.end + 0.18;
    const last = windows[windows.length - 1];
    if (last && a - last[1] < 0.6) last[1] = b;
    else windows.push([a, b]);
  }
  const points = [{ t: 0, v: 0 }, { t: fadeIn, v: base }];
  for (const [a, b] of windows) {
    points.push({ t: r3(Math.max(fadeIn, a)), v: base }, { t: r3(Math.max(fadeIn, a) + 0.22), v: duck });
    points.push({ t: r3(b), v: duck }, { t: r3(b + 0.35), v: base });
  }
  const tail = total - fadeOut;
  const level = points.filter((p) => p.t <= tail).at(-1)?.v ?? base;
  const kept = points.filter((p) => p.t < tail);
  kept.push({ t: r3(tail), v: level }, { t: r3(total), v: 0 });
  return JSON.stringify({ version: 1, lanes: [{ target: 'volume', points: kept }] }).replace(/"/g, '&quot;');
}

/**
 * When the narrator says each of W, A, S, D in a line, from Whisper's word
 * timestamps (word_times.py → intro-words.json), so each key cap lights on its
 * letter. Falls back to `fallback` if the file or a letter is missing.
 */
function keyTimes(line, fallback) {
  const file = path.join(HERE, 'intro-words.json');
  if (!existsSync(file)) return fallback;
  const heard = JSON.parse(readFileSync(file, 'utf8'))[line.id] ?? [];
  const found = [];
  for (const word of heard) {
    const token = word.word.replace(/[^A-Za-z]/g, '').toUpperCase();
    const want = 'WASD'.slice(found.length);
    if (token.length === 1 && want.startsWith(token)) {
      found.push(line.start + word.start);
    } else if (token.length > 1 && want.startsWith(token)) {
      // Letters run together as one token: share its span out evenly.
      const step = (word.end - word.start) / token.length;
      for (let i = 0; i < token.length; i += 1) found.push(line.start + word.start + i * step);
    }
    if (found.length === 4) break;
  }
  if (found.length !== 4) return fallback;
  return fallback.map((key, i) => ({ k: key.k, t: r2(found[i]) }));
}

function vtt(lines, file, total = Infinity) {
  const stamp = (t) => {
    const m = Math.floor(t / 60);
    const s = t - m * 60;
    return `00:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
  };
  let out = 'WEBVTT\n\n';
  lines.forEach((line, i) => {
    const next = lines[i + 1]?.start ?? Math.min(line.end + 2, total);
    out += `${i + 1}\n${stamp(line.start)} --> ${stamp(Math.min(next - 0.05, line.end + 0.4))}\n${line.text}\n\n`;
  });
  writeFileSync(file, out);
  console.log('captions', path.relative(ROOT, file));
}

function srt(lines, file, total = Infinity) {
  const stamp = (t) => {
    const h = Math.floor(t / 3600);
    const m = Math.floor((t % 3600) / 60);
    const s = t - h * 3600 - m * 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0').replace('.', ',')}`;
  };
  let out = '';
  lines.forEach((line, i) => {
    const next = lines[i + 1]?.start ?? Math.min(line.end + 2, total);
    out += `${i + 1}\n${stamp(line.start)} --> ${stamp(Math.min(next - 0.05, line.end + 0.4))}\n${line.text}\n\n`;
  });
  writeFileSync(file, out);
  console.log('captions', path.relative(ROOT, file));
}

const STYLE = `
  :root {
    --bg: #f6f9ff; --ink: #111d3a; --muted: #5d6b87; --faint: #8995ab;
    --line: rgb(90 110 160 / 0.14); --blue: #176bff; --cyan: #14b8e8; --violet: #7a3cff;
    --good: #0db982; --bad: #e5484d;
    --grad: linear-gradient(96deg, #14b8e8 0%, #176bff 42%, #5156e8 68%, #7a3cff 100%);
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 1920px; height: 1080px; overflow: hidden; background: var(--bg); }
  #root { position: relative; width: 100%; height: 100%; overflow: hidden; background: var(--bg);
    color: var(--ink); font-family: Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
  .foot { position: absolute; inset: 0; transform-origin: 50% 50%; }
  .foot video { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; }
  .layer { position: absolute; inset: 0; }
  .glass { background: rgb(255 255 255 / 0.93); border: 1px solid rgb(255 255 255 / 0.9); border-radius: 22px;
    box-shadow: 0 0 0 1px rgb(17 29 58 / 0.06), 0 2px 4px rgb(17 29 58 / 0.05), 0 24px 48px -22px rgb(17 29 58 / 0.42); }
  .kicker { font-size: 18px; font-weight: 700; letter-spacing: 0.11em; text-transform: uppercase; color: #1460e6; }
  .brand { background: var(--grad); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .ring { position: absolute; border-radius: 18px; border: 3px solid var(--blue); opacity: 0;
    box-shadow: 0 0 0 6px rgb(23 107 255 / 0.14), 0 0 26px rgb(23 107 255 / 0.4); }
  .ring.red { border-color: var(--bad); box-shadow: 0 0 0 6px rgb(229 72 77 / 0.14), 0 0 26px rgb(229 72 77 / 0.45); }
  .ring.violet { border-color: var(--violet); box-shadow: 0 0 0 6px rgb(122 60 255 / 0.14), 0 0 26px rgb(122 60 255 / 0.45); }
  .key { display: grid; place-items: center; width: 64px; height: 64px; border-radius: 16px; background: rgb(255 255 255 / 0.95);
    border: 1px solid rgb(17 29 58 / 0.12); border-bottom-width: 4px; font: 760 26px/1 ui-monospace, monospace; color: var(--ink);
    box-shadow: 0 10px 22px -12px rgb(17 29 58 / 0.5); }
  .key.wide { width: auto; padding: 0 16px; font-size: 20px; }
`;

function intro() {
  const cap = read('walkthrough-capture.json').marks;
  const vo = read('intro-timings.json').lines;
  const audio = read('audio-data.json');
  const at = Object.fromEntries(vo.map((line) => [line.id, line]));
  const TOTAL = 29.4;
  // Footage windows, from the walkthrough capture's own marks.
  const flightFrom = r3(cap.wifi - 0.3);
  const warnFrom = r3(cap.warning - 0.25);
  const satFrom = r3(cap.satellite - 0.35);
  const wheelFrom = r3(cap.wheel + 0.25);
  // The bed's energy, for the halo behind the proof and the wordmark: overall
  // level and the lowest band, two decimals, one value a frame.
  const rms = audio.frames.slice(0, Math.ceil(TOTAL * 30) + 1).map((f) => Math.round(f.rms * 100) / 100);
  const bass = audio.frames.slice(0, Math.ceil(TOTAL * 30) + 1).map((f) => Math.round(f.bands[0] * 100) / 100);
  const lane = duckLane(vo, TOTAL, { base: 0.3, duck: 0.13, fadeOut: 1.4 });
  const keys = keyTimes(at.i4, [
    { k: 'W', t: 20.1 },
    { k: 'A', t: 20.45 },
    { k: 'S', t: 20.8 },
    { k: 'D', t: 21.15 },
  ]);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<title>CONTINUA - the intro</title>
<script src="assets/vendor/gsap.min.js"></script>
<style>${STYLE}
  #scrim { background: linear-gradient(90deg, rgb(246 249 255 / 0.94) 0%, rgb(246 249 255 / 0.86) 34%, rgb(246 249 255 / 0.55) 52%, rgb(246 249 255 / 0) 72%); }
  #hook { position: absolute; left: 150px; top: 318px; width: 1150px; }
  #hook .kicker { font-size: 20px; }
  #hook h1 { margin-top: 22px; font-size: 104px; line-height: 1.02; font-weight: 750; letter-spacing: -0.035em; }
  #hook h1 span { display: block; padding-bottom: 10px; }
  .card { position: absolute; left: 50%; bottom: 74px; width: 860px; margin-left: -430px; padding: 22px 30px 22px 30px; }
  .card .title { margin-top: 8px; font-size: 38px; line-height: 1.18; font-weight: 700; letter-spacing: -0.02em; }
  .card .fine { margin-top: 10px; font-size: 17px; color: var(--muted); }
  .status { position: absolute; left: 50%; bottom: 74px; width: 860px; margin-left: -430px; padding: 22px 30px; }
  .status .row { display: flex; align-items: center; gap: 16px; font-size: 34px; line-height: 1.25; font-weight: 700; letter-spacing: -0.015em; }
  .status .row + .row { margin-top: 10px; }
  .status .row i { width: 16px; height: 16px; border-radius: 50%; flex-shrink: 0; }
  .status .row.good i { background: var(--good); box-shadow: 0 0 0 6px rgb(13 185 130 / 0.18); }
  .status .row.bad i { background: var(--bad); box-shadow: 0 0 0 6px rgb(229 72 77 / 0.18); }
  .status .row small { font-size: 26px; font-weight: 600; color: var(--muted); }
  #keys { position: absolute; right: 150px; bottom: 150px; display: flex; flex-direction: column; align-items: center; gap: 18px; }
  #keys .label { font-size: 30px; font-weight: 700; letter-spacing: -0.015em; padding: 12px 26px; }
  #keys .row { display: flex; gap: 14px; }
  #blur { filter: blur(16px); }
  #tint { background: rgb(246 249 255 / 0.8); }
  #halo { position: absolute; left: 50%; top: 50%; width: 1500px; height: 760px; margin: -380px 0 0 -750px; border-radius: 50%;
    background: radial-gradient(closest-side, rgb(23 107 255 / 0.20), rgb(122 60 255 / 0.10) 55%, rgb(122 60 255 / 0) 100%); }
  #proof, #outro { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; }
  #proof .big { margin-top: 26px; font-size: 128px; line-height: 1.04; font-weight: 760; letter-spacing: -0.04em; }
  #proof .big span { display: inline-block; padding-bottom: 10px; }
  #proof .sub { margin-top: 22px; font-size: 46px; line-height: 1.2; font-weight: 650; letter-spacing: -0.02em; }
  #proof .sub b { color: var(--bad); }
  #proof .fine { position: absolute; left: 0; right: 0; bottom: 70px; font-size: 20px; color: var(--muted); }
  #outro img { width: 600px; height: auto; }
  #outro .tag { margin-top: 42px; font-size: 64px; line-height: 1.1; font-weight: 750; letter-spacing: -0.03em; }
  #outro .tag span { display: inline-block; padding-bottom: 6px; }
  #outro .by { margin-top: 18px; font-size: 28px; font-weight: 650; color: var(--muted); }
  #outro .url { margin-top: 38px; display: inline-flex; align-items: center; height: 60px; padding: 0 30px; border-radius: 999px;
    font-size: 26px; font-weight: 700; color: #fff; background: var(--grad); box-shadow: 0 16px 34px -16px rgb(23 107 255 / 0.65); }
  #outro .fine { position: absolute; left: 0; right: 0; bottom: 64px; font-size: 20px; color: var(--muted); }
  #veil { background: var(--bg); opacity: 0; pointer-events: none; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${TOTAL}" data-width="1920" data-height="1080">

  <!-- Footage: the real app, captured frame by frame from the public build. -->
  <div class="foot" id="w-aerial"><video id="v-aerial" class="clip" src="assets/footage/aerial.mp4" data-start="0" data-duration="3.6" data-media-start="0.3" data-track-index="0" muted playsinline></video></div>
  <div class="foot" id="w-flight"><video id="v-flight" class="clip" src="assets/footage/walk.mp4" data-start="3.6" data-duration="6.8" data-media-start="${flightFrom}" data-track-index="0" muted playsinline></video></div>
  <div class="foot" id="w-warn"><video id="v-warn" class="clip" src="assets/footage/walk.mp4" data-start="10.4" data-duration="2.9" data-media-start="${warnFrom}" data-track-index="0" muted playsinline></video></div>
  <div class="foot" id="w-sat"><video id="v-sat" class="clip" src="assets/footage/walk.mp4" data-start="13.3" data-duration="4.6" data-media-start="${satFrom}" data-track-index="0" muted playsinline></video></div>
  <div class="foot" id="w-drive"><video id="v-drive" class="clip" src="assets/footage/walk.mp4" data-start="17.9" data-duration="4.0" data-media-start="${wheelFrom}" data-track-index="0" muted playsinline></video></div>
  <div class="foot" id="blur"><video id="v-end" class="clip" src="assets/footage/aerial.mp4" data-start="21.9" data-duration="7.5" data-media-start="1.2" data-track-index="0" muted playsinline></video></div>

  <!-- 1. Hook -->
  <div class="layer clip" id="s1" data-start="0" data-duration="3.6" data-track-index="1">
    <div class="layer" id="scrim"></div>
    <div id="hook">
      <div class="kicker" id="h-k">CONTINUA · Predictive Network Continuity</div>
      <h1><span id="h-l1">The network changes.</span><span id="h-l2" class="brand">The session doesn't.</span></h1>
    </div>
  </div>

  <!-- 2. The flight -->
  <div class="layer clip" id="s2" data-start="3.6" data-duration="6.8" data-track-index="1">
    <div class="card glass" id="c2">
      <div class="kicker">Every handoff, shown</div>
      <div class="title">From Wi-Fi access point A, down the beam, to the rover</div>
      <div class="fine">The app's own camera · a recorded run · software simulation</div>
    </div>
  </div>

  <!-- 3. Dead zone: the app's own banner, then the two status cards -->
  <div class="layer clip" id="s3a" data-start="10.4" data-duration="2.9" data-track-index="1">
    <div class="ring violet" id="r-banner" style="left:718px;top:146px;width:484px;height:70px"></div>
  </div>
  <div class="layer clip" id="s3b" data-start="13.3" data-duration="4.6" data-track-index="1">
    <div class="ring violet" id="r-ours" style="left:686px;top:70px;width:258px;height:76px"></div>
    <div class="ring red" id="r-theirs" style="left:954px;top:70px;width:258px;height:76px"></div>
    <div class="status glass" id="c3">
      <div class="row good" id="c3a"><i></i><span>CONTINUA <small>· on satellite, still connected</small></span></div>
      <div class="row bad" id="c3b"><i></i><span>Normal rover <small>· cut off, has to stop</small></span></div>
    </div>
  </div>

  <!-- 4. Take the wheel -->
  <div class="layer clip" id="s4" data-start="17.9" data-duration="4.0" data-track-index="1">
    <div id="keys">
      <div class="label glass" id="k-label">Take the wheel</div>
      <div class="row">${keys.map((key) => `<div class="key" id="key-${key.k}">${key.k}</div>`).join('')}</div>
    </div>
  </div>

  <!-- 5-6. The proof and the wordmark, over the island blurred -->
  <div class="layer clip" id="s5" data-start="21.9" data-duration="7.5" data-track-index="1">
    <div class="layer" id="tint"></div>
    <div id="halo"></div>
  </div>
  <div class="layer clip" id="proof" data-start="21.9" data-duration="4.3" data-track-index="2">
    <div class="kicker" id="p-k">The shadowed road · twenty drives for every strategy</div>
    <div class="big"><span class="brand" id="p-b1">20 of 20 drives.</span> <span id="p-b2">Link kept.</span></div>
    <div class="sub" id="p-s">The normal rover: <b>0 of 20.</b></div>
    <div class="fine" id="p-f">Experiment phase5-test4-shadow-survey · 20 paired drives, same road and signal for each · software simulation</div>
  </div>
  <div class="layer clip" id="outro" data-start="26.2" data-duration="3.2" data-track-index="2">
    <img id="o-logo" src="assets/continua-logo.png" alt="CONTINUA" />
    <div class="tag" id="o-tag"><span>The network changes.</span> <span class="brand">The session doesn't.</span></div>
    <div class="by" id="o-by">Predictive Network Continuity · by Team Kanban</div>
    <div class="url" id="o-url">continua.kanbanstudios.ae</div>
    <div class="fine" id="o-fine">A software simulation. Every figure comes from recorded runs.</div>
  </div>

  <div class="layer" id="veil"></div>

  <!-- The narrator: Kokoro am_michael via hyperframes tts, one clip a line. -->
${vo.map((line, i) => `  <audio id="vo-${line.id}" src="assets/vo/${line.id}.wav" data-start="${line.start}" data-duration="${r3(line.end - line.start)}" data-track-index="${20 + i}" data-volume="1"></audio>`).join('\n')}
  <!-- The bed, ducked under every line. -->
  <audio id="music" src="assets/music/happy-beats-business-moves-vol-12-by-ende-dot-app.mp3" data-start="0" data-duration="${TOTAL}" data-track-index="10" data-volume="1" data-automation="${lane}"></audio>
  <!-- Sparse accents: the title, the keys, the proof (beat-locked), the wordmark. -->
  <audio id="sfx-title" src="assets/sfx/interface/drop_002.ogg" data-start="1.6" data-duration="0.19" data-track-index="11" data-volume="0.4"></audio>
${keys.map((key, i) => `  <audio id="sfx-key-${key.k}" src="assets/sfx/ui/click3.ogg" data-start="${r2(key.t - 0.02)}" data-duration="0.09" data-track-index="${12 + i}" data-volume="0.34"></audio>`).join('\n')}
  <audio id="sfx-proof" src="assets/sfx/impact/impactSoft_medium_001.ogg" data-start="22.33" data-duration="0.18" data-track-index="16" data-volume="0.62"></audio>
  <audio id="sfx-logo" src="assets/sfx/impact/impactBell_heavy_003.ogg" data-start="26.42" data-duration="0.65" data-track-index="17" data-volume="0.4"></audio>
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  const rise = (sel, at, dist = 28, dur = 0.55, blur = 0) =>
    tl.fromTo(sel, { opacity: 0, y: dist, filter: \`blur(\${blur}px)\` }, { opacity: 1, y: 0, filter: 'blur(0px)', duration: dur, ease: 'expo.out' }, at);
  const fall = (sel, at, dur = 0.3) => tl.to(sel, { opacity: 0, duration: dur, ease: 'power2.in' }, at);
  const dip = (at, up = 0.26, down = 0.3) =>
    tl.fromTo('#veil', { opacity: 0 }, { opacity: 1, duration: up, ease: 'power2.in', immediateRender: false }, at - up)
      .to('#veil', { opacity: 0, duration: down, ease: 'power2.out' }, at);

  // 1. Hook: the island drifts; the title lands with the voice.
  tl.fromTo('#w-aerial', { scale: 1 }, { scale: 1.07, duration: 3.6, ease: 'none' }, 0);
  rise('#h-k', 0.22, 16, 0.6);
  rise('#h-l1', 0.32, 34, 0.7, 8);
  rise('#h-l2', 1.62, 34, 0.7, 8);
  fall('#hook', 3.22, 0.32);
  dip(3.6);

  // 2. The flight: a slow push while the camera flies.
  tl.fromTo('#w-flight', { scale: 1 }, { scale: 1.025, duration: 6.8, ease: 'none' }, 3.6);
  rise('#c2', 4.15, 36, 0.6);
  fall('#c2', 9.95, 0.32);

  // 3. The road map's banner ringed, then both status cards, then the outcome.
  tl.fromTo('#r-banner', { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'power3.out' }, 10.75);
  fall('#r-banner', 12.95, 0.3);
  tl.fromTo('#r-ours', { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'power3.out' }, 13.65);
  tl.fromTo('#r-theirs', { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.4, ease: 'power3.out' }, 14.35);
  rise('#c3', 14.0, 36, 0.55);
  rise('#c3a', 14.15, 14, 0.5);
  rise('#c3b', 14.75, 14, 0.5);
  fall(['#r-ours', '#r-theirs', '#c3'], 17.55, 0.3);

  // 4. The wheel: each key lights as it is said.
  rise('#k-label', 18.3, 24, 0.55);
  ${keys
    .map(
      (key) =>
        `tl.fromTo('#key-${key.k}', { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.45, ease: 'expo.out' }, ${r2(18.45 + 'WASD'.indexOf(key.k) * 0.07)});
  tl.to('#key-${key.k}', { keyframes: [{ scale: 1.16, backgroundColor: '#176bff', color: '#ffffff', duration: 0.12 }, { scale: 1, duration: 0.3 }], ease: 'power2.out' }, ${key.t});`,
    )
    .join('\n  ')}
  dip(21.9, 0.28, 0.32);

  // 5. The proof - the number lands on the bed's strong beat. // beat-locked: 22.37s
  rise('#p-k', 22.05, 16, 0.5);
  rise('#p-b1', 22.37, 34, 0.6, 8);
  rise('#p-b2', 22.62, 34, 0.6, 8);
  rise('#p-s', 23.25, 24, 0.55);
  rise('#p-f', 23.6, 12, 0.5);
  fall('#proof', 25.9, 0.3);
  tl.fromTo('#blur', { scale: 1.12 }, { scale: 1.2, duration: 7.5, ease: 'none' }, 21.9);

  // 6. The wordmark.
  tl.fromTo('#o-logo', { opacity: 0, scale: 0.96 }, { opacity: 1, scale: 1, duration: 0.6, ease: 'expo.out' }, 26.45);
  rise('#o-tag', 26.8, 26, 0.6);
  rise('#o-by', 27.2, 18, 0.5);
  rise('#o-url', 27.5, 18, 0.5);
  rise('#o-fine', 27.8, 10, 0.5);

  // The halo behind the proof and the wordmark breathes with the bed: its
  // level and its lowest band, pre-extracted, one sample a frame.
  const RMS = [${rms.join(',')}];
  const BASS = [${bass.join(',')}];
  const halo = document.getElementById('halo');
  for (let f = Math.floor(21.9 * 30); f < RMS.length; f += 1) {
    tl.call(() => {
      halo.style.opacity = String(0.45 + 0.45 * Math.min(1, RMS[f]));
      halo.style.transform = 'scale(' + (1 + 0.06 * BASS[f]).toFixed(3) + ')';
    }, [], f / 30);
  }

  window.__timelines['main'] = tl;
</script>
</body>
</html>
`;
  const out = path.join(ROOT, 'composition', 'index.html');
  writeFileSync(out, html);
  vtt(vo, path.join(ROOT, 'composition', 'intro.vtt'), TOTAL);
  console.log('wrote', path.relative(ROOT, out), { flightFrom, warnFrom, satFrom, wheelFrom });
}

function walkthrough() {
  const capture = read('walkthrough-capture.json');
  const cap = capture.marks;
  const voice = read('walkthrough-timings.json').lines;
  const TOTAL = r2(cap.end + 0.4);
  // Each line on the moment it speaks to, never before the one ahead of it has ended.
  const anchor = {
    w01: 0.6,
    w02: cap.drive + 0.3,
    w03: cap.wifi - 0.4,
    w04: cap.slow + 0.2,
    w05: cap.warning + 0.3,
    w06: cap.satellite + 1.3,
    w07: cap.wheel + 0.2,
    w08: null,
    w09: cap.autopilot + 0.3,
    w10: cap.results + 0.3,
    w11: cap.decisions + 0.3,
    w12: cap.brief + 0.3,
    w13: cap.credits + 0.3,
  };
  const lines = [];
  let free = 0;
  for (const line of voice) {
    const wanted = anchor[line.id] ?? free + 0.5;
    const start = r3(Math.max(wanted, free + 0.35));
    lines.push({ ...line, start, end: r3(start + line.seconds) });
    free = start + line.seconds;
    console.log(`${line.id} ${start.toFixed(2)}-${(start + line.seconds).toFixed(2)}  (wanted ${wanted.toFixed(2)})  ${line.text.slice(0, 50)}`);
  }
  if (free > TOTAL - 0.3) throw new Error(`the voice runs to ${free.toFixed(2)} s, past the recording's ${TOTAL} s`);
  // Keys pressed while driving, from the capture's marks.
  const keyFlashes = [
    { k: 'W', from: cap.driving, to: cap['steer-left'] },
    { k: 'A', from: cap['steer-left'], to: cap['steer-right'] },
    { k: 'D', from: cap['steer-right'], to: cap['drive-on'] },
    { k: 'W', from: cap['drive-on'], to: cap.reverse },
    { k: 'S', from: cap.reverse, to: cap.reverse + 3.6 },
    { k: 'Esc', from: cap.autopilot, to: cap.autopilot + 0.7 },
  ];
  const clicks = [cap.drive, cap['coverage-on'] - 0.13, cap.overview - 0.13, cap.follow - 0.13, cap['coverage-off'] - 0.13, cap.details - 0.13];
  // The bed is a little shorter than the recording: it fades out under the last
  // line and ends with its own last note, not cut off mid-bar.
  const bedFile = path.join(ROOT, 'walkthrough', 'assets', 'music', 'happy-beats-business-moves-vol-9-by-ende-dot-app.mp3');
  const BED = r2(Math.min(TOTAL, mediaSeconds(bedFile) - 0.04));
  const lane = duckLane(lines, BED, { base: 0.17, duck: 0.075, fadeIn: 1.0, fadeOut: 2.2 });
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=1920, height=1080" />
<title>CONTINUA - the walkthrough</title>
<script src="assets/vendor/gsap.min.js"></script>
<style>${STYLE}
  #keys { position: absolute; right: 36px; top: 600px; display: grid; grid-template-columns: repeat(3, 64px); gap: 10px; justify-items: center; padding: 18px; }
  #keys .key { opacity: 0.5; transition: none; }
  #keys .label { grid-column: 1 / -1; font-size: 15px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #1460e6; }
  #keys #key-W { grid-column: 2; }
  #keys #key-Esc { grid-column: 1 / -1; }
</style>
</head>
<body>
<div id="root" data-composition-id="main" data-start="0" data-duration="${TOTAL}" data-width="1920" data-height="1080">
  <div class="foot" id="w-walk"><video id="v-walk" class="clip" src="assets/footage/walk.mp4" data-start="0" data-duration="${r2(capture.seconds)}" data-track-index="0" muted playsinline></video></div>

  <!-- The keys that drive, shown while they are held. -->
  <div class="layer clip" id="keys-clip" data-start="${r2(cap.wheel - 0.4)}" data-duration="${r2(cap.autopilot + 1.6 - cap.wheel + 0.4)}" data-track-index="1">
    <div id="keys" class="glass">
      <div class="label">Keyboard</div>
      <div class="key" id="key-W">W</div>
      <div class="key" id="key-A">A</div>
      <div class="key" id="key-S">S</div>
      <div class="key" id="key-D">D</div>
      <div class="key wide" id="key-Esc">Esc · autopilot</div>
    </div>
  </div>

  <!-- The narrator: Kokoro am_michael via hyperframes tts, each line on the moment it speaks to. -->
${lines.map((line, i) => `  <audio id="vo-${line.id}" src="assets/vo/${line.id}.wav" data-start="${line.start}" data-duration="${r3(line.seconds)}" data-track-index="${20 + i}" data-volume="1"></audio>`).join('\n')}
  <audio id="music" src="assets/music/happy-beats-business-moves-vol-9-by-ende-dot-app.mp3" data-start="0" data-duration="${BED}" data-track-index="10" data-volume="1" data-automation="${lane}"></audio>
${clicks.map((t, i) => `  <audio id="click-${i}" src="assets/sfx/ui/click3.ogg" data-start="${r2(t)}" data-duration="0.09" data-track-index="${11 + i}" data-volume="0.38"></audio>`).join('\n')}
</div>
<script>
  const tl = gsap.timeline({ paused: true });
  tl.fromTo('#keys', { opacity: 0, x: 40 }, { opacity: 1, x: 0, duration: 0.45, ease: 'expo.out' }, ${r2(cap.wheel - 0.3)});
  tl.to('#keys', { opacity: 0, x: 40, duration: 0.35, ease: 'power2.in' }, ${r2(cap.autopilot + 1.0)});
  ${keyFlashes
    .map(
      (flash) =>
        `tl.to('#key-${flash.k}', { opacity: 1, scale: 1.12, backgroundColor: '#176bff', color: '#ffffff', duration: 0.1, ease: 'power2.out' }, ${r2(flash.from)});
  tl.to('#key-${flash.k}', { opacity: 0.5, scale: 1, backgroundColor: 'rgba(255,255,255,0.95)', color: '#111d3a', duration: 0.18, ease: 'power2.in' }, ${r2(flash.to)});`,
    )
    .join('\n  ')}
  window.__timelines['main'] = tl;
</script>
</body>
</html>
`;
  const out = path.join(ROOT, 'walkthrough', 'index.html');
  writeFileSync(out, html);
  writeFileSync(path.join(HERE, 'walkthrough-voice.json'), JSON.stringify({ total: TOTAL, lines }, null, 1));
  vtt(lines, path.join(ROOT, 'walkthrough', 'walkthrough.vtt'), TOTAL);
  srt(lines, path.join(ROOT, 'walkthrough', 'walkthrough.srt'), TOTAL);
  console.log('wrote', path.relative(ROOT, out), 'total', TOTAL);
}

if (what === 'footage') {
  const footage = path.join(ROOT, 'composition', 'assets', 'footage');
  encode(path.join(HERE, 'frames', 'aerial'), path.join(footage, 'aerial.mp4'));
  encode(path.join(HERE, 'frames', 'walkthrough'), path.join(footage, 'walk.mp4'));
  place(path.join(footage, 'walk.mp4'), path.join(ROOT, 'walkthrough', 'assets', 'footage', 'walk.mp4'));
} else if (what === 'intro') {
  // The narrator's lines, as voice.py left them.
  const vo = path.join(ROOT, 'composition', 'assets', 'vo');
  mkdirSync(vo, { recursive: true });
  for (const line of read('intro-timings.json').lines) {
    copyFileSync(path.join(HERE, 'vo', 'intro', `${line.id}.wav`), path.join(vo, `${line.id}.wav`));
  }
  intro();
} else if (what === 'walkthrough') {
  // The walkthrough's own assets: its voice, its bed, its clicks, the vendored runtime.
  const assets = path.join(ROOT, 'walkthrough', 'assets');
  mkdirSync(path.join(assets, 'vo'), { recursive: true });
  for (const line of read('walkthrough-timings.json').lines) {
    copyFileSync(path.join(HERE, 'vo', 'walkthrough', `${line.id}.wav`), path.join(assets, 'vo', `${line.id}.wav`));
  }
  mkdirSync(path.join(assets, 'music'), { recursive: true });
  mkdirSync(path.join(assets, 'sfx', 'ui'), { recursive: true });
  mkdirSync(path.join(assets, 'vendor'), { recursive: true });
  const skill = 'C:/Users/awaiz/.claude/skills/brag/assets';
  copyFileSync(`${skill}/music/happy-beats-business-moves-vol-9-by-ende-dot-app.mp3`, path.join(assets, 'music', 'happy-beats-business-moves-vol-9-by-ende-dot-app.mp3'));
  copyFileSync(`${skill}/sfx/ui/click3.ogg`, path.join(assets, 'sfx', 'ui', 'click3.ogg'));
  copyFileSync(path.join(ROOT, 'composition', 'assets', 'vendor', 'gsap.min.js'), path.join(assets, 'vendor', 'gsap.min.js'));
  if (!existsSync(path.join(assets, 'footage', 'walk.mp4'))) console.warn('walk.mp4 missing: run `node build.mjs footage` first');
  walkthrough();
} else {
  throw new Error(`unknown step ${what}`);
}
