'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-FA2598C1436C */

/**
 * The whole route at a glance: where the rover is, which zone it is in, and
 * which site the carrying link reaches - the picture the follow camera cannot
 * give, because it only ever shows the next hundred metres.
 *
 * Geography only. It draws no coverage: the scene's coverage model is the
 * geometric baseline, and a scenario's injected faults (a degrading Wi-Fi, a
 * congested cell) would not show on it, so a coverage strip here would
 * contradict the run it sits beside. Position is the engine's reported
 * distance along the route; nothing is interpolated or predicted.
 *
 * The three concepts stay apart: the route is neutral grey, a site is a dot in
 * its network's colour, and the active link is the single coloured line from
 * the rover to the site carrying the session.
 */

import { LINK_LABEL, type EngineEvent, type EngineLinkId } from '@continua/contracts/engine';
import { MISSION_ZONES, NETWORK_COLOR, route, SITES } from '@continua/scene';
import { useMemo } from 'react';

const PAD = 16; // metres of margin around everything drawn
const WIDTH = 268; // SVG user units == CSS pixels at the panel's width

const NETWORK_SITES = SITES.filter((site) => site.network);
const GATEWAY = SITES.find((site) => site.id === 'facility') ?? null;

// Bounds of the route and every site, fixed for the life of the page.
const BOUNDS = (() => {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  const take = (x: number, z: number) => {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  };
  for (const sample of route.samples) take(sample.x, sample.z);
  for (const site of NETWORK_SITES) take(site.x, site.z);
  if (GATEWAY) take(GATEWAY.x, GATEWAY.z);
  return { minX: minX - PAD, maxX: maxX + PAD, minZ: minZ - PAD, maxZ: maxZ + PAD };
})();

const SCALE = WIDTH / (BOUNDS.maxX - BOUNDS.minX);
const HEIGHT = Math.round((BOUNDS.maxZ - BOUNDS.minZ) * SCALE);
const px = (x: number) => (x - BOUNDS.minX) * SCALE;
const py = (z: number) => (z - BOUNDS.minZ) * SCALE;

/** The route between two distances as one SVG path, sampled every 4 m. */
function pathBetween(from: number, to: number): string {
  const parts: string[] = [];
  const start = route.at(Math.max(0, from));
  parts.push(`M${px(start.x).toFixed(1)} ${py(start.z).toFixed(1)}`);
  for (let i = 0; i < route.samples.length; i += 4) {
    const sample = route.samples[i]!;
    if (sample.distance <= from) continue;
    if (sample.distance >= to) break;
    parts.push(`L${px(sample.x).toFixed(1)} ${py(sample.z).toFixed(1)}`);
  }
  const end = route.at(Math.min(to, route.length));
  parts.push(`L${px(end.x).toFixed(1)} ${py(end.z).toFixed(1)}`);
  return parts.join(' ');
}

const FULL_ROUTE = pathBetween(0, route.length);

/**
 * The stretches of road each link carried the session over, from recorded
 * events: where on the ground the network changed, not just when.
 */
function carriedStretches(
  events: EngineEvent[],
  reverse: boolean,
): { from: number; to: number; at: number; link: EngineLinkId | null }[] {
  const ordered = events.filter((event) => event.vehicle).sort((a, b) => a.t - b.t);
  const out: { from: number; to: number; at: number; link: EngineLinkId | null }[] = [];
  for (const event of ordered) {
    const d = routePosition(event.vehicle!.distance_m, reverse);
    const last = out[out.length - 1];
    if (last && last.link === event.carrying) {
      last.from = Math.min(last.from, d);
      last.to = Math.max(last.to, d);
    } else {
      if (last) {
        last.from = Math.min(last.from, d);
        last.to = Math.max(last.to, d);
      }
      out.push({ from: d, to: d, at: d, link: event.carrying });
    }
  }
  return out.filter((stretch) => stretch.to > stretch.from);
}

/**
 * Events report the distance *travelled*; a reversed run starts at the far end
 * of the route, so its place on the route counts down from there.
 */
function routePosition(travelled: number, reverse: boolean): number {
  return reverse ? route.length - travelled : travelled;
}

/** Zone boundaries, drawn as faint ticks across the route. */
const ZONE_TICKS = MISSION_ZONES.slice(1).map((zone) => {
  const at = route.at(zone.fromDistance);
  return { id: zone.id, x: px(at.x), y: py(at.z) };
});

/** The same rule the 3D beams use: the nearest site of the carrying network. */
function carryingSite(link: EngineLinkId, x: number, z: number) {
  let best: (typeof NETWORK_SITES)[number] | null = null;
  let bestDistance = Infinity;
  for (const site of NETWORK_SITES) {
    if (site.network !== link) continue;
    const distance = Math.hypot(site.x - x, site.z - z);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = site;
    }
  }
  return best;
}

export function RouteMap({
  event,
  events = [],
  reverse = false,
}: {
  event: EngineEvent | null;
  events?: EngineEvent[];
  /** The run drives the route from its far end (the scenario says so). */
  reverse?: boolean;
}) {
  const distance = event?.vehicle?.distance_m ?? null;
  const along = distance === null ? null : routePosition(distance, reverse);
  const zone = along === null ? null : MISSION_ZONES.find((entry) => along < entry.toDistance) ?? MISSION_ZONES.at(-1)!;
  const rover = along === null ? null : route.at(Math.max(0, Math.min(along, route.length)));
  const link = event?.carrying ?? null;
  const site = rover && link ? carryingSite(link, rover.x, rover.z) : null;
  const siteX = site ? site.x + (site.linkOffset?.[0] ?? 0) : 0;
  const siteZ = site ? site.z + (site.linkOffset?.[1] ?? 0) : 0;
  const stretches = useMemo(
    () => carriedStretches(event ? [...events, event] : events, reverse),
    [events, event, reverse],
  );

  return (
    <section className="glass px-4 pt-3 pb-3" aria-label="Route">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="section-label">Route</h2>
        {distance !== null ? (
          <span className="metric text-[11.5px] font-semibold text-[color:var(--color-ink)]">
            {distance.toFixed(0)}
            <span className="font-medium text-[color:var(--color-faint)]"> / {route.length.toFixed(0)} m</span>
          </span>
        ) : (
          <span className="text-[11px] text-[color:var(--color-faint)]">{route.length.toFixed(0)} m</span>
        )}
      </header>

      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full overflow-visible"
        role="img"
        aria-label={
          rover && zone
            ? `Rover ${distance!.toFixed(0)} m along the ${route.length.toFixed(0)} m route, in the ${zone.label.toLowerCase()}${link ? `, carrying on ${LINK_LABEL[link].label}` : ''}.`
            : 'The mission route, its network sites and the session gateway.'
        }
      >
        {/* Route: the whole of it pale; the part already driven painted with
            the link that carried the session along each stretch. */}
        <path d={FULL_ROUTE} fill="none" stroke="var(--color-line-strong)" strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
        {stretches.map((stretch, index) => (
          <path
            key={index}
            d={pathBetween(stretch.from, stretch.to)}
            fill="none"
            stroke={stretch.link ? NETWORK_COLOR[stretch.link] : 'var(--color-bad)'}
            strokeWidth={3.4}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {stretches.slice(1).map((stretch, index) => {
          const at = route.at(stretch.at);
          return (
            <circle key={`h${index}`} cx={px(at.x)} cy={py(at.z)} r={2.2} fill="white" stroke="var(--color-ink)" strokeWidth={1}>
              <title>{`Handoff at ${stretch.at.toFixed(0)} m${stretch.link ? ` to ${LINK_LABEL[stretch.link].label}` : ''}`}</title>
            </circle>
          );
        })}
        {ZONE_TICKS.map((tick) => (
          <line
            key={tick.id}
            x1={tick.x}
            x2={tick.x}
            y1={tick.y - 5}
            y2={tick.y + 5}
            stroke="var(--color-faint)"
            strokeWidth={1}
            strokeLinecap="round"
          />
        ))}

        {/* The session gateway every link terminates at. */}
        {GATEWAY && (
          <rect
            x={px(GATEWAY.x) - 3.5}
            y={py(GATEWAY.z) - 3.5}
            width={7}
            height={7}
            rx={1.6}
            fill="var(--color-ink)"
          >
            <title>{GATEWAY.label} - session gateway</title>
          </rect>
        )}

        {/* Active link: one line, in the carrying network's colour. */}
        {rover && site && link && (
          <line
            x1={px(rover.x)}
            y1={py(rover.z)}
            x2={px(siteX)}
            y2={py(siteZ)}
            stroke={NETWORK_COLOR[link]}
            strokeWidth={1.6}
            strokeLinecap="round"
          />
        )}

        {NETWORK_SITES.map((entry) => {
          const color = NETWORK_COLOR[entry.network!];
          const active = site?.id === entry.id;
          return (
            <circle
              key={entry.id}
              cx={px(entry.x)}
              cy={py(entry.z)}
              r={active ? 4.2 : 3.2}
              fill={active ? color : 'white'}
              stroke={color}
              strokeWidth={1.6}
            >
              <title>{entry.label}</title>
            </circle>
          );
        })}

        {rover && (
          <g>
            <circle cx={px(rover.x)} cy={py(rover.z)} r={7.5} fill="color-mix(in srgb, var(--color-blue) 16%, transparent)" />
            <circle cx={px(rover.x)} cy={py(rover.z)} r={4} fill="white" stroke="var(--color-blue)" strokeWidth={2} />
          </g>
        )}
      </svg>

      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
        <span className="truncate font-semibold text-[color:var(--color-ink)]">
          {zone ? zone.label : <span className="font-medium text-[color:var(--color-faint)]">Start a run to track the rover</span>}
        </span>
        {site && link && (
          <span className="shrink-0 truncate font-medium" style={{ color: NETWORK_COLOR[link] }} title={site.label}>
            via {site.label}
          </span>
        )}
      </div>
    </section>
  );
}
