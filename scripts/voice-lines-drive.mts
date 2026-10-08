/**
 * List every line the drive view's voice can say, for `scripts/build-voice.mjs`
 * to record.
 *
 * Driving, the voice says what changed in the short words already on screen
 * (`spokenLines` in apps/web/src/components/mission/plain.ts, which the page
 * uses too, so the recordings and the screen cannot disagree):
 *
 * * the handoff toast - "Moved to Satellite." - for every network;
 * * the road strip's warning - "Gap ahead: getting satellite ready.";
 * * a status card - "<rover>: connection lost." and "<rover>: connected
 *   again." - for every strategy's rover.
 *
 *   npx tsx scripts/voice-lines-drive.mts
 *
 * Writes the `drive` list of `apps/web/public/voice/lines.json`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EngineLinkId } from '../packages/contracts/src/engine.ts';
import { NETWORK, spokenLines, STRATEGY } from '../apps/web/src/components/mission/plain.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'apps/web/public/voice/lines.json');

const lines = new Set<string>();
for (const link of Object.keys(NETWORK) as EngineLinkId[]) lines.add(spokenLines.movedTo(link));
lines.add(spokenLines.gapAhead);
const rovers = new Set<string>([...Object.values(STRATEGY).map((strategy) => strategy.who), 'Normal rover']);
for (const rover of rovers) {
  lines.add(spokenLines.connection(rover, false));
  lines.add(spokenLines.connection(rover, true));
}

mkdirSync(dirname(OUT), { recursive: true });
const existing = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : {};
writeFileSync(OUT, `${JSON.stringify({ ...existing, drive: [...lines] }, null, 2)}\n`);
console.log(`${lines.size} drive lines -> ${OUT}`);
