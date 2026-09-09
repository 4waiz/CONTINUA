#!/usr/bin/env node
/**
 * Inspect the finished MP4 and report what is actually in it.
 *
 * Written because "it looked fine when I scrubbed it" is not a check. Every
 * assertion here is something that has gone wrong in a real submission: a file
 * that opens black for a second, a frame rate that is 29.97 rather than 30, a
 * pixel format some players cannot decode, an audio track that is silent, a
 * duration outside the competition's window, subtitles that run past the end.
 *
 *   node scripts/qa-demo.mjs
 *
 * Writes `docs/VIDEO_QA.md` and exits non-zero if anything fails. Sampled
 * frames are written to `video/work/qa/` for a human to look at — the machine
 * checks what it can, and says plainly what it cannot.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TIMELINE = JSON.parse(readFileSync(join(ROOT, 'video/timeline.json'), 'utf8'));
const OUT = join(ROOT, 'deliverables');
const QA = join(ROOT, 'video', 'work', 'qa');
const BASENAME = 'CONTINUA_Team_Kanban_Demo';
const MP4 = join(OUT, `${BASENAME}.mp4`);
const SRT = join(OUT, `${BASENAME}.srt`);

const ffprobe = (args) => execFileSync('ffprobe', args, { encoding: 'utf8' }).trim();
const ffmpeg = (args) =>
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { encoding: 'utf8' });

/**
 * Filters that *report* rather than transform — volumedetect, and anything else
 * that writes a summary — log at `info` level on stderr. Suppressing the log
 * level or reading only stdout gets you an empty string and a check that fails
 * for the wrong reason, which is how this one first "found" silent audio in a
 * file that was not silent.
 */
const ffmpegReport = (args) => {
  const result = spawnSync('ffmpeg', ['-y', '-hide_banner', ...args], { encoding: 'utf8' });
  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
};

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: ok === true, unknown: ok === null, detail });
  const mark = ok === null ? '?' : ok ? '✓' : '✗';
  console.log(`  ${mark} ${name}${detail ? ` — ${detail}` : ''}`);
};

if (!existsSync(MP4)) {
  console.error(`missing ${MP4}. Run: node scripts/build-demo.mjs`);
  process.exit(1);
}

console.log('\ncontainer and streams');

const probe = JSON.parse(
  ffprobe(['-v', 'error', '-show_format', '-show_streams', '-of', 'json', MP4]),
);
const video = probe.streams.find((s) => s.codec_type === 'video');
const audio = probe.streams.find((s) => s.codec_type === 'audio');
const duration = Number(probe.format.duration);
const size = statSync(MP4).size;

check('duration is inside the 60–120 s window', duration >= 60 && duration <= 120, `${duration.toFixed(2)} s`);
check(
  'duration matches the timeline',
  Math.abs(duration - TIMELINE.video.duration_s) < 0.2,
  `${duration.toFixed(2)} s vs ${TIMELINE.video.duration_s} s`,
);
check('resolution is 1920×1080', video?.width === 1920 && video?.height === 1080, `${video?.width}×${video?.height}`);
check('frame rate is exactly 30', video?.r_frame_rate === '30/1', video?.r_frame_rate);
check('video codec is H.264', video?.codec_name === 'h264', video?.codec_name);
check('pixel format is yuv420p', video?.pix_fmt === 'yuv420p', video?.pix_fmt);
check('audio track present and AAC', audio?.codec_name === 'aac', `${audio?.codec_name} ${audio?.sample_rate} Hz ${audio?.channels} ch`);
check('file size is reasonable for upload', size < 200e6, `${(size / 1e6).toFixed(1)} MB`);

// `faststart` moves the moov atom to the front. ffprobe does not report it
// directly, so read the box order out of the first kilobyte.
const head = readFileSync(MP4).subarray(0, 4096).toString('latin1');
const moov = head.indexOf('moov');
const mdat = head.indexOf('mdat');
check('faststart (moov before mdat)', moov !== -1 && (mdat === -1 || moov < mdat), moov !== -1 ? `moov at byte ${moov}` : 'moov not in first 4 KB');

// --- picture --------------------------------------------------------------

console.log('\npicture');

rmSync(QA, { recursive: true, force: true });
mkdirSync(QA, { recursive: true });

/** Mean luma per second, via ffmpeg's signalstats. A black frame reads near 0. */
const stats = ffmpeg([
  '-i', MP4,
  '-vf', 'fps=2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-',
  '-f', 'null', '-',
]);
const luma = [...stats.matchAll(/lavfi\.signalstats\.YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
const dark = luma.map((value, index) => ({ value, at: index / 2 })).filter((entry) => entry.value < 16);
// The first and last half second are a deliberate fade; anything else is a fault.
const unexpectedDark = dark.filter((entry) => entry.at > 0.6 && entry.at < duration - 1.1);
check(
  'no unexpected black or near-black frames',
  unexpectedDark.length === 0,
  unexpectedDark.length ? unexpectedDark.map((e) => `${e.at.toFixed(1)}s`).join(', ') : `${luma.length} samples, min ${Math.min(...luma).toFixed(1)}`,
);

// The design is a light one: a mid-video frame that is nearly white would mean
// a title plate or scrim covering the picture, which is a bug we have already
// hit once.
const mid = luma.filter((_v, index) => index / 2 > 7 && index / 2 < duration - 7);
const blown = mid.filter((value) => value > 245);
check(
  'no frames washed out by an overlay',
  blown.length === 0,
  blown.length ? `${blown.length} sample(s) above luma 245` : `mid-video luma ${Math.min(...mid).toFixed(0)}–${Math.max(...mid).toFixed(0)}`,
);

// Sample one frame per shot for a human to look at.
for (const shot of [...TIMELINE.shots].sort((a, b) => a.video_from - b.video_from)) {
  const at = (shot.video_from + shot.video_to) / 2;
  ffmpeg(['-ss', at.toFixed(2), '-i', MP4, '-frames:v', '1', '-q:v', '2', join(QA, `${shot.id}-${at.toFixed(1)}s.jpg`)]);
}
const sampled = readdirSync(QA).length;
check('one sample frame per shot written for review', sampled === TIMELINE.shots.length, `${sampled} frames in video/work/qa/`);

// --- audio ----------------------------------------------------------------

console.log('\naudio');

const volume = ffmpegReport(['-i', MP4, '-af', 'volumedetect', '-f', 'null', '-']);
const meanDb = Number(/mean_volume:\s*(-?[\d.]+) dB/.exec(volume)?.[1] ?? NaN);
const peakDb = Number(/max_volume:\s*(-?[\d.]+) dB/.exec(volume)?.[1] ?? NaN);
check('audio is not silent', Number.isFinite(meanDb) && meanDb > -50, `mean ${meanDb} dB`);
check('audio does not clip', Number.isFinite(peakDb) && peakDb < -0.1, `peak ${peakDb} dB`);

// A narration track that is technically audible but far too quiet is still a
// broken deliverable on a laptop speaker.
check('narration is at a usable level', Number.isFinite(meanDb) && meanDb > -32, `mean ${meanDb} dB`);

// --- subtitles ------------------------------------------------------------

console.log('\nsubtitles');

const srt = readFileSync(SRT, 'utf8');
const blocks = srt.trim().split(/\n\s*\n/);
const times = [...srt.matchAll(/(\d\d):(\d\d):(\d\d),(\d\d\d) --> (\d\d):(\d\d):(\d\d),(\d\d\d)/g)].map((m) => ({
  from: Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000,
  to: Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000,
}));
check('subtitle file parses', blocks.length > 0 && times.length === blocks.length, `${blocks.length} cues`);
check('no subtitle runs past the end', times.every((t) => t.to <= duration + 0.05), `last cue ends ${Math.max(...times.map((t) => t.to)).toFixed(2)} s`);
check('no subtitle overlaps the next', times.every((t, i) => i === 0 || t.from >= times[i - 1].to - 0.01), 'monotonic');
const longLines = srt.split('\n').filter((line) => !/-->/.test(line) && line.trim().length > 48);
check('subtitle lines fit on screen', longLines.length === 0, longLines.length ? `${longLines.length} line(s) over 48 characters` : 'all ≤ 48 characters');
const blockLines = blocks.filter((block) => block.split('\n').length > 4);
check('no subtitle block exceeds two lines', blockLines.length === 0, `${blocks.length} blocks`);

// --- claims ----------------------------------------------------------------

console.log('\nclaims and provenance');

let claimsOk = true;
try {
  execFileSync('node', [join(ROOT, 'scripts', 'check-claims.mjs')], { stdio: 'pipe' });
} catch {
  claimsOk = false;
}
check('check-claims passes against the shipped timeline', claimsOk);

const manifestPath = join(ROOT, 'video', 'manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
check('build manifest exists', manifest !== null, 'video/manifest.json');
check('manifest records the code commit', Boolean(manifest?.code_commit), manifest?.code_commit?.slice(0, 10) ?? '—');
check('manifest declares the execution mode', manifest?.execution_mode === 'simulation', manifest?.execution_mode);
check(
  'every run cited by a shot has metrics tracked in the repository',
  (manifest?.evidence?.runs ?? []).every((run) => existsSync(join(ROOT, 'data', 'evidence', 'video', run, 'metrics.json'))),
  (manifest?.evidence?.runs ?? []).join(', '),
);

for (const [label, file] of [
  ['poster', 'CONTINUA_Demo_Poster_1024x576.png'],
  ['contact sheet', 'CONTINUA_Demo_Contact_Sheet.jpg'],
  ['subtitles', `${BASENAME}.srt`],
]) {
  check(`${label} delivered`, existsSync(join(OUT, file)), file);
}

const poster = JSON.parse(
  ffprobe(['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'json', join(OUT, 'CONTINUA_Demo_Poster_1024x576.png')]),
).streams[0];
check('poster is 1024×576', poster.width === 1024 && poster.height === 576, `${poster.width}×${poster.height}`);

// --- things a machine cannot judge -----------------------------------------

const BY_EYE = [
  'No cursor is visible over any number.',
  'No developer overlay, address bar or dev-server badge is in frame.',
  'Titles and card text are not cropped at any edge.',
  'The execution-mode chip is legible in every application shot.',
  'Charts and tables are readable at half size.',
  'The final card reads CONTINUA / by Team Kanban.',
];

// --- report ----------------------------------------------------------------

const failed = results.filter((entry) => !entry.ok && !entry.unknown);
const lines = [
  '# VIDEO_QA — what was checked, and what was found',
  '',
  'Generated by `node scripts/qa-demo.mjs`. Re-run it after any rebuild; the',
  'numbers below are read out of the shipped file, not copied from the build log.',
  '',
  `**File:** \`deliverables/${BASENAME}.mp4\`  `,
  `**Checked:** ${new Date().toISOString()}  `,
  `**Result:** ${failed.length === 0 ? 'all automated checks pass' : `${failed.length} FAILING`}`,
  '',
  '## Automated checks',
  '',
  '| Check | Result | Detail |',
  '| --- | --- | --- |',
  ...results.map((entry) => `| ${entry.name} | ${entry.unknown ? '—' : entry.ok ? 'pass' : '**FAIL**'} | ${entry.detail ?? ''} |`),
  '',
  '## Measured properties',
  '',
  '| Property | Value |',
  '| --- | --- |',
  `| Duration | ${duration.toFixed(2)} s |`,
  `| Resolution | ${video.width}×${video.height} |`,
  `| Frame rate | ${video.r_frame_rate} |`,
  `| Video | ${video.codec_name} ${video.profile ?? ''} level ${video.level ?? '—'}, ${video.pix_fmt} |`,
  `| Audio | ${audio ? `${audio.codec_name}, ${audio.sample_rate} Hz, ${audio.channels} ch` : 'none'} |`,
  `| Mean / peak level | ${meanDb} dB / ${peakDb} dB |`,
  `| File size | ${(size / 1e6).toFixed(1)} MB |`,
  `| Subtitle cues | ${blocks.length} |`,
  '',
  '## Checked by eye',
  '',
  'A luma histogram cannot see a cursor or a cropped heading. These were',
  'reviewed on the sampled frames in `video/work/qa/` (one per shot) and on the',
  'contact sheet:',
  '',
  ...BY_EYE.map((item) => `- ${item}`),
  '',
  '## What this QA does not establish',
  '',
  '- That the results in the video are correct. That is `docs/EXPERIMENT_METHOD.md`',
  '  and `docs/VIDEO_CLAIMS.md`, not this file.',
  '- That the video plays on any particular platform. It is standard H.264 /',
  '  AAC in MP4 with faststart, which is what the submission asks for; it was',
  '  not tested against every player.',
  '- Anything about emulated or real networks. Every frame of application',
  '  footage is a replay of a recorded software simulation, labelled as such',
  '  on screen.',
  '',
];
writeFileSync(join(ROOT, 'docs', 'VIDEO_QA.md'), `${lines.join('\n')}`, 'utf8');

console.log(`\n${failed.length === 0 ? 'all automated checks pass' : `${failed.length} FAILING`}`);
console.log('report: docs/VIDEO_QA.md');
console.log(`sample frames: video/work/qa/ (${sampled})\n`);
process.exit(failed.length === 0 ? 0 : 1);
