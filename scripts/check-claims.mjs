#!/usr/bin/env node
/**
 * The gate between the evidence and the video.
 *
 * Run before every render, and wired into `npm run build:demo` so a failure
 * stops the build rather than producing an MP4 that has to be retracted. It
 * checks five things:
 *
 *   1. Banned phrases. A fixed list of claims this project cannot support —
 *      "99.99 % uptime", "zero downtime", "live satellite", "MPTCP", and the
 *      rest — must not appear in the narration or in any burned-in overlay.
 *      The reason each one is banned is in docs/VIDEO_CLAIMS.md §3.
 *   2. Every claim id cited by a shot resolves to a row in VIDEO_CLAIMS.md.
 *   3. The narration in timeline.json and the narration in narration.md are
 *      the same text, so the subtitle track cannot drift from the script.
 *   4. The shots tile the timeline exactly: no gap, no overlap, and the total
 *      lands inside the competition's 60–120 s window.
 *   5. Every card a shot names exists in the generated evidence extract, and
 *      every run a shot names has metrics on disk.
 *
 *     node scripts/check-claims.mjs
 *
 * Exit code 1 on any failure, with every problem listed rather than the first.
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relative) => readFileSync(join(ROOT, relative), 'utf8');

/**
 * Each entry is [pattern, why]. The patterns are deliberately loose — it is
 * better to trip on a sentence that turns out to be fine and reword it than to
 * let a variant through.
 *
 * `mptcp` is allowed in exactly one place: the sentence that says it is not
 * available. That exemption is a literal string, not a regex, so it cannot be
 * widened by accident.
 */
const BANNED = [
  [/99\.9+\s*%/i, 'never measured; it is a number from the design reference'],
  [/\bzero\s+(loss|downtime|interruption|outage)\b/i, 'the measured floor is 0.16 s'],
  [/\bno\s+(interruption|downtime|outage)\b/i, 'the measured floor is 0.16 s'],
  [/\bworks?\s+(everywhere|anywhere)\b/i, 'six scenarios on one synthetic route'],
  [/\bguarantee(s|d)?\b/i, 'nothing here is guaranteed'],
  [/\b(live|real)\s+satellite\b/i, 'no hardware was involved'],
  [/\bfield\s+(test|trial)\b(?!\s+are\s+the\s+next)/i, 'no field work was done'],
  [/\b5G\b/, 'the cellular profile is a shaped software link, not a 5G stack'],
  [/\bMPTCP\b/i, 'CONFIG_MPTCP is unset on this kernel'],
  [/\bproduction[- ]ready\b/i, 'not audited, not deployed'],
  [/\benterprise[- ]grade\b/i, 'unsupported'],
  [/\bbattle[- ]tested\b/i, 'unsupported'],
  [/\bsecure by design\b/i, 'see docs/SECURITY.md — that is a goal, not evidence'],
  [/\bAI\s+(decides|routes|chooses|controls)\b/i, 'no LLM is in the routing loop'],
  [/\b(real[- ]time|live)\s+network\b/i, 'it is a simulation'],
  [/\blive\s+test\b/i, 'it is a simulation'],
  [/\bstate[- ]of[- ]the[- ]art\b/i, 'unsupported comparative claim'],
  [/\bbest[- ]in[- ]class\b/i, 'unsupported comparative claim'],
  [/\bindustry[- ]standard\b/i, 'unsupported comparative claim'],
];

/** The one sentence permitted to name MPTCP, because it denies it. */
const MPTCP_EXEMPTION = 'the kernel has no MPTCP';

const problems = [];
const fail = (message) => problems.push(message);

// --- load ------------------------------------------------------------------

const timeline = JSON.parse(read('video/timeline.json'));
const claimsDoc = read('docs/VIDEO_CLAIMS.md');
const narrationDoc = read('video/narration.md');

const cardsPath = 'apps/web/public/video/cards.json';
if (!existsSync(join(ROOT, cardsPath))) {
  fail(`${cardsPath} is missing — run: python scripts/build_video_cards.py`);
}
const cards = existsSync(join(ROOT, cardsPath)) ? JSON.parse(read(cardsPath)).cards : {};

// --- 1. banned phrases -----------------------------------------------------

const spoken = timeline.narration.map((line) => ({ where: `narration ${line.id}`, text: line.text }));
const burned = timeline.overlays.flatMap((overlay, index) => [
  { where: `overlay ${index} text`, text: overlay.text },
  ...(overlay.sub ? [{ where: `overlay ${index} sub`, text: overlay.sub }] : []),
]);

for (const { where, text } of [...spoken, ...burned]) {
  for (const [pattern, why] of BANNED) {
    if (!pattern.test(text)) continue;
    if (pattern.source === '\\bMPTCP\\b' && text.includes(MPTCP_EXEMPTION)) continue;
    fail(`banned phrase in ${where}: ${pattern} — ${why}\n      "${text}"`);
  }
}

// --- 2. claim ids resolve --------------------------------------------------

const declared = new Set([...claimsDoc.matchAll(/^\|\s*(C\d+)\s*\|/gm)].map((match) => match[1]));
if (declared.size === 0) fail('docs/VIDEO_CLAIMS.md declares no claim rows — has the table format changed?');

for (const shot of timeline.shots) {
  for (const claim of shot.claims ?? []) {
    if (!declared.has(claim)) fail(`shot ${shot.id} cites ${claim}, which is not a row in docs/VIDEO_CLAIMS.md`);
  }
}

// --- 3. narration matches the script ---------------------------------------

const normalise = (text) =>
  text
    .replace(/\s+/g, ' ')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim()
    .toLowerCase();

// Blockquotes wrap, so rebuild each one by joining consecutive `>` lines.
const blocks = [];
let buffer = [];
for (const raw of narrationDoc.split('\n')) {
  if (raw.startsWith('>')) {
    buffer.push(raw.replace(/^>\s?/, ''));
  } else if (buffer.length) {
    blocks.push(normalise(buffer.join(' ')));
    buffer = [];
  }
}
if (buffer.length) blocks.push(normalise(buffer.join(' ')));
const scripted = new Set(blocks);

for (const line of timeline.narration) {
  if (!scripted.has(normalise(line.text))) {
    fail(`narration ${line.id} is not in video/narration.md verbatim:\n      "${line.text}"`);
  }
}

// --- 4. the timeline tiles --------------------------------------------------

const shots = [...timeline.shots].sort((a, b) => a.video_from - b.video_from);
if (Math.abs(shots[0].video_from) > 1e-6) fail(`first shot starts at ${shots[0].video_from}s, not 0`);

for (let i = 1; i < shots.length; i += 1) {
  const gap = shots[i].video_from - shots[i - 1].video_to;
  if (Math.abs(gap) > 1e-6) {
    fail(`${gap > 0 ? 'gap' : 'overlap'} of ${Math.abs(gap).toFixed(3)}s between ${shots[i - 1].id} and ${shots[i].id}`);
  }
}

const end = shots[shots.length - 1].video_to;
if (Math.abs(end - timeline.video.duration_s) > 1e-6) {
  fail(`shots end at ${end}s but video.duration_s says ${timeline.video.duration_s}s`);
}
if (end < 60 || end > 120) fail(`duration ${end}s is outside the required 60–120 s window`);

for (const line of timeline.narration) {
  if (line.to > end) fail(`narration ${line.id} ends at ${line.to}s, past the end of the video`);
  if (line.to - line.from > 14) fail(`narration ${line.id} runs ${(line.to - line.from).toFixed(1)}s — too long for one subtitle`);
}
for (const [index, overlay] of timeline.overlays.entries()) {
  if (overlay.to > end) fail(`overlay ${index} ends at ${overlay.to}s, past the end of the video`);
}

// --- 5. sources exist -------------------------------------------------------

for (const shot of shots) {
  if (shot.kind === 'card') {
    if (!cards[shot.card]) fail(`shot ${shot.id} names card "${shot.card}", which is not in ${cardsPath}`);
  }
  if (shot.kind === 'app') {
    const metrics = `data/runs/${shot.run_id}/metrics.json`;
    if (!existsSync(join(ROOT, metrics))) fail(`shot ${shot.id} names run ${shot.run_id}, but ${metrics} is missing`);
    if (!shot.sim_keys || shot.sim_keys.length < 2) fail(`shot ${shot.id} has no usable sim_keys`);
  }
}

// --- 6. the required statements are present ---------------------------------

const allText = [...spoken, ...burned].map((entry) => entry.text.toLowerCase()).join(' | ');
const REQUIRED = [
  [/software simulation/, 'the video must say "software simulation" out loud'],
  [/team kanban/, 'the video must end with "by Team Kanban"'],
];
for (const [pattern, why] of REQUIRED) {
  if (!pattern.test(allText)) fail(`${why} — ${pattern} not found in narration or overlays`);
}

// A simulation disclosure has to arrive early, not at the end.
const disclosure = [...timeline.narration, ...timeline.overlays].filter((entry) =>
  /software simulation/i.test(`${entry.text ?? ''} ${entry.sub ?? ''}`),
);
const earliest = Math.min(...disclosure.map((entry) => entry.from ?? Infinity));
if (!Number.isFinite(earliest) || earliest > 15) {
  fail(`"software simulation" first appears at ${earliest}s; it must be inside the first 15 s`);
}

// --- report -----------------------------------------------------------------

if (problems.length) {
  console.error(`\ncheck-claims: ${problems.length} problem${problems.length === 1 ? '' : 's'}\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('');
  process.exit(1);
}

console.log('check-claims: ok');
console.log(`  ${timeline.shots.length} shots, ${end.toFixed(1)}s, ${timeline.narration.length} narration cues`);
console.log(`  ${declared.size} claims declared in docs/VIDEO_CLAIMS.md, all shot citations resolve`);
console.log(`  ${BANNED.length} banned phrases checked against narration and overlays`);
