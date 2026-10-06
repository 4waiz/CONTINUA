#!/usr/bin/env node
/**
 * Build the public static export and publish it to Cloudflare.
 *
 *   npm run deploy            build, check, deploy
 *   npm run deploy -- --dry   build and check only
 *
 * The public site is a static export with no engine behind it: it replays the
 * runs in apps/web/public/demo/. This script sets both build flags, refuses to
 * deploy an export that would look for a local engine or has no recordings,
 * and only then runs `wrangler deploy` (account and domain are pinned in
 * wrangler.jsonc).
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'apps', 'web', 'out');
const dry = process.argv.includes('--dry');

function run(command, args, env = process.env) {
  console.log(`\n> ${command} ${args.join(' ')}`);
  const result = spawnSync(command, args, { cwd: ROOT, env, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    console.error(`\n${command} exited with ${result.status}; nothing was deployed.`);
    process.exit(result.status ?? 1);
  }
}

function fail(message) {
  console.error(`\nRefusing to deploy: ${message}`);
  process.exit(1);
}

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else yield full;
  }
}

rmSync(OUT, { recursive: true, force: true });
run('npm', ['run', 'build'], { ...process.env, CONTINUA_STATIC: '1', NEXT_PUBLIC_PUBLIC_PREVIEW: '1' });

// Next 16's export writes each route's segment prefetch payload in a folder
// (`experiments/__next.experiments/__PAGE__.txt`) but the client requests the
// dotted name (`experiments/__next.experiments.__PAGE__.txt`), so every
// client-side navigation logged a 404 before falling back. Write the dotted
// name beside each one.
let flattened = 0;
for (const file of files(OUT)) {
  const parts = path.relative(OUT, file).split(path.sep);
  const at = parts.findIndex((part) => part.startsWith('__next.'));
  if (at === -1 || at === parts.length - 1 || parts[0] === '_next' || parts[0] === 'demo') continue;
  const flat = path.join(OUT, ...parts.slice(0, at), parts.slice(at).join('.'));
  if (!existsSync(flat)) {
    copyFileSync(file, flat);
    flattened += 1;
  }
}
console.log(`\nWrote ${flattened} dotted segment prefetch files.`);

// --- checks on what was built ------------------------------------------------

if (!existsSync(path.join(OUT, 'index.html'))) fail('apps/web/out/index.html is missing - the export did not run.');

const index = path.join(OUT, 'demo', 'index.json');
if (!existsSync(index)) fail('apps/web/out/demo/index.json is missing - run `python scripts/build_demo_data.py` first.');
const runs = JSON.parse(readFileSync(index, 'utf8')).runs ?? [];
if (runs.length === 0) fail('the demo index lists no recorded runs.');
for (const entry of runs) {
  if (!existsSync(path.join(OUT, 'demo', 'runs', `${entry.run_id}.json`))) fail(`recording ${entry.run_id} is listed but missing.`);
}

// The preview flag is inlined at build time and the minifier drops the branch
// it rules out. A build that expects a local engine keeps the header's
// "NO RUN" badge (AppShell's ModeBadge); a public-preview build has no trace
// of it.
const scripts = [...files(path.join(OUT, '_next', 'static'))].filter((file) => file.endsWith('.js'));
if (scripts.some((file) => readFileSync(file, 'utf8').includes('"NO RUN"'))) {
  fail('the bundle still carries the local-engine "NO RUN" badge - the public-preview flag did not reach the build.');
}

const tooBig = [...files(OUT)].filter((file) => statSync(file).size > 25 * 1024 * 1024);
if (tooBig.length) fail(`Cloudflare serves assets up to 25 MiB; too large: ${tooBig.map((f) => path.relative(OUT, f)).join(', ')}`);

console.log(`\nExport checked: ${runs.length} recorded runs, preview mode on.`);
if (dry) {
  console.log('Dry run - not deployed.');
  process.exit(0);
}

run('npx', ['wrangler', 'deploy']);
