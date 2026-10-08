/**
 * List every line the drive view's voice can say on the recorded runs, for
 * `scripts/build-voice.mjs` to record.
 *
 * Driving, the voice keeps a running commentary built from the two runs' own
 * events (`driveCommentary` in apps/web/src/components/mission/commentary.ts,
 * which the page uses too, so the recordings and the page cannot disagree):
 * why each switch happened, the road map's warning, each rover losing its
 * link and getting it back, the run's summary. Its sentences carry the runs'
 * own numbers - "back after 4.5 seconds" - so the way to know them is to run
 * the commentary over every run the public site replays: each recording in
 * apps/web/public/demo, on its own and beside the normal rover's recording of
 * the same scenario, as the Mission page shows it. A run the engine produces
 * locally with other numbers falls back to the browser's own local voice.
 *
 *   npx tsx scripts/voice-lines-drive.mts
 *
 * Writes the `drive` list of `apps/web/public/voice/lines.json`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngineEvent } from '../packages/contracts/src/engine.ts';
import { deadZonesFromFaults } from '../packages/scene/src/world/deadZones.ts';
import { route } from '../packages/scene/src/world/route.ts';
import { driveCommentary } from '../apps/web/src/components/mission/commentary.ts';
import { STRATEGY } from '../apps/web/src/components/mission/plain.ts';
import { decodeRun, type EncodedRun } from '../apps/web/src/lib/staticDemo.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEMO = join(ROOT, 'apps/web/public/demo');
const OUT = join(ROOT, 'apps/web/public/voice/lines.json');
/** The normal rover: what every other strategy is compared with. */
const BASELINE = 'B0';

interface IndexRun {
  run_id: string;
  scenario_id: string;
  policy_id: string;
}
interface IndexScenario {
  id: string;
  reverse?: boolean;
  faults?: { kind: string; link: string; from_m?: number; to_m?: number; ramp_m?: number }[];
}

const index = JSON.parse(readFileSync(join(DEMO, 'index.json'), 'utf8')) as { runs: IndexRun[]; scenarios: IndexScenario[] };
const scenarios = new Map(index.scenarios.map((scenario) => [scenario.id, scenario]));
const events = new Map<string, EngineEvent[]>();
const load = (runId: string) => {
  let list = events.get(runId);
  if (!list) {
    const encoded = JSON.parse(readFileSync(join(DEMO, 'runs', `${runId}.json`), 'utf8')) as EncodedRun;
    list = decodeRun(encoded).events;
    events.set(runId, list);
  }
  return list;
};

const lines = new Set<string>();
let pairs = 0;
for (const run of index.runs) {
  const scenario = scenarios.get(run.scenario_id);
  if (!scenario) continue;
  const zones = deadZonesFromFaults(scenario.faults);
  const mainName = STRATEGY[run.policy_id as keyof typeof STRATEGY]?.who ?? run.policy_id;
  const baselineRun =
    run.policy_id === BASELINE
      ? null
      : index.runs.find((other) => other.scenario_id === run.scenario_id && other.policy_id === BASELINE);
  // Alone (the comparison switched off, or the normal rover itself), and
  // beside the normal rover, as the page opens it.
  for (const baseline of baselineRun ? [null, baselineRun] : [null]) {
    const said = driveCommentary({
      main: load(run.run_id),
      mainName,
      baseline: baseline ? load(baseline.run_id) : null,
      zones,
      reverse: Boolean(scenario.reverse),
      routeLength: route.length,
      completed: true,
    });
    for (const line of said) lines.add(line.text);
    pairs += 1;
  }
}

mkdirSync(dirname(OUT), { recursive: true });
const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
writeFileSync(OUT, `${JSON.stringify({ ...existing, drive: [...lines].sort() }, null, 2)}\n`);
console.log(`${lines.size} drive lines from ${pairs} runs and pairs -> ${OUT}`);
