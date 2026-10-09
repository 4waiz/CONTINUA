'use client';
/* Copyright (c) 2026 Kanban Studios F.Z.E. All rights reserved. Proprietary - see LICENSE. KS-CONTINUA-854DFF69FB2C */

/**
 * Application health: a gauge and five bars - an operator scanning for which
 * traffic class is in trouble needs a bar, not a paragraph. The definition of
 * the score is one hover away (and in docs/METRICS.md).
 *
 * Nothing here is invented: a class the engine has not reported does not
 * appear, a class with no samples says so instead of drawing a full bar, and a
 * chart gap is a gap.
 */

import {
  CONTROL_MODE_LABEL,
  LINK_LABEL,
  classPathOf,
  controlModeOf,
  type EngineEvent,
  type TrafficClassId,
} from '@continua/contracts/engine';
import { NETWORK_COLOR } from '@continua/scene';

const CLASS_ORDER: TrafficClassId[] = ['control', 'telemetry', 'video', 'voice', 'bulk'];

const CLASS_LABEL: Record<TrafficClassId, string> = {
  control: 'Command',
  telemetry: 'Telemetry',
  video: 'Video',
  voice: 'Voice',
  bulk: 'Bulk logs',
};

/** Priority colour: what gets protected first when capacity is short. */
const CLASS_COLOR: Record<TrafficClassId, string> = {
  control: '#176bff',
  telemetry: '#14b8e8',
  video: '#5156e8',
  voice: '#0db982',
  bulk: '#8995ab',
};

function toneFor(missPct: number | null): { color: string; label: string } {
  if (missPct === null) return { color: 'var(--color-faint)', label: 'no samples' };
  if (missPct <= 2) return { color: 'var(--color-good)', label: 'Healthy' };
  if (missPct <= 10) return { color: 'var(--color-warn)', label: 'Strained' };
  return { color: 'var(--color-bad)', label: 'Degraded' };
}

function detailFor(cls: TrafficClassId, health: NonNullable<EngineEvent['app']>['classes'][TrafficClassId]) {
  if (!health) return null;
  if (cls === 'telemetry') return health.freshness_ms != null ? `age ${health.freshness_ms.toFixed(0)} ms` : null;
  if (cls === 'video') {
    const stall = health.stall_ms != null ? ` · ${(health.stall_ms / 1000).toFixed(1)} s stalled` : '';
    return `${health.frames_delivered}/${health.frames_expected} frames${stall}`;
  }
  if (cls === 'bulk') return `${(health.bytes_completed / 1e6).toFixed(1)} MB complete`;
  return health.p95_latency_ms != null
    ? `p95 ${health.p95_latency_ms.toFixed(0)} ms · ${health.deadline_miss_pct?.toFixed(1) ?? ' - '} % missed`
    : `${health.delivered}/${health.sent} delivered`;
}

/** A 270-degree ring gauge. `null` draws only the track. */
function Gauge({ value, color }: { value: number | null; color: string }) {
  const size = 104;
  const stroke = 9;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const arc = circumference * 0.75;
  const filled = value === null ? 0 : (Math.max(0, Math.min(100, value)) / 100) * arc;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      <g transform={`rotate(135 ${size / 2} ${size / 2})`}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-surface-muted)"
          strokeWidth={stroke}
          strokeDasharray={`${arc} ${circumference}`}
          strokeLinecap="round"
        />
        {value !== null && (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeDasharray={`${filled} ${circumference}`}
            strokeLinecap="round"
            style={{ transition: 'stroke-dasharray 500ms ease' }}
          />
        )}
      </g>
    </svg>
  );
}

export function ApplicationPanel({ event }: { event: EngineEvent | null }) {
  const app = event?.app ?? null;
  const score = app?.health_score ?? null;
  const scoreTone =
    score === null ? 'var(--color-faint)' : score >= 85 ? 'var(--color-good)' : score >= 60 ? 'var(--color-warn)' : 'var(--color-bad)';
  const present = CLASS_ORDER.filter((cls) => app?.classes[cls]);
  const mode = controlModeOf(event);
  const modeTone = mode === 'teleop' ? 'var(--color-good)' : mode === 'waypoint' ? 'var(--color-warn)' : 'var(--color-bad)';
  const steered = Boolean(event?.carrying) && CLASS_ORDER.some((cls) => classPathOf(event, cls) !== event?.carrying);


  return (
    <section className="glass flex min-h-0 flex-col" aria-label="Application health">
      <header className="flex items-baseline justify-between px-4 pt-3.5 pb-1">
        <h2 className="section-label">Application health</h2>
        <span
          className="cursor-help text-[11px] text-[color:var(--color-faint)] underline decoration-dotted underline-offset-2"
          title={
            app?.health_definition ??
            'app_health_v1 - weighted mean of per-class deadline attainment, reproducible from the receiver logs. Full definition in docs/METRICS.md.'
          }
        >
          app_health_v1
        </span>
      </header>

      <div className="flex items-center gap-3 px-4">
        <div className="relative">
          <Gauge value={score} color={scoreTone} />
          <div className="absolute inset-0 grid place-items-center">
            <div className="text-center leading-none">
              {score !== null ? (
                <span className="metric text-[30px] font-semibold tracking-[-0.03em]" style={{ color: scoreTone }}>
                  {score.toFixed(0)}
                </span>
              ) : (
                <span
                  className="inline-block h-[3px] w-7 rounded-full bg-[color:var(--color-line-strong)]"
                  title="Waiting for engine"
                  aria-label="Waiting for engine"
                  role="img"
                />
              )}
              <div className="mt-1 text-[11px] font-semibold tracking-[0.06em] text-[color:var(--color-faint)]">/ 100</div>
            </div>
          </div>
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[12px] leading-snug text-[color:var(--color-muted)]">
            Weighted deadline attainment across the enabled traffic classes.
          </div>
          {event && (
            <div className="mt-2 flex items-center justify-between gap-2 rounded-[10px] bg-[color:var(--color-surface-muted)] px-2.5 py-1.5">
              <span
                className="cursor-help text-[11.5px] font-medium text-[color:var(--color-muted)]"
                title="Operating mode of the control class, chosen from receiver-side RTT and loss on the path control is on. Teleop: 20 Hz against 150 ms. Waypoint: 2 Hz against 1500 ms. Safe hold: no commands. Policies without mode handover stay in teleop."
              >
                Command mode
              </span>
              <span className="text-[11.5px] font-bold tracking-[0.06em] uppercase" style={{ color: modeTone }}>
                {CONTROL_MODE_LABEL[mode]}
              </span>
            </div>
          )}
        </div>
      </div>

      {present.length > 0 && (
        <ul className="mt-2.5 flex flex-col gap-2 px-4">
          {present.map((cls) => {
            const health = app!.classes[cls]!;
            const miss = health.deadline_miss_pct;
            const tone = toneFor(miss);
            const attainment = miss === null ? null : Math.max(0, 100 - miss);
            const path = classPathOf(event, cls);
            return (
              <li key={cls}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-semibold">
                    {CLASS_LABEL[cls]}
                    {steered && path && (
                      <span
                        className="ml-1.5 text-[11px] font-semibold tracking-[0.04em] uppercase"
                        style={{ color: NETWORK_COLOR[path] }}
                        title={
                          path === event?.carrying
                            ? "Riding the session's primary path."
                            : "Steered onto its own active path by the controller; the session's primary path is unchanged."
                        }
                      >
                        via {LINK_LABEL[path].label}
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] font-semibold" style={{ color: tone.color }}>
                    {tone.label}
                  </span>
                </div>
                <div className="mt-1 h-[5px] w-full overflow-hidden rounded-full bg-[color:var(--color-surface-muted)]">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{ width: `${attainment ?? 0}%`, background: attainment === null ? 'transparent' : CLASS_COLOR[cls] }}
                  />
                </div>
                <p className="mt-[3px] truncate text-[11px] leading-tight text-[color:var(--color-muted)]">
                  {detailFor(cls, health) ?? 'no samples in this window'}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <div className="pb-3.5" />
    </section>
  );
}
