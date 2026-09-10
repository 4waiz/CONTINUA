'use client';

/**
 * Decision Log - the audit trail.
 *
 * Every row is an action the controller actually took, with the observations it
 * was based on, the policy version and which predictor produced the prediction.
 * These were written at decision time and read back from the run's JSONL file;
 * none of it is reconstructed after the fact.
 */

import { api, EngineApiError, type RunRow } from '@/lib/api';
import {
  ACTION_LABEL,
  CONTROLLER_STATE_LABEL,
  LINK_LABEL,
  STAGE_LABEL,
  parseEngineEvent,
  type EngineEvent,
} from '@continua/contracts/engine';
import { NETWORK_COLOR } from '@continua/scene';
import { useEffect, useState } from 'react';
import { AppShell } from './AppShell';
import { Chip, Panel } from './ui/primitives';

export function DecisionLogView() {
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [pickedRunId, setPickedRunId] = useState<string | null>(null);
  // The loaded payload carries the run id it belongs to, so "still loading" is
  // derived rather than tracked with a flag set synchronously from an effect.
  const [loaded, setLoaded] = useState<{
    runId: string;
    events: EngineEvent[];
    metrics: Record<string, unknown> | null;
  } | null>(null);
  const [selected, setSelected] = useState<EngineEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlyActions, setOnlyActions] = useState(true);

  useEffect(() => {
    api
      .listRuns(60)
      .then((r) => setRuns(r.runs))
      .catch((cause: unknown) =>
        setError(cause instanceof EngineApiError ? cause.message : 'Engine unreachable.'),
      );
  }, []);

  // Default to the newest run that actually recorded events. Derived rather
  // than assigned from an effect, so the first render already has a selection.
  const runId = pickedRunId ?? runs.find((row) => row.events > 0)?.run_id ?? null;

  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    // Everything is written after the await, so nothing sets state synchronously
    // inside the effect body.
    Promise.all([api.getRunEvents(runId, 0, 6000), api.getRunMetrics(runId).catch(() => null)])
      .then(([payload, runMetrics]) => {
        if (cancelled) return;
        const parsed = payload.events
          .map((raw) => parseEngineEvent(raw))
          .filter((event): event is EngineEvent => event !== null);
        setLoaded({ runId, events: parsed, metrics: runMetrics });
        setSelected(null);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setLoaded({ runId, events: [], metrics: null });
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  const events = loaded?.runId === runId ? loaded.events : [];
  const metrics = loaded?.runId === runId ? loaded.metrics : null;
  const loading = runId !== null && loaded?.runId !== runId;

  const rows = onlyActions
    ? events.filter((event) => event.action && event.action.kind !== 'none')
    : events;

  const run = runs.find((row) => row.run_id === runId) ?? null;

  return (
    <AppShell>
      <div className="grid h-full min-h-0 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-3 xl:grid-cols-[286px_minmax(0,1fr)_336px]">
        <Panel title="Recorded runs" className="flex min-h-0 flex-col">
          {error && <p className="mb-2 text-[11.5px] text-[color:var(--color-bad)]">{error}</p>}
          {runs.length === 0 ? (
            <p className="text-[11.5px] text-[color:var(--color-muted)]">
              No runs recorded yet. Start one from Mission.
            </p>
          ) : (
            <ul className="scroll-y flex-1 space-y-1">
              {runs.map((row) => (
                <li key={row.run_id}>
                  <button
                    type="button"
                    className="control w-full flex-col !h-auto items-start gap-0.5 py-1.5"
                    data-active={row.run_id === runId}
                    onClick={() => setPickedRunId(row.run_id)}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="truncate font-semibold">{row.scenario_id}</span>
                      <span className="shrink-0 text-[11px] text-[color:var(--color-muted)]">
                        {row.policy_id}
                      </span>
                    </span>
                    <span className="flex w-full items-center justify-between gap-2 text-[11px] font-normal text-[color:var(--color-muted)]">
                      <span className="font-[family-name:var(--font-mono)]">{row.run_id}</span>
                      <span>{row.events} ev</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          className="flex min-h-0 flex-col"
          title={`Decisions${run ? ` · ${run.scenario_id} · ${run.policy_id}` : ''}`}
          action={
            <button
              type="button"
              className="control h-7 text-[11px]"
              data-active={onlyActions}
              onClick={() => setOnlyActions((value) => !value)}
            >
              {onlyActions ? 'Actions only' : 'All events'}
            </button>
          }
        >
          {loading ? (
            <p className="text-[11.5px] text-[color:var(--color-muted)]">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-[11.5px] text-[color:var(--color-muted)]">
              No {onlyActions ? 'actions' : 'events'} recorded for this run.
            </p>
          ) : (
            <ul className="scroll-y flex-1 space-y-1">
              {rows.map((event) => (
                <li key={event.seq}>
                  <button
                    type="button"
                    onClick={() => setSelected(event)}
                    className="w-full rounded-[8px] border px-2.5 py-1.5 text-left transition-colors"
                    style={{
                      borderColor:
                        selected?.seq === event.seq ? 'var(--color-blue)' : 'var(--color-line)',
                      background:
                        selected?.seq === event.seq
                          ? 'color-mix(in srgb, var(--color-blue) 6%, white)'
                          : undefined,
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="metric w-[54px] shrink-0 font-[family-name:var(--font-mono)] text-[11px] text-[color:var(--color-muted)]">
                        t+{event.t.toFixed(1)}s
                      </span>
                      <Chip tone="blue">{STAGE_LABEL[event.stage]}</Chip>
                      <Chip tone="muted">{ACTION_LABEL[event.action?.kind ?? 'none']}</Chip>
                      {event.carrying && (
                        <span
                          className="text-[11px] font-semibold"
                          style={{ color: NETWORK_COLOR[event.carrying] }}
                        >
                          {LINK_LABEL[event.carrying].label}
                        </span>
                      )}
                      <span className="ml-auto text-[11px] text-[color:var(--color-muted)]">
                        #{event.seq}
                      </span>
                    </div>
                    <p className="mt-1 text-[11.5px] leading-snug">{event.reason}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="scroll-y flex flex-col gap-3 pr-0.5">
          <Panel title="Decision detail">
            {!selected ? (
              <p className="text-[11.5px] text-[color:var(--color-muted)]">
                Select a decision to see the observations it was based on.
              </p>
            ) : (
              <div className="space-y-2.5 text-[11.5px]">
                <div>
                  <div className="panel-label">State</div>
                  <div className="font-semibold">
                    {CONTROLLER_STATE_LABEL[selected.controller_state]}
                  </div>
                </div>
                <div>
                  <div className="panel-label">Reason recorded at decision time</div>
                  <p className="leading-snug">{selected.reason}</p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <div className="panel-label">Policy</div>
                    <div className="metric font-[family-name:var(--font-mono)] text-[11px]">
                      {selected.policy_id} · {selected.policy_version}
                    </div>
                  </div>
                  <div>
                    <div className="panel-label">Predictor</div>
                    <div className="metric font-[family-name:var(--font-mono)] text-[11px]">
                      {selected.prediction?.predictor ?? 'none'}
                    </div>
                  </div>
                </div>

                {selected.prediction && (
                  <div className="rounded-[8px] border border-[color:var(--color-line)] p-2">
                    <div className="panel-label mb-1">Prediction</div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Chip tone={selected.prediction.violation_expected ? 'violet' : 'muted'}>
                        {selected.prediction.violation_expected ? 'violation expected' : 'no violation'}
                      </Chip>
                      <span className="text-[11px] text-[color:var(--color-muted)]">
                        horizon {selected.prediction.horizon_s}s
                      </span>
                      {selected.prediction.score !== null && (
                        <span
                          className="text-[11px]"
                          title={
                            selected.prediction.calibrated
                              ? 'Calibrated probability.'
                              : 'Uncalibrated score - deliberately not labelled a probability.'
                          }
                        >
                          score {selected.prediction.score}
                          {selected.prediction.calibrated ? '' : ' (uncalibrated)'}
                        </span>
                      )}
                    </div>
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-[11px] text-[color:var(--color-muted)]">
                        Features used
                      </summary>
                      <dl className="mt-1 grid grid-cols-2 gap-x-2 text-[11px]">
                        {Object.entries(selected.prediction.features).map(([key, value]) => (
                          <div key={key} className="flex justify-between gap-1">
                            <dt className="truncate text-[color:var(--color-muted)]">{key}</dt>
                            <dd className="metric">{value}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </div>
                )}

                <div>
                  <div className="panel-label mb-1">Observations at that instant</div>
                  <table className="w-full border-collapse text-[11px]">
                    <thead>
                      <tr className="text-left text-[color:var(--color-muted)]">
                        <th className="font-medium">Link</th>
                        <th className="text-right font-medium">Phase</th>
                        <th className="text-right font-medium">RTT</th>
                        <th className="text-right font-medium">Loss</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(selected.links).map(([link, obs]) => (
                        <tr key={link} className="border-t border-[color:var(--color-line)]">
                          <td className="py-0.5 font-medium">{link}</td>
                          <td className="py-0.5 text-right">{obs?.phase}</td>
                          <td className="metric py-0.5 text-right">
                            {obs?.rtt_ms != null ? `${obs.rtt_ms.toFixed(0)}ms` : ' - '}
                          </td>
                          <td className="metric py-0.5 text-right">
                            {obs?.loss_pct != null ? `${obs.loss_pct.toFixed(1)}%` : ' - '}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </Panel>

          {metrics && (
            <Panel title="Run metrics">
              <pre className="scroll-y max-h-[42vh] rounded-[8px] bg-[color:var(--color-surface-muted)] p-2 font-[family-name:var(--font-mono)] text-[11px] leading-snug">
                {JSON.stringify(metrics, null, 2)}
              </pre>
            </Panel>
          )}
        </div>
      </div>
    </AppShell>
  );
}
