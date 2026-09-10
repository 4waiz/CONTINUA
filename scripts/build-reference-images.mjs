#!/usr/bin/env node
/**
 * Prepare the ATP 2026 EDGE supporting materials for the web.
 *
 * The originals are ten 1700px PNGs totalling ~16 MB, which is far too much to
 * put on a page. They are converted to WebP (full size and thumbnail) with
 * ffmpeg, which is already a dependency of the video pipeline, and a manifest is
 * written so the page has real titles rather than `1 (7).png`.
 *
 * The source filenames do not match the slide order - `1 (1).png` is slide
 * 7/10 - so the mapping below is explicit and was read off the slides
 * themselves, not guessed.
 *
 *   node scripts/build-reference-images.mjs
 *
 * Originals are kept in `assets/reference/supporting-material/` (tracked, they
 * are the source of truth). Web copies go to `apps/web/public/reference/`.
 */

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ORIGINALS = join(ROOT, 'assets', 'reference', 'supporting-material');
const OUT = join(ROOT, 'apps', 'web', 'public', 'reference');

/**
 * Slide number, title and one line on what it is for - read off each image.
 * `results: true` marks the two whose figures are superseded by the measured
 * experiments in this repository; the page says so next to them.
 */
const SLIDES = [
  { file: '1 (5).png', slide: 1, title: 'System Concept Sketch', summary: 'Rover, four candidate networks, one gateway, and the loop between them.' },
  { file: '1 (6).png', slide: 2, title: 'Route & Coverage Drawing', summary: 'The four zones the route crosses, and where each network reaches.' },
  { file: '1 (7).png', slide: 3, title: 'Handoff Logic Flow', summary: 'Observe, Predict, Prepare, Steer, Explain as a state flow.' },
  { file: '1 (8).png', slide: 4, title: 'Prediction Calculation', summary: 'The heuristic worked by hand: slope, extrapolation, threshold.' },
  { file: '1 (9).png', slide: 5, title: 'Link Selection Score', summary: 'The weighted utility that ranks candidate paths.' },
  { file: '1 (10).png', slide: 6, title: 'Testbed Architecture', summary: 'How a run is produced, end to end.' },
  { file: '1 (1).png', slide: 7, title: 'Scenario Matrix & Assumptions', summary: 'Six scenarios and the assumptions shared across them.' },
  { file: '1 (2).png', slide: 8, title: 'Baseline Comparison Results', summary: 'Early B0 / B1 / P1 comparison.', superseded: true },
  { file: '1 (3).png', slide: 9, title: 'Application-Level Test Results', summary: 'Early receiver-side figures.', superseded: true },
  { file: '1 (4).png', slide: 10, title: 'References & Evidence Notes', summary: 'Literature, tools, and the evidence package.' },
];

const run = (args) =>
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...args], { stdio: 'inherit' });

/**
 * Real pixel dimensions, so the page can reserve the right box before a lazy
 * image loads. Without this the grid rows collapse to zero height and the
 * layout jumps as each one arrives.
 */
const dimensions = (file) => {
  const out = execFileSync(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file],
    { encoding: 'utf8' },
  ).trim();
  const [width, height] = out.split(',').map(Number);
  return { width, height };
};

function main() {
  if (!existsSync(ORIGINALS)) {
    console.error(`missing ${ORIGINALS}\nMove the source PNGs there first.`);
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });

  const manifest = [];
  let originalBytes = 0;
  let webBytes = 0;

  for (const slide of SLIDES) {
    const source = join(ORIGINALS, slide.file);
    if (!existsSync(source)) {
      console.error(`missing ${slide.file} - skipped`);
      continue;
    }
    const stem = `supporting-${String(slide.slide).padStart(2, '0')}`;

    // Full size, capped at 1800px wide. The originals are ~1700px, so this is a
    // format change rather than a downscale for most of them.
    const full = join(OUT, `${stem}.webp`);
    run(['-i', source, '-vf', "scale='min(1800,iw)':-2:flags=lanczos", '-quality', '82', full]);

    // A thumbnail for the grid, so the page does not pull 10 full images to
    // render a set of cards.
    const thumb = join(OUT, `${stem}-thumb.webp`);
    run(['-i', source, '-vf', "scale=760:-2:flags=lanczos", '-quality', '76', thumb]);

    originalBytes += statSync(source).size;
    webBytes += statSync(full).size + statSync(thumb).size;

    const size = dimensions(full);
    manifest.push({
      slide: slide.slide,
      title: slide.title,
      summary: slide.summary,
      superseded: Boolean(slide.superseded),
      full: `/reference/${stem}.webp`,
      thumb: `/reference/${stem}-thumb.webp`,
      width: size.width,
      height: size.height,
      original: slide.file,
    });

    console.log(
      `  ${String(slide.slide).padStart(2)}/10  ${slide.title.padEnd(34)} ` +
        `${(statSync(source).size / 1e6).toFixed(2)} MB → ${(statSync(full).size / 1e6).toFixed(2)} MB`,
    );
  }

  manifest.sort((a, b) => a.slide - b.slide);
  writeFileSync(
    join(OUT, 'manifest.json'),
    `${JSON.stringify(
      {
        set: 'ATP 2026 EDGE - supporting materials',
        team: 'Team Kanban',
        count: manifest.length,
        note:
          'Preliminary engineering materials produced for the proposal. Where a slide reports ' +
          'results, the measured experiments in this repository supersede it - see docs/PROGRESS.md ' +
          'and the Experiments page.',
        slides: manifest,
      },
      null,
      2,
    )}\n`,
    'utf8',
  );

  console.log(
    `\n${manifest.length} slides  ${(originalBytes / 1e6).toFixed(1)} MB original → ` +
      `${(webBytes / 1e6).toFixed(1)} MB web (full + thumb)`,
  );
}

main();
