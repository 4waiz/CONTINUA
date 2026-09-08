/**
 * CONTINUA design tokens.
 *
 * One source of truth for both the 3D scene and the dashboard chrome, so a
 * violet in the link beam is the same violet as the satellite chip. Light mode
 * only — see docs/DESIGN_SPEC.md.
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

/** Scene-only colours. Deliberately desaturated so the vehicle stays the hero. */
export const SCENE_COLOR = {
  sky: '#EDF3FD',
  skyHorizon: '#FBFCFE',
  fog: '#EEF3FB',
  groundNear: '#D3DCEB',
  groundFar: '#DFD6C4',
  groundHigh: '#EFE9DD',
  road: '#A9B4C7',
  roadEdge: '#CBD4E3',
  roadCentre: '#E9EEF7',
  apron: '#C9D3E3',
  grid: '#93A8C6',
  ridge: '#DDE5F2',
  ridgeFar: '#E8EDF6',
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
