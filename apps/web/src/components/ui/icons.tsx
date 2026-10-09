/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-93BB6713B483 */
/**
 * The interface's icon set: inline SVG, drawn on a 24-unit grid with a 1.75
 * stroke, inheriting `currentColor`. No icon font, no download.
 *
 * Network glyphs follow the reference material: an Ethernet port, Wi-Fi arcs,
 * a cell mast with radiating sectors, a satellite dish.
 */

import type { EngineLinkId } from '@continua/contracts/engine';
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function WiredIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="5" width="16" height="13" rx="2.5" />
      <path d="M8 18v-3.5h8V18" />
      <path d="M9 9h1M12 9h0.01M14 9h1" strokeWidth={2.2} />
    </Svg>
  );
}

export function WifiIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M2.5 9.2a14 14 0 0 1 19 0" />
      <path d="M5.8 12.6a9.2 9.2 0 0 1 12.4 0" />
      <path d="M9.1 15.9a4.4 4.4 0 0 1 5.8 0" />
      <circle cx="12" cy="19" r="1.15" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function CellularIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 10.5 8.2 21M12 10.5 15.8 21M9.4 17.5h5.2" />
      <circle cx="12" cy="8.5" r="1.6" />
      <path d="M8.3 5.4a5.2 5.2 0 0 0 0 6.2M15.7 5.4a5.2 5.2 0 0 1 0 6.2" />
      <path d="M5.6 3.2a8.6 8.6 0 0 0 0 10.6M18.4 3.2a8.6 8.6 0 0 1 0 10.6" />
    </Svg>
  );
}

export function SatelliteIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 12.5a7 7 0 0 0 7 7L4.5 12.5Z" />
      <path d="M4.5 12.5c0-1.4.4-2.7 1.1-3.8l9.7 9.7a7 7 0 0 1-3.8 1.1" />
      <path d="M8 16l3-3" />
      <path d="M14.5 4.5a5 5 0 0 1 5 5M14.5 8a1.5 1.5 0 0 1 1.5 1.5" />
    </Svg>
  );
}

export function NetworkIcon({ link, ...props }: IconProps & { link: EngineLinkId }) {
  if (link === 'wired') return <WiredIcon {...props} />;
  if (link === 'wifi') return <WifiIcon {...props} />;
  if (link === 'cellular') return <CellularIcon {...props} />;
  return <SatelliteIcon {...props} />;
}

export function PlayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" />
    </Svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8.5 5.5v13M15.5 5.5v13" strokeWidth={2.6} />
    </Svg>
  );
}

export function ResetIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 12a8 8 0 1 0 2.4-5.7" />
      <path d="M4 4.5v4.2h4.2" />
    </Svg>
  );
}

export function ReplayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4.5v4.2h-4.2" />
      <path d="M10.2 9.2v5.6l4.6-2.8-4.6-2.8Z" fill="currentColor" strokeWidth={1.2} />
    </Svg>
  );
}

export function ExpandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </Svg>
  );
}

export function CollapseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" />
    </Svg>
  );
}

export function CompareIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 7h13l-3-3M20 17H7l3 3" />
    </Svg>
  );
}

export function CameraIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="6.5" width="13" height="11" rx="2" />
      <path d="m16 10.5 5-3v9l-5-3" />
    </Svg>
  );
}

export function GatewayIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="6" rx="1.6" />
      <rect x="4" y="14" width="16" height="6" rx="1.6" />
      <path d="M7.5 7h.01M7.5 17h.01" strokeWidth={2.4} />
    </Svg>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m9 6 6 6-6 6" />
    </Svg>
  );
}

/** Camera rides behind the rover. */
export function FollowIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3.5 18.5 20 12 16.2 5.5 20 12 3.5Z" />
    </Svg>
  );
}

/** Camera high above the route. */
export function OverviewIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2v-13Z" />
      <path d="M9 4.5v13M15 6.5v13" />
    </Svg>
  );
}

/** A director cutting between angles. */
export function CinematicIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="8" width="17" height="11.5" rx="2" />
      <path d="M3.5 8 6 4.5h3.2L6.8 8M10.5 8 13 4.5h3.2L13.8 8M17.5 8 19.6 5" />
    </Svg>
  );
}

/** Camera orbiting close to the rover. */
export function CloseupIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="10.5" cy="10.5" r="6.2" />
      <path d="m15.2 15.2 4.8 4.8M10.5 8v5M8 10.5h5" />
    </Svg>
  );
}

/** A loudspeaker with its sound: the story's voice is on. */
export function SpeakerIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 9.5h3l4.5-3.75v12.5L7.5 14.5h-3v-5Z" fill="currentColor" />
      <path d="M15.5 9.25a4 4 0 0 1 0 5.5M18 6.75a7.6 7.6 0 0 1 0 10.5" />
    </Svg>
  );
}

/** A loudspeaker, crossed out: the story's voice is off. */
export function SpeakerOffIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 9.5h3l4.5-3.75v12.5L7.5 14.5h-3v-5Z" fill="currentColor" />
      <path d="M16 9.75l4.5 4.5M20.5 9.75 16 14.25" />
    </Svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  );
}

/** Three sliders: the run's settings - scenario, strategy, comparison. */
export function SlidersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M5 7h8M17 7h2M5 12h2M11 12h8M5 17h6M15 17h4" />
      <circle cx="15" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="13" cy="17" r="2" />
    </Svg>
  );
}

/** A folded map with a mark on it: the road map, seeing a gap ahead. */
export function RoadMapIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 6.5 9 4.5l6 2 5.5-2v13l-5.5 2-6-2-5.5 2v-13Z" />
      <path d="M9 4.5v13M15 6.5v13" />
    </Svg>
  );
}

/** Rings spreading from a mast: where each network reaches. */
export function CoverageIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="8.6" strokeDasharray="2.4 2.4" />
    </Svg>
  );
}

/** A path arcing out and back: the camera flies to each new link. */
export function FlightIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 18c2-8 9-12 15-11" />
      <path d="m16 4.5 3 2.5-2.6 2.9" />
      <circle cx="4.5" cy="18.5" r="1.6" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** A broken link: a rover its operator cannot reach. */
export function LinkLostIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l2.75-2.75a3.5 3.5 0 0 0-5-5L12 7" />
      <path d="M13.5 10.5a3.5 3.5 0 0 0-5 0L5.75 13.25a3.5 3.5 0 0 0 5 5L12 17" />
      <path d="M4 4l2 2M20 20l-2-2" />
    </Svg>
  );
}

/** A compass: a page's guided tour. */
export function GuideIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M15.3 8.7l-2.1 4.5-4.5 2.1 2.1-4.5z" />
    </Svg>
  );
}

/** An arrow pointing left, at whatever stands beside it. */
export function ArrowLeftIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M19 12H6M11 7l-5 5 5 5" />
    </Svg>
  );
}
