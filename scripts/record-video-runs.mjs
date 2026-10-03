#!/usr/bin/env node
/**
 * Record the demo video's source runs again, and prove they are the same runs.
 *
 * The video cites three simulation runs by id (video/timeline.json,
 * docs/VIDEO_CLAIMS.md). A run's events live in the engine's local store,
 * which is not part of the repository, so a fresh checkout cannot replay the
 * ids the video was cut from. The simulation is deterministic - the same
 * scenario, seed, policy and predictor always produce the same events - so
 * this records each run again and **checks every metric the original run
 * published** (`data/evidence/video/<id>/metrics.json`) against the new one.
 * Any difference fails the script; metrics added by later engine versions are
 * listed but are not differences.
 *
 *   node scripts/record-video-runs.mjs            # record, verify, write evidence
 *   node scripts/record-video-runs.mjs --dry-run  # record and verify only
 *
 * Needs the engine (CONTINUA_ENGINE, default http://127.0.0.1:8000). Writes
 * data/evidence/video/<new id>/{manifest,metrics}.json and prints the old-to-new
 * id map for the timeline and the claims ledger.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENGINE = process.env.CONTINUA_ENGINE ?? 'http://127.0.0.1:8000';
const DRY = process.argv.includes('--dry-run');

/** The runs the video was cut from, and what they were. */
const SOURCES = ['run-7d8750c2b7', 'run-d2819d215c', 'run-3c69f9615f'];

async function call(path, init) {
  const response = await fetch(`${ENGINE}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

function flatten(value, prefix = '', out = {}) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, inner] of Object.entries(value)) flatten(inner, prefix ? `${prefix}.${key}` : key, out);
  } else if (typeof value === 'number' || typeof value === 'boolean' || value === null || typeof value === 'string') {
    out[prefix] = value;
  }
  return out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const map = {};
let failed = false;
for (const source of SOURCES) {
  const evidence = join(ROOT, 'data', 'evidence', 'video', source);
  const manifest = JSON.parse(readFileSync(join(evidence, 'manifest.json'), 'utf8'));
  const published = JSON.parse(readFileSync(join(evidence, 'metrics.json'), 'utf8'));
  const control = {
    scenario_id: manifest.scenario.id,
    policy_id: manifest.policy_id,
    seed: manifest.seed,
    predictor: manifest.predictor,
    horizon_s: manifest.horizon_s,
    // Speed 0: the session runs straight to the end - pacing is not part of a run.
    speed: 0,
  };
  const started = await call('/api/runs', { method: 'POST', body: JSON.stringify({ control }) });
  const runId = started.run_id;
  let metrics = null;
  for (let attempt = 0; attempt < 120 && metrics === null; attempt += 1) {
    await sleep(500);
    metrics = await call(`/api/runs/${runId}/metrics`).catch(() => null);
  }
  if (!metrics) throw new Error(`${runId}: no metrics after 60 s`);
  const before = flatten(published);
  const after = flatten(metrics);
  // A run's identity is not a measurement: the id and the wall-clock times are
  // new on every recording by design.
  const identity = (key) => /(^|\.)(run_id|started_at|finished_at|recorded_at|code_commit)$/.test(key);
  const changed = Object.keys(before).filter(
    (key) => !identity(key) && JSON.stringify(before[key]) !== JSON.stringify(after[key]),
  );
  const added = Object.keys(after).filter((key) => !(key in before));
  console.log(
    `${source} -> ${runId}  ${control.scenario_id} · ${control.policy_id} · seed ${control.seed}: ` +
      `${Object.keys(before).length} published metrics, ${changed.length} differ, ${added.length} added since`,
  );
  for (const key of changed.slice(0, 20)) console.log(`   DIFFERS ${key}: ${before[key]} -> ${after[key]}`);
  if (changed.length) failed = true;
  map[source] = runId;
  if (!DRY && changed.length === 0) {
    const run = await call(`/api/runs/${runId}`);
    const target = join(ROOT, 'data', 'evidence', 'video', runId);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'manifest.json'), `${JSON.stringify(run.manifest ?? run, null, 2)}\n`);
    writeFileSync(join(target, 'metrics.json'), `${JSON.stringify(metrics, null, 2)}\n`);
  }
}
console.log(JSON.stringify(map, null, 2));
if (failed) {
  console.error('A re-recorded run differs from what the video published. Nothing may cite it.');
  process.exit(1);
}
