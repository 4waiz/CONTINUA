'use client';

/**
 * Experiments — run the paired comparison, read the result honestly.
 *
 * The table reports means with 95 % confidence intervals and the number of
 * completed trials. Where CONTINUA loses, it says so: the paired-delta column
 * is signed and labelled, not filtered.
 */

import { api, EngineApiError, type CapabilityReport, type ScenarioSpec } from '@/lib/api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppShell } from './AppShell';
import { Chip, Panel } from './ui/primitives';

const POLICY_NOTE: Record<string, string> = {
  B0: 'Single-path reactive. One activated path; an address change ends the session.',
  B1: 'Reactive multipath. Activates a backup only after degradation is measured.',
  B2: 'Always-active redundancy. Every usable path activated, control always duplicated.',
  P1: 'CONTINUA. Predictive, application-aware.',
  'P1-noPred': 'Ablation: CONTINUA without prediction.',
  'P1-noApp': 'Ablation: CONTINUA without application priorities.',
};

const HEADLINE_METRICS: { key: string; label: string; unit: string; lowerIsBetter: boolean }[] = [
  { key: 'session_reconnects', label: 'Session reconnects', unit: '', lowerIsBetter: true },
  { key: 'total_interruption_s', label: 'Interruption', unit: 's', lowerIsBetter: true },
  { key: 'control_deadline_miss_pct', label: 'Control deadline miss', unit: '%', lowerIsBetter: true },
  { key: 'control_p99_latency_ms', label: 'Control p99', unit: 'ms', lowerIsBetter: true },
  { key: 'video_stall_ms', label: 'Video stall', unit: 'ms', lowerIsBetter: true },
  { key: 'telemetry_deadline_miss_pct', label: 'Telemetry miss', unit: '%', lowerIsBetter: true },
  { key: 'app_health_score', label: 'App health', unit: '', lowerIsBetter: false },
  { key: 'satellite_bytes', label: 'Satellite bytes', unit: 'MB', lowerIsBetter: true },
  { key: 'cost_units', label: 'Link cost', unit: '', lowerIsBetter: true },
  { key: 'handovers', label: 'Handovers', unit: '', lowerIsBetter: true },
  { key: 'unnecessary_handovers', label: 'Unnecessary handovers', unit: '', lowerIsBetter: true },
];

interface Stat {
  n: number;
  mean: number | null;
  sd?: number;
  ci95_low?: number;
  ci95_high?: number;
}

function formatStat(stat: Stat | undefined, unit: string): string {
  if (!stat || stat.mean === null || stat.n === 0) return '—';
  const scale = unit === 'MB' ? 1e6 : 1;
  const mean = stat.mean / scale;
  const digits = Math.abs(mean) >= 100 ? 0 : Math.abs(mean) >= 10 ? 1 : 2;
  return `${mean.toFixed(digits)}`;
}

function ciLabel(stat: Stat | undefined, unit: string): string {
  if (!stat || stat.ci95_low === undefined || stat.n < 2) return '';
  const scale = unit === 'MB' ? 1e6 : 1;
  return `95% CI ${(stat.ci95_low / scale).toFixed(2)} … ${(stat.ci95_high! / scale).toFixed(2)} (n=${stat.n})`;
}

export function ExperimentsView() {
  const [scenarios, setScenarios] = useState<ScenarioSpec[]>([]);
  const [scenarioId, setScenarioId] = useState('wifi-degradation');
  const [trials, setTrials] = useState(20);
  const [experimentId, setExperimentId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ status: string; done?: number; total?: number; label?: string } | null>(null);
  const [results, setResults] = useState<Record<string, unknown> | null>(null);
  const [stored, setStored] = useState<Record<string, unknown>[]>([]);
  const [capability, setCapability] = useState<CapabilityReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    api.scenarios().then((s) => setScenarios(s.scenarios)).catch(() => undefined);
    api.capability().then(setCapability).catch(() => undefined);
    api.listExperiments().then((r) => setStored(r.stored)).catch(() => undefined);
  }, []);

  const poll = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const payload = await api.getExperiment(id);
        if (payload.status === 'completed' && payload.results) {
          setResults(payload.results as Record<string, unknown>);
          setProgress({ status: 'completed' });
          if (pollRef.current) clearInterval(pollRef.current);
          api.listExperiments().then((r) => setStored(r.stored)).catch(() => undefined);
        } else if (payload.status === 'failed') {
          setError(String((payload as { error?: string }).error ?? 'experiment failed'));
          if (pollRef.current) clearInterval(pollRef.current);
        } else {
          setProgress(payload as { status: string; done?: number; total?: number; label?: string });
        }
      } catch (cause) {
        setError(cause instanceof EngineApiError ? cause.message : String(cause));
        if (pollRef.current) clearInterval(pollRef.current);
      }
    }, 1200);
  }, []);

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setResults(null);
    try {
      const response = await api.startExperiment({ scenario_id: scenarioId, trials, block: 'test' });
      setExperimentId(response.experiment_id);
      setProgress({ status: 'queued' });
      poll(response.experiment_id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [scenarioId, trials, poll]);

  const loadStored = useCallback(async (id: string) => {
    setError(null);
    try {
      const payload = await api.getExperiment(id);
      setResults((payload.results ?? payload) as Record<string, unknown>);
      setExperimentId(id);
      setProgress({ status: 'completed' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const aggregate = (results?.aggregate ?? null) as Record<string, Record<string, Stat>> | null;
  const deltas = (results?.paired_deltas ?? null) as Record<string, Record<string, { mean_delta_p1_minus_baseline: number; n_pairs: number; p1_lower_in_pairs: number }>> | null;
  const completed = (results?.trials_completed ?? null) as Record<string, number> | null;
  const policyNames = aggregate ? Object.keys(aggregate) : [];

  return (
    <AppShell>
      <Panel dense>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className="panel-label">Scenario</span>
            <select className="control min-w-[230px]" value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
              {scenarios.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="panel-label">Paired trials</span>
            <input
              className="control w-[92px]"
              type="number"
              min={1}
              max={200}
              value={trials}
              onChange={(e) => setTrials(Math.max(1, Number(e.target.value) || 1))}
            />
          </label>
          <button type="button" className="control" onClick={start} disabled={progress?.status === 'running'}>
            ⇄ Run comparison
          </button>
          {progress && progress.status === 'running' && (
            <span className="text-[11.5px] text-[color:var(--color-muted)]">
              {progress.done ?? 0}/{progress.total ?? 0} · {progress.label ?? ''}
            </span>
          )}
          <p className="min-w-[240px] flex-1 text-[10.5px] leading-snug text-[color:var(--color-muted)]">
            Every policy runs against the same seed per trial, so all of them face identical link
            conditions, background demand and loss draws. Seeds come from the disjoint <code>test</code>{' '}
            block.
          </p>
        </div>
      </Panel>

      {error && (
        <div className="panel border-[color:var(--color-bad)] px-3.5 py-2.5 text-[12px] text-[color:var(--color-bad)]">
          {error}
        </div>
      )}

      {aggregate && (
        <Panel
          title={`Results · ${String(results?.scenario_id ?? '')}`}
          action={
            <span className="text-[10.5px] text-[color:var(--color-muted)]">
              seed block {String(results?.seed_block ?? '')} · commit{' '}
              {String(results?.code_commit ?? '').slice(0, 10) || 'unknown'}
            </span>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-[11.5px]">
              <caption className="sr-only">Paired comparison across policies</caption>
              <thead>
                <tr className="text-left">
                  <th className="border-b border-[color:var(--color-line)] py-1.5 pr-3 font-medium text-[color:var(--color-muted)]">
                    Metric
                  </th>
                  {policyNames.map((name) => (
                    <th
                      key={name}
                      className="border-b border-[color:var(--color-line)] py-1.5 pr-3 text-right font-semibold"
                      title={POLICY_NOTE[name]}
                    >
                      {name}
                      <div className="font-normal text-[10px] text-[color:var(--color-muted)]">
                        n={completed?.[name] ?? 0}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {HEADLINE_METRICS.map((metric) => {
                  const values = policyNames.map((name) => aggregate[name]?.[metric.key]);
                  const numeric = values
                    .map((stat, index) => ({ stat, index }))
                    .filter((entry) => entry.stat?.mean !== null && entry.stat !== undefined);
                  const best = numeric.length
                    ? numeric.reduce((a, b) =>
                        metric.lowerIsBetter
                          ? (a.stat!.mean! <= b.stat!.mean! ? a : b)
                          : (a.stat!.mean! >= b.stat!.mean! ? a : b),
                      ).index
                    : -1;
                  return (
                    <tr key={metric.key} className="border-b border-[color:var(--color-line)]">
                      <th scope="row" className="py-1.5 pr-3 text-left font-medium">
                        {metric.label}
                        {metric.unit ? (
                          <span className="text-[color:var(--color-muted)]"> ({metric.unit})</span>
                        ) : null}
                        <span className="ml-1 text-[10px] text-[color:var(--color-muted)]">
                          {metric.lowerIsBetter ? '↓ better' : '↑ better'}
                        </span>
                      </th>
                      {values.map((stat, index) => (
                        <td
                          key={policyNames[index]}
                          className="metric py-1.5 pr-3 text-right"
                          title={ciLabel(stat, metric.unit)}
                          style={{
                            fontWeight: index === best ? 700 : 400,
                            color: index === best ? 'var(--color-good)' : undefined,
                          }}
                        >
                          {formatStat(stat, metric.unit)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10.5px] leading-snug text-[color:var(--color-muted)]">
            Green marks the best mean for that row — it does not mean the difference is
            statistically meaningful. Hover any cell for its 95 % confidence interval and trial
            count. With ~20 trials those intervals are wide; treat small gaps as inconclusive.
          </p>
        </Panel>
      )}

      {deltas && (
        <Panel title="Paired deltas · CONTINUA (P1) minus baseline">
          <p className="mb-2 text-[10.5px] leading-snug text-[color:var(--color-muted)]">
            Computed per trial on identical conditions, which is far more sensitive than comparing
            means. Negative means P1 scored lower on that metric — good for interruption, cost and
            misses; bad for health score.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-[11.5px]">
              <thead>
                <tr className="text-left text-[color:var(--color-muted)]">
                  <th className="border-b border-[color:var(--color-line)] py-1.5 pr-3 font-medium">Baseline</th>
                  <th className="border-b border-[color:var(--color-line)] py-1.5 pr-3 text-right font-medium">Interruption Δs</th>
                  <th className="border-b border-[color:var(--color-line)] py-1.5 pr-3 text-right font-medium">Reconnects Δ</th>
                  <th className="border-b border-[color:var(--color-line)] py-1.5 pr-3 text-right font-medium">Control miss Δ%</th>
                  <th className="border-b border-[color:var(--color-line)] py-1.5 pr-3 text-right font-medium">Satellite ΔMB</th>
                  <th className="border-b border-[color:var(--color-line)] py-1.5 pr-3 text-right font-medium">Cost Δ</th>
                  <th className="border-b border-[color:var(--color-line)] py-1.5 pr-3 text-right font-medium">Health Δ</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(deltas).map(([name, row]) => (
                  <tr key={name} className="border-b border-[color:var(--color-line)]">
                    <th scope="row" className="py-1.5 pr-3 text-left font-medium" title={POLICY_NOTE[name]}>
                      {name}
                    </th>
                    {[
                      ['total_interruption_s', 1],
                      ['session_reconnects', 1],
                      ['control_deadline_miss_pct', 1],
                      ['satellite_bytes', 1e6],
                      ['cost_units', 1],
                      ['app_health_score', 1],
                    ].map(([key, scale]) => {
                      const entry = row[key as string];
                      if (!entry) return <td key={String(key)} className="py-1.5 pr-3 text-right">—</td>;
                      const value = entry.mean_delta_p1_minus_baseline / (scale as number);
                      const good = key === 'app_health_score' ? value > 0 : value < 0;
                      return (
                        <td
                          key={String(key)}
                          className="metric py-1.5 pr-3 text-right"
                          title={`${entry.p1_lower_in_pairs}/${entry.n_pairs} trials where P1 was lower`}
                          style={{ color: good ? 'var(--color-good)' : value === 0 ? undefined : 'var(--color-bad)' }}
                        >
                          {value > 0 ? '+' : ''}
                          {value.toFixed(Math.abs(value) >= 10 ? 1 : 2)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Panel title="Stored experiments">
          {stored.length === 0 ? (
            <p className="text-[11.5px] text-[color:var(--color-muted)]">None yet.</p>
          ) : (
            <ul className="space-y-1">
              {stored.map((row) => (
                <li key={String(row.experiment_id)}>
                  <button
                    type="button"
                    className="control w-full justify-between"
                    onClick={() => loadStored(String(row.experiment_id))}
                    data-active={experimentId === row.experiment_id}
                  >
                    <span className="truncate">{String(row.scenario_id)}</span>
                    <span className="text-[10px] text-[color:var(--color-muted)]">
                      {String(row.trials)} trials · {String(row.completed)} runs
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title="Execution capability" className="scroll-mt-24" >
          <div id="capability">
            {capability ? (
              <>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  <Chip tone="warn">SIMULATION available</Chip>
                  <Chip tone={capability.emulation_supported ? 'good' : 'bad'}>
                    EMULATION {capability.emulation_supported ? 'available' : 'NOT VERIFIED HERE'}
                  </Chip>
                  <Chip tone={capability.mptcp_supported ? 'good' : 'bad'}>
                    MPTCP {capability.mptcp_supported ? 'available' : 'unavailable'}
                  </Chip>
                </div>
                <p className="text-[11.5px] leading-snug">{capability.summary}</p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-[color:var(--color-muted)]">
                    {capability.checks.length} capability checks on {capability.host_platform}
                  </summary>
                  <ul className="mt-1.5 space-y-0.5 text-[10.5px]">
                    {capability.checks.map((check) => (
                      <li key={check.name} className="flex items-start gap-1.5">
                        <span style={{ color: check.ok ? 'var(--color-good)' : 'var(--color-bad)' }}>
                          {check.ok ? '✓' : '✕'}
                        </span>
                        <span className="font-[family-name:var(--font-mono)]">{check.name}</span>
                        <span className="text-[color:var(--color-muted)]">— {check.detail}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </>
            ) : (
              <p className="text-[11.5px] text-[color:var(--color-muted)]">Probing…</p>
            )}
          </div>
        </Panel>
      </div>
    </AppShell>
  );
}
