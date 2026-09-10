'use client';

/**
 * Per-class application health, shown rather than described.
 *
 * The panel this replaces led with three lines of prose explaining what
 * `app_health_v1` is, then a four-column table of numbers. The explanation is
 * still exactly one click away - it is the `title` on the metric name, and the
 * full definition is in `docs/METRICS.md` - but an operator scanning for which
 * traffic class is in trouble needs a bar, not a paragraph.
 *
 * What has not changed: nothing here is invented. A class the engine has not
 * reported does not appear, and a class with no samples yet says so instead of
 * drawing a full green bar.
 */

import type { EngineEvent, TrafficClassId } from '@continua/contracts/engine';

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

/** One line of secondary fact per class - the thing you'd check next. */
function detailFor(cls: TrafficClassId, health: NonNullable<EngineEvent['app']>['classes'][TrafficClassId]) {
  if (!health) return null;
  if (cls === 'telemetry') {
    return health.freshness_ms != null ? `age ${health.freshness_ms.toFixed(0)} ms` : null;
  }
  if (cls === 'video') {
    const stall = health.stall_ms != null ? `${(health.stall_ms / 1000).toFixed(1)} s stalled` : null;
    return `${health.frames_delivered}/${health.frames_expected} frames${stall ? ` · ${stall}` : ''}`;
  }
  if (cls === 'bulk') {
    return `${(health.bytes_completed / 1e6).toFixed(1)} MB complete`;
  }
  return health.p95_latency_ms != null
    ? `p95 ${health.p95_latency_ms.toFixed(0)} ms · ${health.deadline_miss_pct?.toFixed(1) ?? ' - '} % missed`
    : `${health.delivered}/${health.sent} delivered`;
}

export function HealthPanel({ event }: { event: EngineEvent | null }) {
  const app = event?.app ?? null;
  const score = app?.health_score ?? null;
  const scoreTone =
    score === null
      ? 'var(--color-faint)'
      : score >= 85
        ? 'var(--color-good)'
        : score >= 60
          ? 'var(--color-warn)'
          : 'var(--color-bad)';

  const present = CLASS_ORDER.filter((cls) => app?.classes[cls]);

  return (
    <section className="panel px-4 py-3.5">
      <header className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="panel-label">Application health</h2>
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

      <div className="mb-3.5 flex items-end gap-3">
        <span
          className="metric text-[34px] font-semibold leading-none tracking-[-0.035em]"
          style={{ color: scoreTone }}
        >
          {score !== null ? score.toFixed(0) : ' - '}
        </span>
        <div className="flex-1 pb-1">
          <div className="h-[7px] w-full overflow-hidden rounded-full bg-[color:var(--color-surface-muted)]">
            <div
              className="h-full rounded-full transition-[width] duration-500"
              style={{ width: `${score ?? 0}%`, background: scoreTone }}
            />
          </div>

        </div>
      </div>

      {present.length === 0 ? null : (
        <ul className="flex flex-col gap-2.5">
          {present.map((cls) => {
            const health = app!.classes[cls]!;
            const miss = health.deadline_miss_pct;
            const tone = toneFor(miss);
            // Attainment, not miss rate: a full bar is good news, which is how
            // a bar is read at a glance.
            const attainment = miss === null ? null : Math.max(0, 100 - miss);
            return (
              <li key={cls}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[12.5px] font-semibold">{CLASS_LABEL[cls]}</span>
                  <span className="text-[11px] font-semibold" style={{ color: tone.color }}>
                    {tone.label}
                  </span>
                </div>
                <div className="mt-1 h-[5px] w-full overflow-hidden rounded-full bg-[color:var(--color-surface-muted)]">
                  <div
                    className="h-full rounded-full transition-[width] duration-500"
                    style={{
                      width: `${attainment ?? 0}%`,
                      background: attainment === null ? 'transparent' : CLASS_COLOR[cls],
                    }}
                  />
                </div>
                <p className="mt-[3px] text-[11px] leading-tight text-[color:var(--color-muted)]">
                  {detailFor(cls, health) ?? 'no samples in this window'}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
