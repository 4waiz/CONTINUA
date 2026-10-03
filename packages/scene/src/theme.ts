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
 * Scene-only colours: a pale desert at midday. Warm, light and low in
 * saturation, so the white rover stays the cleanest object in frame and the
 * interface's cyan / blue / violet stay the only strong colours on screen.
 */
export const SCENE_COLOR = {
  sky: '#BFD6F0',
  skyHorizon: '#EEF2F6',
  fog: '#E9EDF1',
  sun: '#FFF3DE',
  /** Graded campus ground: compacted, cooler, lighter than the open desert. */
  campus: '#CFCAC0',
  sandLight: '#ECE1CC',
  sand: '#DDCDAF',
  sandDark: '#C7B391',
  rockTint: '#B9A280',
  concrete: '#C9CDD2',
  road: '#4F5664',
  roadEdge: '#C9C1B1',
  roadLine: '#F4F2EC',
  roadCentre: '#F2C14E',
  apron: '#C6CBD1',
  grid: '#7C93B6',
  ridge: '#CBD3DE',
  ridgeFar: '#DCE2EA',
  /** Kept for callers that still read the Phase 1 names. */
  groundNear: '#DCD8CE',
  groundFar: '#DDCDAF',
  groundHigh: '#ECE1CC',
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
