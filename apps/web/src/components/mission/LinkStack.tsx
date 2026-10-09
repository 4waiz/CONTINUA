'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-2F9BF9A71F49 */

/**
 * The four access links, the selected link's measurements, and whether the
 * session is alive - in one panel instead of eight cards.
 *
 * What this component must never imply: that packets travel wired -> Wi-Fi ->
 * cellular -> satellite in sequence. The links are listed as alternatives to
 * one gateway, the carrying one is the only one drawn solid, a link being
 * warmed breathes, and the rest are just available or not.
 *
 * Every number is a receiver-side measurement from the current event, or the
 * word "unavailable". Wi-Fi is the only link with an RSSI, and it is the only
 * one that ever shows one.
 */

import {
  LINK_IDS,
  LINK_LABEL,
  type EngineEvent,
  type EngineLinkId,
  type EngineLinkObservation,
} from '@continua/contracts/engine';
import { NETWORK_COLOR } from '@continua/scene';
import { useMemo, useState } from 'react';
import { Meter, Sparkline, TimeSeries } from '../ui/charts';
import { GatewayIcon, NetworkIcon } from '../ui/icons';
import { InfoTip } from '../ui/InfoTip';
import { NETWORK } from './plain';

type Phase = 'carrying' | 'warming' | 'ready' | 'unavailable';

function phaseOf(event: EngineEvent | null, link: EngineLinkId): Phase {
  if (!event) return 'unavailable';
  if (event.carrying === link) return 'carrying';
  const observation = event.links[link];
  if (!observation || observation.phase === 'unavailable') return 'unavailable';
  if (observation.phase === 'activating' || observation.phase === 'validating') return 'warming';
  return 'ready';
}

const PHASE_LABEL: Record<Phase, string> = {
  carrying: 'Carrying',
  warming: 'Pre-warming',
  ready: 'Available',
  unavailable: 'Unavailable',
};

/** The same states in plain words, for the simple view. */
function plainPhase(event: EngineEvent | null, link: EngineLinkId, phase: Phase): string {
  if (!event) return 'Waiting for a run';
  if (phase === 'carrying') return 'Carrying the link';
  if (phase === 'warming') return 'Starting up';
  if (phase === 'unavailable') return 'Out of reach';
  return event.links[link]?.phase === 'active' ? 'Ready as backup' : 'In range, off';
}

/** The one figure an operator reads first for each link. */
function headline(observation: EngineLinkObservation | undefined, link: EngineLinkId): { value: string; unit: string } | null {
  if (!observation) return null;
  if (link === 'wifi' && observation.rssi_dbm !== null) return { value: observation.rssi_dbm.toFixed(0), unit: 'dBm' };
  if (observation.rtt_ms !== null) return { value: observation.rtt_ms.toFixed(0), unit: 'ms' };
  return null;
}

type SeriesId = 'rtt' | 'throughput' | 'loss' | 'jitter';

const SERIES: { id: SeriesId; label: string; unit: string; color: string }[] = [
  { id: 'rtt', label: 'RTT', unit: 'ms', color: '#7a3cff' },
  { id: 'throughput', label: 'Rate', unit: 'Mbps', color: '#176bff' },
  { id: 'loss', label: 'Loss', unit: '%', color: '#e5484d' },
  { id: 'jitter', label: 'Jitter', unit: 'ms', color: '#14b8e8' },
];

function Placeholder() {
  // A rule, not a sentence: the reason lives in the accessible name.
  return (
    <span
      className="inline-block h-[3px] w-7 rounded-full bg-[color:var(--color-line-strong)] align-middle"
      title="Waiting for engine"
      aria-label="Waiting for engine"
      role="img"
    />
  );
}

function Stat({ label, value, unit, why }: { label: string; value: number | null | undefined; unit: string; why: string }) {
  const has = value !== null && value !== undefined && Number.isFinite(value);
  return (
    <div className="min-w-0">
      <div className="text-[11px] font-medium text-[color:var(--color-faint)]">{label}</div>
      {has ? (
        <div className="metric mt-0.5 flex items-baseline gap-1">
          <span className="text-[17px] font-semibold leading-none">{value!.toFixed(unit === '%' ? 1 : unit === 'Mb/s' ? 1 : 0)}</span>
          <span className="text-[11px] text-[color:var(--color-muted)]">{unit}</span>
        </div>
      ) : (
        <div className="mt-0.5 text-[12.5px] font-medium text-[color:var(--color-faint)]" title={why}>
          unavailable
        </div>
      )}
    </div>
  );
}

export function LinkStack({
  event,
  history,
  selected,
  onSelect,
  simple = false,
  title,
}: {
  event: EngineEvent | null;
  history: EngineEvent[];
  selected: EngineLinkId;
  onSelect: (link: EngineLinkId) => void;
  /**
   * The simple view: the four networks and what each is doing, in words - no
   * figures, no chart. The measurements are one toggle away (Details).
   */
  simple?: boolean;
  /** Whose networks these are, for the simple view's heading. */
  title?: string;
}) {
  const recent = useMemo(() => history.slice(-72), [history]);
  const series = useMemo(() => {
    const out = {} as Record<EngineLinkId, (number | null)[]>;
    for (const link of LINK_IDS) {
      out[link] = recent.map((entry) => {
        const observation = entry.links[link];
        if (!observation) return null;
        return link === 'wifi' && observation.rssi_dbm !== null ? observation.rssi_dbm : observation.rtt_ms;
      });
    }
    return out;
  }, [recent]);

  const observation = event?.links[selected];
  const colour = NETWORK_COLOR[selected];
  const app = event?.app ?? null;

  // Live telemetry for the selected link: one chart, an explicit series toggle.
  const [chart, setChart] = useState<SeriesId>('rtt');
  const window = history.slice(-180);
  const spec = SERIES.find((entry) => entry.id === chart)!;
  const chartValues = window.map((entry) => {
    const obs = entry.links[selected];
    if (!obs) return null;
    if (chart === 'rtt') return obs.rtt_ms;
    if (chart === 'throughput') return obs.throughput_mbps;
    if (chart === 'loss') return obs.loss_pct;
    return obs.jitter_ms;
  });
  const first = window[0]?.t ?? 0;
  const last = window[window.length - 1]?.t ?? 0;

  return (
    <section className="glass flex min-h-0 flex-col" aria-label="Access links" data-tour="mission-networks">
      <header className="flex items-center justify-between px-4 pt-3.5 pb-2">
        <h2 className="section-label flex items-center gap-1.5">
          {simple ? (title ?? 'Networks') : 'Access links'}
          <InfoTip align="start" text="Four ways to reach the rover. Only one carries the link at a time; CONTINUA readies the next one before it is needed. Details shows each network's measurements." />
        </h2>
        {!simple && (
          <span
            className="flex cursor-help items-center gap-1.5 text-[11px] font-medium text-[color:var(--color-faint)]"
            title="Four alternative paths to one session gateway - not a chain traffic passes through in sequence. At most one carries the session."
          >
            <GatewayIcon size={13} /> 4 paths · 1 gateway
          </span>
        )}
      </header>

      <ul className="flex flex-col gap-1 px-2">
        {LINK_IDS.map((link) => {
          const phase = phaseOf(event, link);
          const obs = event?.links[link];
          const figure = headline(obs, link);
          const color = NETWORK_COLOR[link];
          const carrying = phase === 'carrying';
          const isSelected = selected === link;
          return (
            <li key={link}>
              <button
                type="button"
                onClick={() => onSelect(link)}
                aria-pressed={isSelected}
                className={`group relative flex w-full items-center gap-3 rounded-[13px] px-2.5 text-left transition-colors ${simple ? 'py-1.5' : 'py-2'}`}
                style={{
                  background: carrying
                    ? `color-mix(in srgb, ${color} 9%, white)`
                    : isSelected
                      ? 'var(--color-surface-muted)'
                      : 'transparent',
                  boxShadow: isSelected ? `inset 0 0 0 1px color-mix(in srgb, ${color} 40%, transparent)` : undefined,
                  opacity: phase === 'unavailable' && event ? 0.55 : 1,
                }}
              >
                {carrying && (
                  <span aria-hidden className="absolute top-2 bottom-2 left-0 w-[3px] rounded-full" style={{ background: color }} />
                )}
                <span
                  className={`grid shrink-0 place-items-center rounded-full ${simple ? 'h-8 w-8' : 'h-9 w-9'} ${phase === 'warming' ? 'breathe' : ''}`}
                  style={{
                    background: carrying ? color : `color-mix(in srgb, ${color} 12%, white)`,
                    color: carrying ? 'white' : color,
                    boxShadow: carrying ? `0 0 0 4px color-mix(in srgb, ${color} 16%, transparent)` : undefined,
                  }}
                >
                  <NetworkIcon link={link} size={18} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[13.5px] font-semibold leading-tight text-[color:var(--color-ink)]">
                    {simple ? NETWORK[link].name : LINK_LABEL[link].label}
                  </span>
                  {simple ? (
                    <span
                      className="mt-[2px] block text-[12px] font-medium"
                      style={{ color: carrying || phase === 'warming' ? color : 'var(--color-faint)' }}
                    >
                      {plainPhase(event, link, phase)}
                    </span>
                  ) : (
                    <span
                      className="mt-[3px] block text-[11px] font-semibold tracking-[0.04em] uppercase"
                      style={{ color: carrying || phase === 'warming' ? color : 'var(--color-faint)' }}
                    >
                      {PHASE_LABEL[phase]}
                    </span>
                  )}
                </span>
                <span className={`flex w-[84px] shrink-0 flex-col items-end gap-1 ${simple ? 'hidden' : ''}`}>
                  {figure ? (
                    <span className="metric text-[15px] font-semibold leading-none text-[color:var(--color-ink)]">
                      {figure.value}
                      <span className="ml-0.5 text-[11px] font-medium text-[color:var(--color-muted)]">{figure.unit}</span>
                    </span>
                  ) : !event ? (
                    <Placeholder />
                  ) : phase === 'unavailable' ? null : (
                    // The link is up but has no acknowledged samples yet: name
                    // which measurement is missing, so "Available" next to a
                    // bare "unavailable" cannot read as a contradiction.
                    <span className="text-[11px] font-medium whitespace-nowrap text-[color:var(--color-faint)]">
                      RTT unavailable
                    </span>
                  )}
                  <span className="block h-[16px] w-full">
                    {series[link].some((v) => v !== null) && (
                      <Sparkline values={series[link]} color={color} width={84} height={16} fill={false} />
                    )}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {/* The simple view says what the four are in its "?"; a sentence under
          them said it again. */}
      {simple ? (
        <div className="h-2" aria-hidden />
      ) : !event ? (
        // Before a run there is nothing to measure: one line saying what will
        // be here, not three cards of "unavailable" and an empty chart.
        <div className="mx-3 mt-2 mb-3 rounded-[14px] border border-dashed border-[color:var(--color-line-strong)] px-3.5 py-3">
          <div className="section-label">Measurements</div>
          <p className="mt-1 text-[12px] leading-snug text-[color:var(--color-muted)]">
            Each link&apos;s round trip, loss, jitter and throughput, its telemetry and whether the session is alive -
            as the receiver measures them, once a run starts.
          </p>
        </div>
      ) : (
        <>
          {/* The selected link, in full. */}
          <div className="mx-3 mt-2 rounded-[14px] border border-[color:var(--color-line)] bg-white/70 px-3.5 py-3">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="flex min-w-0 items-center gap-2 text-[12px] font-semibold" style={{ color: colour }}>
                <NetworkIcon link={selected} size={14} className="shrink-0" />
                <span className="shrink-0">{LINK_LABEL[selected].label}</span>
                <span className="truncate font-medium text-[color:var(--color-faint)]">{LINK_LABEL[selected].sublabel}</span>
              </span>
              {observation && (
                <span className="shrink-0 text-[11px] text-[color:var(--color-faint)]">{observation.window_s}s window</span>
              )}
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
              <Stat label="Round trip" value={observation?.rtt_ms} unit="ms" why="Not enough acknowledged packets in the window." />
              <Stat label="Loss" value={observation?.loss_pct} unit="%" why="Fewer than the minimum number of sends in the window." />
              <Stat label="Jitter" value={observation?.jitter_ms} unit="ms" why="Not enough samples for a jitter estimate." />
              <Stat label="Throughput" value={observation?.throughput_mbps} unit="Mb/s" why="No delivered bytes in the window." />
            </div>
            {selected === 'wifi' ? (
              <div className="mt-2.5 flex items-center justify-between border-t border-[color:var(--color-line)] pt-2">
                <span className="text-[11px] font-medium text-[color:var(--color-faint)]">Signal (RSSI)</span>
                <span className="metric text-[13px] font-semibold">
                  {observation?.rssi_dbm != null ? `${observation.rssi_dbm.toFixed(0)} dBm` : <span className="text-[color:var(--color-faint)]">unavailable</span>}
                </span>
              </div>
            ) : (
              <div className="mt-2.5 border-t border-[color:var(--color-line)] pt-2">
                <p className="text-[11px] leading-snug text-[color:var(--color-muted)]">
                  RSSI is a Wi-Fi measurement; {LINK_LABEL[selected].label.toLowerCase()} shows none in this model.
                </p>
                {selected !== 'wired' && (
                  <div className="mt-1.5 flex items-center gap-2" title="Geometric, from distance to infrastructure. Not a measured signal level.">
                    <span className="shrink-0 text-[11px] text-[color:var(--color-faint)]">Modelled coverage</span>
                    <Meter
                      value={observation?.modelled_coverage != null ? observation.modelled_coverage * 100 : null}
                      color={colour}
                      label="modelled coverage"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Live telemetry for the selected link. */}
          <div className="mx-3 mt-2 rounded-[14px] border border-[color:var(--color-line)] bg-white/70 px-3 pt-2.5 pb-2">
            <div className="mb-1.5 grid grid-cols-4 gap-1 rounded-[9px] bg-[color:var(--color-surface-muted)] p-[3px]" role="group" aria-label="Telemetry series">
              {SERIES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setChart(entry.id)}
                  aria-pressed={chart === entry.id}
                  className="rounded-[7px] py-[3px] text-[11px] font-semibold transition"
                  style={{
                    background: chart === entry.id ? 'var(--color-surface)' : 'transparent',
                    color: chart === entry.id ? entry.color : 'var(--color-muted)',
                    boxShadow: chart === entry.id ? '0 1px 2px rgb(17 29 58 / 0.1)' : undefined,
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>
            <TimeSeries
              series={[
                {
                  label: `${LINK_LABEL[selected].label} ${spec.label}`,
                  color: chart === 'throughput' ? colour : spec.color,
                  values: chartValues,
                  unit: spec.unit,
                },
              ]}
              height={62}
              xLabels={[`${first.toFixed(0)}s`, `${((first + last) / 2).toFixed(0)}s`, `${last.toFixed(0)}s`]}
            />
          </div>

          {/* Session continuity: a different claim from application deadlines. */}
          <div className="mx-3 mt-2 mb-3 flex items-center gap-3 rounded-[14px] border border-[color:var(--color-line)] bg-white/70 px-3.5 py-2.5">
            <span
              aria-hidden
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                background: !app ? 'var(--color-line-strong)' : app.in_outage ? 'var(--color-bad)' : 'var(--color-good)',
                boxShadow: app && !app.in_outage ? '0 0 0 4px color-mix(in srgb, var(--color-good) 18%, transparent)' : undefined,
              }}
            />
            <div className="min-w-0 flex-1">
              <div className="section-label">Session</div>
              <div className="text-[13px] font-semibold leading-tight">
                {!app ? <Placeholder /> : app.in_outage ? (
                  <span className="text-[color:var(--color-bad)]">Interrupted{app.safe_stop ? ' · safe stop' : ''}</span>
                ) : (
                  <span className="text-[color:var(--color-good)]">Continuous</span>
                )}
              </div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-[color:var(--color-faint)]">Outage</div>
              <div className="metric text-[13px] font-semibold">{app ? `${app.outage_s.toFixed(2)} s` : <Placeholder />}</div>
            </div>
            <div className="text-right">
              <div className="text-[11px] text-[color:var(--color-faint)]">Reconnects</div>
              <div
                className="metric text-[13px] font-semibold"
                style={{ color: app && app.session_reconnects > 0 ? 'var(--color-bad)' : undefined }}
              >
                {app ? app.session_reconnects : <Placeholder />}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
