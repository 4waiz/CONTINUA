/**
 * Turn the supplied `logo.png` into a wordmark the interface can sit on any
 * background.
 *
 * The source is ink on a near-white card: fully opaque, `rgb(250,252,254)`
 * behind the letters. Dropped straight into the header it would show as a pale
 * rectangle against the page ground, and it would be invisible on anything
 * dark. Keying the background to transparent with a threshold would work but
 * would chew the anti-aliased glyph edges into a fringe.
 *
 * So this un-mattes it properly instead. Every pixel of ink-on-white is
 * `ink * a + white * (1 - a)`; solving for both gives back the coverage and the
 * true ink colour, so the letter edges keep their exact original softness and
 * the gradient keeps its exact original hue.
 *
 *     node scripts/build-brand-logo.mjs
 *
 * In:  logo.png                                (as supplied, not modified)
 * Out: apps/web/public/brand/continua-logo.png (alpha, 2x header width)
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'logo.png');
const OUT_DIR = path.join(ROOT, 'apps', 'web', 'public', 'brand');
const OUT = path.join(OUT_DIR, 'continua-logo.png');

/** Rendered around 210 CSS px wide; 2x covers every display we target. */
const TARGET_WIDTH = 560;

mkdirSync(OUT_DIR, { recursive: true });

// The un-matte, as an ffmpeg expression over the RGB planes.
//
//   a  = 1 - min(r, g, b) / 255          coverage: white is empty, ink is full
//   c' = (c - 255 * (1 - a)) / a         the ink colour before it hit the card
//
// `geq` evaluates each output plane independently, so the alpha expression is
// repeated inside the colour ones rather than shared. `lum`/`cb`/`cr` are not
// used: the input is forced to rgba first so r/g/b are literal.
const alpha = '(255 - min(min(r(X,Y),g(X,Y)),b(X,Y)))';
const unmatte = (channel) =>
  `if(lte(${alpha},1), 255, clip((${channel}(X,Y)*255 - 255*(255-${alpha}))/${alpha}, 0, 255))`;

const filter = [
  'format=rgba',
  `geq=r='${unmatte('r')}':g='${unmatte('g')}':b='${unmatte('b')}':a='${alpha}'`,
  `scale=${TARGET_WIDTH}:-1:flags=lanczos`,
].join(',');

execFileSync(
  'ffmpeg',
  ['-y', '-loglevel', 'error', '-i', SOURCE, '-vf', filter, '-frames:v', '1', OUT],
  { stdio: 'inherit' },
);

const { size } = statSync(OUT);
const dims = execFileSync('ffprobe', [
  '-v', 'error',
  '-select_streams', 'v:0',
  '-show_entries', 'stream=width,height,pix_fmt',
  '-of', 'csv=p=0',
  OUT,
])
  .toString()
  .trim();

console.log(`wrote ${path.relative(ROOT, OUT)}  ${dims}  ${(size / 1024).toFixed(1)} kB`);
