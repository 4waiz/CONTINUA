'use client';

/**
 * Experiments - run the paired comparison, read the result honestly.
 *
 * The table reports means with 95 % confidence intervals and the number of
 * completed trials. Where CONTINUA loses, it says so: the paired-delta column
 * is signed and labelled, not filtered.
 */

import { api, EngineApiError, type CapabilityReport, type ScenarioSpec } from '@/lib/api';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AtAGlance, glanceRows } from './experiments/AtAGlance';
import { InfoTip } from './ui/InfoTip';
import type { PolicyIdString } from '@continua/contracts/engine';
import { AppShell } from './AppShell';
import { CompareIcon } from './ui/icons';
import { IS_PUBLIC_PREVIEW, REPO_URL } from '@/lib/deployment';
import { ComparisonChart } from './experiments/ComparisonChart';
import { PROOF_EXPERIMENT } from './mission/StoryCards';
import { Chip, Panel } from './ui/primitives';

const POLICY_NOTE: Record<string, string> = {
  B0: 'Single-path reactive. One activated path; an address change ends the session.',
  B1: 'Reactive multipath. Activates a backup only after degradation is measured.',
  B2: 'Always-active redundancy. Every usable path activated, control always duplicated.',
  P1: 'CONTINUA. Predictive, application-aware.',
  'P1-noPred': 'Ablation: CONTINUA without prediction.',
  'P1-noApp': 'Ablation: CONTINUA without application priorities.',
  'B2-defer': 'Always-active redundancy plus bulk deferral only. Isolates how much of the satellite saving is just pausing bulk.',
  P2: 'CONTINUA P2. P1 plus per-class steering and control mode handover.',
  'P2-noSteer': 'Ablation: P2 without per-class steering.',
  'P2-noMode': 'Ablation: P2 without mode handover; control stays in teleop.',
  'P2-reactiveMode': 'Ablation: P2 whose mode changes only after a measured violation, never ahead of one.',
  P3: 'CONTINUA P3. P1 plus a radio map of the route from earlier drives: where the kept paths will both be lost ahead, it prepares a third in time.',
};

/** The at-a-glance rows: CONTINUA first, then the baselines, then the ablations. */
const GLANCE_ORDER: readonly PolicyIdString[] = [
  'P3', 'P2', 'P1', 'B0', 'B1', 'B2', 'B2-defer', 'P1-noPred', 'P1-noApp', 'P2-noSteer', 'P2-noMode', 'P2-reactiveMode',
];

const HEADLINE_METRICS: { key: string; label: string; unit: string; lowerIsBetter: boolean }[] = [
  { key: 'session_reconnects', label: 'Session reconnects', unit: '', lowerIsBetter: true },
  { key: 'total_interruption_s', label: 'Interruption', unit: 's', lowerIsBetter: true },
  { key: 'control_deadline_miss_pct', label: 'Control deadline miss', unit: '%', lowerIsBetter: true },
  { key: 'control_p99_latency_ms', label: 'Control p99', unit: 'ms', lowerIsBetter: true },
  { key: 'video_stall_ms', label: 'Video stall', unit: 'ms', lowerIsBetter: true },
  { key: 'telemetry_deadline_miss_pct', label: 'Telemetry miss', unit: '%', lowerIsBetter: true },
  { key: 'app_health_score', label: 'App health', unit: '', lowerIsBetter: false },
  { key: 'satellite_bytes', label: 'Satellite bytes', unit: 'MB', lowerIsBetter: true },
  { key: 'satellite_bytes_excl_bulk', label: 'Satellite bytes excl. bulk', unit: 'MB', lowerIsBetter: true },
  { key: 'cost_units', label: 'Link cost', unit: '', lowerIsBetter: true },
  { key: 'handovers', label: 'Handovers', unit: '', lowerIsBetter: true },
  { key: 'unnecessary_handovers', label: 'Unnecessary handovers', unit: '', lowerIsBetter: true },
  // Phase 4: the strict picture first, then what the mode machine did.
  { key: 'teleop_availability_pct', label: 'Teleop availability', unit: '%', lowerIsBetter: false },
  { key: 'unsupported_mode_s', label: 'Time in an unsupported mode', unit: 's', lowerIsBetter: true },
  { key: 'conservative_mode_s', label: 'Time held below a supported mode', unit: 's', lowerIsBetter: true },
  { key: 'mode_changes', label: 'Mode changes', unit: '', lowerIsBetter: true },
  { key: 'class_steers', label: 'Class steers', unit: '', lowerIsBetter: true },
];

/**
 * The six the brief asks for. The full eleven stay in the table below the
 * charts - this is the first look, not the whole result.
 */
const CHART_METRICS = [
  { key: 'total_interruption_s', label: 'Interruption', unit: 's', lowerIsBetter: true },
  { key: 'control_p95_latency_ms', label: 'Command p95 latency', unit: 'ms', lowerIsBetter: true },
  { key: 'control_deadline_miss_pct', label: 'Command deadline misses', unit: '%', lowerIsBetter: true },
  { key: 'video_stall_ms', label: 'Video stall', unit: 'ms', lowerIsBetter: true },
  { key: 'satellite_bytes', label: 'Satellite usage', unit: 'MB', lowerIsBetter: true },
  { key: 'handovers', label: 'Handovers', unit: '', lowerIsBetter: true },
] as const;

interface Stat {
  n: number;
  mean: number | null;
  sd?: number;
  ci95_low?: number;
  ci95_high?: number;
}

function formatStat(stat: Stat | undefined, unit: string): string {
  if (!stat || stat.mean === null || stat.n === 0) return ' - ';
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

  const loadStored = useCallback(async (id: string) => {
    setError(null);
    try {
      const payload = await api.getExperiment(id);
      const loaded = (payload.results ?? payload) as Record<string, unknown>;
      setResults(loaded);
      setExperimentId(id);
      // The selector names the road the results on screen are for.
      if (typeof loaded.scenario_id === 'string') setScenarioId(loaded.scenario_id);
      setProgress({ status: 'completed' });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  useEffect(() => {
    api.scenarios().then((s) => setScenarios(s.scenarios)).catch(() => undefined);
    api.capability().then(setCapability).catch(() => undefined);
    api
      .listExperiments()
      .then((r) => {
        setStored(r.stored);
        // Land on results rather than an empty page: the comparison on the
        // road the Mission page drives, when it is on disk, and otherwise the
        // largest completed experiment. Picking one from the list replaces it.
        const featured = r.stored.find((row) => row.experiment_id === PROOF_EXPERIMENT && Number(row.completed ?? 0) > 0);
        const best =
          featured ??
          r.stored
            .filter((row) => Number(row.completed ?? 0) > 0)
            .sort((a, b) => Number(b.completed ?? 0) - Number(a.completed ?? 0))[0];
        if (best) void loadStored(String(best.experiment_id));
      })
      .catch(() => undefined);
  }, [loadStored]);

  // Choosing a scenario also shows its largest stored comparison, if there is
  // one, so the selector browses results as well as setting up a new run.
  const chooseScenario = useCallback(
    (id: string) => {
      setScenarioId(id);
      const latest = stored
        .filter((row) => row.scenario_id === id && Number(row.completed ?? 0) > 0)
        .sort((a, b) => Number(b.completed ?? 0) - Number(a.completed ?? 0))[0];
      if (latest) void loadStored(String(latest.experiment_id));
    },
    [stored, loadStored],
  );

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



  const aggregate = (results?.aggregate ?? null) as Record<string, Record<string, Stat>> | null;
  type DeltaRow = Record<string, { mean_delta_p1_minus_baseline: number; n_pairs: number; p1_lower_in_pairs: number }>;
  const deltas = (results?.paired_deltas ?? null) as Record<string, DeltaRow> | null;
  const deltasP2 = (results?.paired_deltas_p2 ?? null) as Record<string, DeltaRow> | null;
  const completed = (results?.trials_completed ?? null) as Record<string, number> | null;
  const policyNames = aggregate ? Object.keys(aggregate) : [];

  /**
   * Totals across every experiment on disk, not just the selected one. These
   * are counts of runs actually recorded - there is no target, no percentage of
   * a goal, and nothing here is estimated.
   */
  const totalRuns = stored.reduce((sum, row) => sum + Number(row.completed ?? 0), 0);
  // Every drive of every strategy, one icon each, from the per-trial records.
  const glance = glanceRows(results, GLANCE_ORDER);
  const scenarioTitle = (id: string) => scenarios.find((entry) => entry.id === id)?.title ?? id;
  const scenariosTested = new Set(stored.map((row) => String(row.scenario_id))).size;
  const selectedTrials = completed ? Object.values(completed).reduce((a, b) => a + b, 0) : 0;

  const summary: { label: string; value: string; note: string }[] = [
    { label: 'Runs recorded', value: String(totalRuns), note: `${stored.length} experiments on disk` },
    { label: 'Runs in this result', value: String(selectedTrials), note: `${policyNames.length} policies compared` },
    {
      label: 'Scenarios tested',
      value: String(scenariosTested),
      note: 'distinct scenario specs',
    },
    {
      label: 'Execution mode',
      value: 'SIMULATION',
      note: capability?.emulation_supported ? 'emulation available' : 'emulation not verified here',
    },
  ];

  return (
    <AppShell>
      <div className="flex h-full min-h-0 flex-col gap-3">
        {/* One header strip: what this page is, what is on disk, and the one
            action it offers. It replaces a toolbar plus four stat cards. */}
        <section className="panel flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 px-5 py-3.5">
          <div className="min-w-[260px] flex-1">
            <h2 className="text-[15px] font-semibold leading-tight">Paired policy comparison</h2>
            <p className="mt-1 max-w-[560px] text-[11.5px] leading-snug text-[color:var(--color-muted)]">
              {IS_PUBLIC_PREVIEW
                ? 'These experiments were executed by the CONTINUA engine and are shown exactly as recorded. '
                : ''}
              Every policy runs against the same seed per trial, so all of them face identical link conditions,
              background demand and loss draws. Seeds come from disjoint blocks.
            </p>
          </div>

          <dl className="flex shrink-0 items-center gap-6">
            {summary.map((item) => (
              <div key={item.label} className="leading-tight" title={item.note}>
                <dt className="section-label">{item.label}</dt>
                <dd className="metric mt-1 text-[19px] font-semibold tracking-[-0.02em]">{item.value}</dd>
              </div>
            ))}
          </dl>

          <span className="divider-v hidden xl:block" />

          {/* Executing a comparison needs the engine. Viewing the ones already
              executed does not, and that is what this page is mostly for. */}
          <div className="flex shrink-0 items-end gap-2.5">
            <label className="flex flex-col gap-1" hidden={IS_PUBLIC_PREVIEW}>
              <span className="section-label">Scenario</span>
              <select className="control min-w-[220px]" value={scenarioId} onChange={(e) => chooseScenario(e.target.value)}>
                {scenarios.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1" hidden={IS_PUBLIC_PREVIEW}>
              <span className="section-label">Paired trials</span>
              <input
                className="control w-[84px]"
                type="number"
                min={1}
                max={200}
                value={trials}
                onChange={(e) => setTrials(Math.max(1, Number(e.target.value) || 1))}
              />
            </label>
            {IS_PUBLIC_PREVIEW ? (
              <a className="control no-underline" href={REPO_URL} target="_blank" rel="noreferrer">
                Run your own comparison
              </a>
            ) : (
              <button type="button" className="control control-primary" onClick={start} disabled={progress?.status === 'running'}>
                <CompareIcon size={15} /> Run comparison
              </button>
            )}
          </div>
          {progress && progress.status === 'running' && (
            <span className="w-full text-[11.5px] text-[color:var(--color-muted)]">
              Running {progress.done ?? 0}/{progress.total ?? 0} · {progress.label ?? ''}
            </span>
          )}
        </section>

        <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,1fr)] gap-3 xl:grid-cols-[292px_minmax(0,1fr)]">
          <div className="scroll-y flex flex-col gap-3 pr-0.5">
            <section className="panel px-4 py-3.5">
              <h2 className="panel-label mb-2">Stored experiments</h2>
              {stored.length === 0 ? (
                <p className="text-[12px] text-[color:var(--color-muted)]">None yet.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {stored
                    .slice()
                    // The Mission page's road first, then newest first.
                    .sort((a, b) =>
                      a.experiment_id === PROOF_EXPERIMENT
                        ? -1
                        : b.experiment_id === PROOF_EXPERIMENT
                          ? 1
                          : String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')),
                    )
                    .map((row) => {
                      const active = experimentId === row.experiment_id;
                      const drives = Number(row.trials ?? 0);
                      const strategies = drives > 0 ? Math.round(Number(row.completed ?? 0) / drives) : 0;
                      return (
                        <li key={String(row.experiment_id)}>
                          <button
                            type="button"
                            onClick={() => loadStored(String(row.experiment_id))}
                            aria-pressed={active}
                            className={`flex w-full items-baseline justify-between gap-2 rounded-[10px] border px-2.5 py-2 text-left transition ${
                              active
                                ? 'border-[color:color-mix(in_srgb,var(--color-blue)_36%,transparent)] bg-[color:color-mix(in_srgb,var(--color-blue)_7%,white)]'
                                : 'border-transparent hover:border-[color:var(--color-line)]'
                            }`}
                          >
                            <span
                              className="truncate text-[12.5px] font-semibold"
                              style={{ color: active ? 'var(--color-blue)' : undefined }}
                              title={`${String(row.experiment_id)} · ${String(row.scenario_id)}`}
                            >
                              {scenarioTitle(String(row.scenario_id))}
                            </span>
                            <span className="metric shrink-0 text-[11px] text-[color:var(--color-muted)]" title={`${String(row.completed)} runs`}>
                              {strategies} strategies · {drives} drives
                            </span>
                          </button>
                        </li>
                      );
                    })}
                </ul>
              )}
            </section>

            <section className="panel px-4 py-3.5" id="capability">
              <h2 className="panel-label mb-2">Execution capability</h2>
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
                    <summary className="cursor-pointer text-[11.5px] text-[color:var(--color-muted)]">
                      {capability.checks.length} capability checks on {capability.host_platform}
                    </summary>
                    <ul className="mt-1.5 space-y-0.5 text-[11px]">
                      {capability.checks.map((check) => (
                        <li key={check.name} className="flex items-start gap-1.5">
                          <span style={{ color: check.ok ? 'var(--color-good)' : 'var(--color-bad)' }}>
                            {check.ok ? 'ok' : 'x'}
                          </span>
                          <span className="font-[family-name:var(--font-mono)]">{check.name}</span>
                          <span className="text-[color:var(--color-muted)]">- {check.detail}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </>
              ) : (
                <p className="text-[12px] text-[color:var(--color-muted)]">Probing...</p>
              )}
            </section>
          </div>

          <div className="scroll-y flex flex-col gap-3 pr-0.5">
            {error && (
              <div className="panel border-[color:var(--color-bad)] px-4 py-2.5 text-[12.5px] text-[color:var(--color-bad)]">
                {error}
              </div>
            )}

            {glance.length > 0 && (
              <section className="panel px-4 py-3.5" aria-label="At a glance">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="panel-label flex items-center gap-1.5">
                    At a glance · {scenarioTitle(String(results?.scenario_id ?? ''))} · {glance[0]!.trials.length} paired drives each
                    <InfoTip text="Every strategy drove the same road with the same random draws - only the strategy differs. One rover per drive. Cost is the simulator's relative cost model, not money." />
                  </h2>
                  <span className="text-[11.5px] text-[color:var(--color-muted)]">
                    One rover per drive: <span className="font-semibold text-[color:var(--color-good)]">green</span> if the operator never
                    lost the link, <span className="font-semibold text-[color:var(--color-bad)]">red</span> if they did
                  </span>
                </div>
                <AtAGlance rows={glance} highlight={glance.some((row) => row.policy === 'P3') ? 'P3' : 'P1'} compact />
              </section>
            )}

            {aggregate && (
              <section className="panel px-4 py-3.5">
                <h2 className="panel-label mb-2.5">Baseline comparison</h2>
                <div className="grid grid-cols-1 gap-2.5 lg:grid-cols-2 2xl:grid-cols-3">
                  {CHART_METRICS.map((metric) => (
                    <ComparisonChart
                      key={metric.key}
                      title={metric.label}
                      unit={metric.unit}
                      scale={metric.unit === 'MB' ? 1e6 : 1}
                      lowerIsBetter={metric.lowerIsBetter}
                      policies={policyNames}
                      values={Object.fromEntries(
                        policyNames.map((policy) => [policy, aggregate[policy]?.[metric.key]]),
                      )}
                    />
                  ))}
                </div>
              </section>
            )}

            {!aggregate && (
              <div className="panel grid flex-1 place-items-center px-6 py-10 text-center">
                <div>
                  <p className="text-[15px] font-semibold">No results loaded</p>
                  <p className="mt-1 text-[12.5px] text-[color:var(--color-muted)]">
                    Pick a stored experiment, or run a new paired comparison above.
                  </p>
                </div>
              </div>
            )}

            {aggregate && (
        <Panel
          title={`Results · ${String(results?.scenario_id ?? '')}`}
          action={
            <span className="text-[11px] text-[color:var(--color-muted)]">
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
                      <div className="font-normal text-[11px] text-[color:var(--color-muted)]">
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
                        <span className="ml-1 text-[11px] text-[color:var(--color-muted)]">
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
          <p className="mt-2 text-[11px] leading-snug text-[color:var(--color-muted)]">
            Green marks the best mean for that row - it does not mean the difference is
            statistically meaningful. Hover any cell for its 95 % confidence interval and trial
            count. With ~20 trials those intervals are wide; treat small gaps as inconclusive.
          </p>
        </Panel>
      )}

      {deltas && <PairedDeltas treatment="P1" deltas={deltas} />}
      {deltasP2 && Object.keys(deltasP2).length > 0 && (
        <PairedDeltas treatment="P2" deltas={deltasP2} />
      )}

          </div>
        </div>
      </div>
    </AppShell>
  );
}

const DELTA_COLUMNS: { key: string; label: string; scale: number; higherIsGood?: boolean }[] = [
  { key: 'total_interruption_s', label: 'Interruption Δs', scale: 1 },
  { key: 'session_reconnects', label: 'Reconnects Δ', scale: 1 },
  { key: 'control_deadline_miss_pct', label: 'Control miss Δ%', scale: 1 },
  { key: 'teleop_availability_pct', label: 'Teleop avail. Δ%', scale: 1, higherIsGood: true },
  { key: 'unsupported_mode_s', label: 'Unsupported Δs', scale: 1 },
  { key: 'satellite_bytes', label: 'Satellite ΔMB', scale: 1e6 },
  { key: 'cost_units', label: 'Cost Δ', scale: 1 },
  { key: 'app_health_score', label: 'Health Δ', scale: 1, higherIsGood: true },
];

function PairedDeltas({
  treatment,
  deltas,
}: {
  treatment: 'P1' | 'P2';
  deltas: Record<string, Record<string, { mean_delta_p1_minus_baseline: number; n_pairs: number; p1_lower_in_pairs: number }>>;
}) {
  return (
    <Panel title={`Paired deltas · ${treatment === 'P1' ? 'CONTINUA (P1)' : 'CONTINUA P2'} minus baseline`}>
      <p className="mb-2 text-[11px] leading-snug text-[color:var(--color-muted)]">
        Computed per trial on identical conditions, which is far more sensitive than comparing
        means. Negative means {treatment} scored lower on that metric - good for interruption, cost,
        misses and unsupported time; bad for health score and teleop availability.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-[11.5px]">
          <thead>
            <tr className="text-left text-[color:var(--color-muted)]">
              <th className="border-b border-[color:var(--color-line)] py-1.5 pr-3 font-medium">Baseline</th>
              {DELTA_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className="border-b border-[color:var(--color-line)] py-1.5 pr-3 text-right font-medium"
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Object.entries(deltas).map(([name, row]) => (
              <tr key={name} className="border-b border-[color:var(--color-line)]">
                <th scope="row" className="py-1.5 pr-3 text-left font-medium" title={POLICY_NOTE[name]}>
                  {name}
                </th>
                {DELTA_COLUMNS.map((column) => {
                  const entry = row[column.key];
                  if (!entry) return <td key={column.key} className="py-1.5 pr-3 text-right"> - </td>;
                  const value = entry.mean_delta_p1_minus_baseline / column.scale;
                  const good = column.higherIsGood ? value > 0 : value < 0;
                  return (
                    <td
                      key={column.key}
                      className="metric py-1.5 pr-3 text-right"
                      title={`${entry.p1_lower_in_pairs}/${entry.n_pairs} trials where ${treatment} was lower`}
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
  );
}
