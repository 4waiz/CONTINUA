#!/usr/bin/env node
/**
 * Run a CONTINUA Blender script in headless Blender.
 *
 * Headless (`--background`) is deliberate: it keeps generation reproducible and
 * it never touches an interactive Blender session the user may have open with
 * unsaved work.
 *
 *   node scripts/run-blender.mjs scripts/blender/build_vehicle.py [-- extra args]
 *
 * Resolution order for the executable:
 *   1. $CONTINUA_BLENDER
 *   2. `blender` on PATH
 *   3. Well-known Windows / macOS / Linux install locations (newest first)
 */

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function candidates() {
  const found = [];
  if (process.env.CONTINUA_BLENDER) found.push(process.env.CONTINUA_BLENDER);

  const roots = [
    "C:\\Program Files\\Blender Foundation",
    "C:\\Program Files (x86)\\Blender Foundation",
    "/Applications",
  ];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    let entries = [];
    try {
      entries = readdirSync(root).filter((name) => name.toLowerCase().startsWith("blender"));
    } catch {
      continue;
    }
    // Newest version directory first ("Blender 5.2" before "Blender 4.2").
    entries.sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const entry of entries) {
      found.push(
        resolve(root, entry, "blender.exe"),
        resolve(root, entry, "Contents/MacOS/Blender"),
      );
    }
  }
  found.push("/usr/bin/blender", "/usr/local/bin/blender", "/snap/bin/blender");
  return found;
}

function resolveBlender() {
  for (const candidate of candidates()) {
    if (candidate && existsSync(candidate)) return candidate;
  }
  const probe = spawnSync("blender", ["--version"], { encoding: "utf8" });
  if (probe.status === 0) return "blender";
  return null;
}

const [, , scriptArg, ...rest] = process.argv;
if (!scriptArg) {
  console.error("usage: node scripts/run-blender.mjs <script.py> [-- script args]");
  process.exit(2);
}

const scriptPath = resolve(repoRoot, scriptArg);
if (!existsSync(scriptPath)) {
  console.error(`Blender script not found: ${scriptPath}`);
  process.exit(2);
}

const blender = resolveBlender();
if (!blender) {
  console.error(
    "Blender executable not found.\n" +
      "Set CONTINUA_BLENDER to the full path, e.g.\n" +
      '  CONTINUA_BLENDER="C:\\\\Program Files\\\\Blender Foundation\\\\Blender 5.2\\\\blender.exe"',
  );
  process.exit(127);
}

const version = spawnSync(blender, ["--version"], { encoding: "utf8" });
console.log(`> ${blender}`);
console.log(`> ${(version.stdout || "").split("\n")[0].trim()}`);
console.log(`> running ${scriptArg}\n`);

const args = ["--background", "--factory-startup", "--python-exit-code", "1", "--python", scriptPath];
if (rest.length) args.push("--", ...rest);

const run = spawnSync(blender, args, {
  cwd: repoRoot,
  stdio: "inherit",
  env: { ...process.env, CONTINUA_REPO_ROOT: repoRoot, PYTHONIOENCODING: "utf-8" },
});

process.exit(run.status ?? 1);
