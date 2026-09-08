'use client';

/**
 * The four access networks, drawn as what they actually are.
 *
 * The reference artwork places Wired → Wi-Fi → 5G → Satellite in a row joined by
 * one flowing line, which reads as a chain packets travel through in sequence.
 * They are not: they are four *alternative* links to a single session gateway,
 * and exactly one of them carries the session at a time.
 *
 * So this draws a fan — four candidates converging on one gateway — with the
 * carrying link solid, a pre-warming link dashed, available links faint, and
 * anything out of coverage greyed.
 */

import {
  ACCESS_NETWORK_META,
  ACCESS_NETWORKS,
  type AccessNetworkId,
  type SceneState,
} from '@continua/contracts';
import { NETWORK_COLOR } from '@continua/scene';

const ICONS: Record<AccessNetworkId, string> = {
  // Simple, legible glyph paths on a 24×24 grid.
  wired: 'M4 9h16v9H4zM7 9V6h10v3M8 18v2M16 18v2M8.5 12v3M12 12v3M15.5 12v3',
  wifi: 'M2.6 8.6a15 15 0 0 1 18.8 0M5.6 12.2a10.4 10.4 0 0 1 12.8 0M8.7 15.8a5.8 5.8 0 0 1 6.6 0M12 19.4h.01',
  cellular: 'M12 12.6a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM12 12.6V21M8.4 6.4a6 6 0 0 0 0 7.8M15.6 6.4a6 6 0 0 1 0 7.8M5.8 3.4a10 10 0 0 0 0 13.8M18.2 3.4a10 10 0 0 1 0 13.8',
  satellite:
    'M3.5 19.5h17M12 19.5v-4M4.6 12.4a9 9 0 0 1 12.7-8.1L6.9 14.9a8.9 8.9 0 0 1-2.3-2.5zM16 8.6l3.4-3.4',
};

const WIDTH = 660;
const HEIGHT = 190;

export function LinkFan({ state }: { state: SceneState }) {
  const gateway = { x: WIDTH / 2, y: HEIGHT - 26 };
  const nodes = ACCESS_NETWORKS.map((id, index) => ({
    id,
    x: 84 + index * ((WIDTH - 168) / (ACCESS_NETWORKS.length - 1)),
    y: 52,
  }));

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full"
      role="img"
      aria-label="Four alternative access links converging on one session gateway"
    >
      <title>Access links to the session gateway</title>

      {nodes.map((node) => {
        const link = state.links[node.id];
        const carrying = link.state === 'active' || link.state === 'degraded';
        const warming = link.state === 'warming';
        const available = link.state === 'available';
        if (node.id === 'wired' && !link.tethered) return null;

        const midY = (node.y + gateway.y) / 2;
        const path = `M ${node.x} ${node.y + 26} C ${node.x} ${midY}, ${gateway.x} ${midY}, ${gateway.x} ${gateway.y - 20}`;
        return (
          <path
            key={`edge-${node.id}`}
            d={path}
            fill="none"
            stroke={NETWORK_COLOR[node.id]}
            strokeWidth={carrying ? 3 : 1.5}
            strokeLinecap="round"
            strokeDasharray={warming ? '6 6' : undefined}
            opacity={carrying ? 0.95 : warming ? 0.6 : available ? 0.22 : 0.08}
          />
        );
      })}

      {nodes.map((node) => {
        const link = state.links[node.id];
        const meta = ACCESS_NETWORK_META[node.id];
        const carrying = link.state === 'active' || link.state === 'degraded';
        const off = link.state === 'unavailable' || (node.id === 'wired' && !link.tethered);
        const colour = NETWORK_COLOR[node.id];

        return (
          <g key={node.id} opacity={off ? 0.34 : 1}>
            <circle
              cx={node.x}
              cy={node.y}
              r={25}
              fill="#fff"
              stroke={off ? '#CCD8EC' : colour}
              strokeWidth={carrying ? 2.4 : 1.4}
            />
            {carrying && (
              <circle cx={node.x} cy={node.y} r={31} fill="none" stroke={colour} strokeWidth={1} opacity={0.35} />
            )}
            <g
              transform={`translate(${node.x - 12} ${node.y - 12})`}
              stroke={off ? '#8A9AB5' : colour}
              strokeWidth={1.7}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            >
              <path d={ICONS[node.id]} />
            </g>
            <text
              x={node.x}
              y={node.y + 46}
              textAnchor="middle"
              fontSize="13"
              fontWeight="600"
              fill={off ? '#8A9AB5' : colour}
            >
              {meta.label}
            </text>
            <text x={node.x} y={node.y + 61} textAnchor="middle" fontSize="10.5" fill="#667593">
              {meta.sublabel}
            </text>
          </g>
        );
      })}

      <g>
        <rect
          x={gateway.x - 78}
          y={gateway.y - 19}
          width={156}
          height={34}
          rx={17}
          fill="#fff"
          stroke="#CCD8EC"
        />
        <circle cx={gateway.x - 58} cy={gateway.y - 2} r={4} fill="#12B981" />
        <text x={gateway.x + 6} y={gateway.y + 2.5} textAnchor="middle" fontSize="12" fontWeight="600" fill="#14213D">
          Session gateway
        </text>
      </g>
    </svg>
  );
}
