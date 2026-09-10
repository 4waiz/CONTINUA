'use client';

/**
 * Observe → Predict → Prepare → Steer → Explain, as the product's spine.
 *
 * The stage shown as current is the one the **engine** reports in
 * `event.stage`; it is not inferred from the UI's own idea of what should be
 * happening. The message under the active stage is the reason string the
 * controller wrote at decision time, not a caption composed here — which is the
 * whole point of the Explain step existing at all.
 */

import type { EngineEvent, PipelineStageId } from '@continua/contracts/engine';

interface Stage {
  id: PipelineStageId;
  index: string;
  title: string;
  blurb: string;
  color: string;
}

/** Cyan → violet across the five, matching the network rail's gradient. */
const STAGES: Stage[] = [
  { id: 'observe', index: '01', title: 'OBSERVE', blurb: 'Monitor link quality', color: '#14b8e8' },
  { id: 'predict', index: '02', title: 'PREDICT', blurb: 'Estimate QoE risk', color: '#1b9df1' },
  { id: 'prepare', index: '03', title: 'PREPARE', blurb: 'Warm backup path', color: '#176bff' },
  { id: 'steer', index: '04', title: 'STEER', blurb: 'Switch or split traffic', color: '#5156e8' },
  { id: 'explain', index: '05', title: 'EXPLAIN', blurb: 'Record the decision', color: '#7a3cff' },
];

export function PipelineRail({ event }: { event: EngineEvent | null }) {
  const current = event?.stage ?? null;
  const activeIndex = current ? STAGES.findIndex((stage) => stage.id === current) : -1;

  return (
    <section className="panel px-4 py-3" aria-label="Continuity pipeline">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <h2 className="panel-label">Continuity pipeline</h2>
        <p className="min-w-0 flex-1 truncate text-right text-[12px] text-[color:var(--color-muted)]">
          {event?.reason ? (
            <>
              <span className="font-semibold text-[color:var(--color-ink)]">
                {current ? STAGES.find((s) => s.id === current)?.title : 'STATE'}
              </span>
              <span className="mx-1.5 text-[color:var(--color-line-strong)]">·</span>
              {event.reason}
            </>
          ) : (
            'Waiting for the engine to report a stage.'
          )}
        </p>
      </div>

      <ol className="grid grid-cols-5 gap-2">
        {STAGES.map((stage, index) => {
          const active = index === activeIndex;
          const done = activeIndex > index;
          return (
            <li key={stage.id}>
              <div
                className="relative flex h-full flex-col gap-1 rounded-[14px] border px-3 py-2.5 transition"
                style={{
                  borderColor: active
                    ? `color-mix(in srgb, ${stage.color} 45%, transparent)`
                    : 'var(--color-line)',
                  background: active
                    ? `color-mix(in srgb, ${stage.color} 7%, white)`
                    : 'var(--color-surface)',
                  boxShadow: active
                    ? `0 0 0 3px color-mix(in srgb, ${stage.color} 10%, transparent), var(--shadow-panel)`
                    : undefined,
                  opacity: activeIndex === -1 ? 0.72 : done || active ? 1 : 0.55,
                }}
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className="metric text-[11px] font-bold tracking-[0.06em]"
                    style={{ color: stage.color }}
                  >
                    {stage.index}
                  </span>
                  <span
                    className="text-[13px] font-bold tracking-[0.05em]"
                    style={{ color: active ? stage.color : 'var(--color-ink)' }}
                  >
                    {stage.title}
                  </span>
                </div>
                <span className="text-[11.5px] leading-snug text-[color:var(--color-muted)]">
                  {stage.blurb}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
