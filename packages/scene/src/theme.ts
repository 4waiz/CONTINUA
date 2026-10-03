/**
 * CONTINUA design tokens.
 *
 * One source of truth for both the 3D scene and the dashboard chrome, so a
 * violet in the link beam is the same violet as the satellite chip. Light mode
 * only - see docs/DESIGN_SPEC.md.
 */

export const COLOR = {
  background: '#F7FAFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F5FC',
  text: '#14213D',
  muted: '#667593',
  border: '#E2E9F5',
  cyan: '#12B9E8',
  blue: '#176BFF',
  violet: '#7C3CFF',
  green: '#12B981',
  amber: '#F59E0B',
  red: '#E5484D',
} as const;

/**
 * Scene-only colours: a green coastal island on a clear day. Fresh meadow
 * greens, white beaches, a turquoise-to-sapphire sea and a deep blue sky -
 * colourful, but natural and light, so the white rover stays the cleanest
 * object in frame and the interface's cyan / blue / violet still read as the
 * network's colours, not the landscape's.
 */
export const SCENE_COLOR = {
  sky: '#3F8EDC',
  skyHorizon: '#D8EAF8',
  fog: '#D3E5F5',
  sun: '#FFF2DC',
  /** Campus lawn: mown, brighter and more even than the open meadow. */
  campus: '#7A9C55',
  grass: '#7C9A50',
  grassLush: '#54763C',
  grassDry: '#B9B76C',
  heath: '#8C8D5E',
  beach: '#EEE3C6',
  rockTint: '#8D958C',
  /** Ground colour for bounce light and the environment's lower half. */
  groundBounce: '#8AA468',
  flowerA: '#F2C230',
  flowerB: '#F4F1EA',
  flowerC: '#C46BD8',
  flowerD: '#F07A8E',
  seaShallow: '#4FD6C8',
  seaMid: '#1AA6C8',
  seaDeep: '#0F5E9C',
  concrete: '#C9CDD2',
  road: '#4F5664',
  roadEdge: '#B9B3A6',
  roadLine: '#F4F2EC',
  roadCentre: '#F2C14E',
  apron: '#C6CBD1',
  /** Precast kerbs where paving meets grass. */
  kerb: '#D7DBE0',
  /** Keep-clear hatching on the dock yard. */
  hatch: '#E9B832',
  grid: '#7C93B6',
  /**
   * Horizon ranges: lush island mountains - forest, darker in the gullies,
   * lit on the ribs, rock on the cliffs - near; blue-green far; the haze does
   * the rest.
   */
  mountainLush: '#3D7340',
  mountainShade: '#1F4630',
  mountainCrest: '#7DA35A',
  mountainRock: '#7E776B',
  mountainFar: '#5E8C74',
  mountainFarShade: '#46705F',
  mountainFarCrest: '#83A985',
  mountainFarRock: '#93A0A4',
} as const;

export const NETWORK_COLOR = {
  wired: COLOR.cyan,
  wifi: COLOR.cyan,
  cellular: COLOR.blue,
  satellite: COLOR.violet,
} as const;

export const SPACE = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const RADIUS = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const TYPE = {
  display: '600 clamp(28px, 3.4vw, 46px)/1.04 var(--font-sans)',
  title: '600 18px/1.3 var(--font-sans)',
  body: '400 14px/1.55 var(--font-sans)',
  label: '600 11px/1.2 var(--font-sans)',
  mono: '500 12px/1.4 var(--font-mono)',
} as const;

export type ColorToken = keyof typeof COLOR;
