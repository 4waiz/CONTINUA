'use client';

/**
 * The Scenario Lab's input controls, as a laboratory rather than a settings form.
 *
 * The version these replace was a column of `<select>` elements and five
 * full-width toggle bars, which gave every option the same visual weight - the
 * base scenario, the thing the whole run is about, looked exactly like the
 * seed. Here the scenario is a grid of tiles, the policy is a segmented control
 * with the comparison spelled out, and workloads are chips carrying their
 * priority colour, so the shape of the experiment is readable at a glance.
 *
 * Every control still maps to one validated field on `ScenarioOverrides`. None
 * of them is decorative.
 */

import type { PolicyIdString, TrafficClassId } from '@continua/contracts/engine';
import type { ReactNode } from 'react';

/* --- scenario tiles ------------------------------------------------------ */

export function ScenarioCard({
  title,
  description,
  selected,
  onSelect,
}: {
  title: string;
  description?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`flex flex-col gap-0.5 rounded-[13px] border px-3 py-2.5 text-left transition ${
        selected
          ? 'border-[color:color-mix(in_srgb,var(--color-blue)_40%,transparent)] bg-[color:color-mix(in_srgb,var(--color-blue)_7%,white)]'
          : 'border-[color:var(--color-line)] bg-[color:var(--color-surface)] hover:border-[color:var(--color-line-strong)]'
      }`}
      style={selected ? { boxShadow: '0 0 0 3px color-mix(in srgb, var(--color-blue) 9%, transparent)' } : undefined}
    >
      <span
        className="text-[12.5px] font-semibold leading-tight"
        style={{ color: selected ? 'var(--color-blue)' : 'var(--color-ink)' }}
      >
        {title}
      </span>
      {description && (
        <span className="line-clamp-2 text-[11px] leading-snug text-[color:var(--color-muted)]">
          {description}
        </span>
      )}
    </button>
  );
}

/* --- policy --------------------------------------------------------------- */

/**
 * Plain-English names for the policies, so the choice reads as an experiment
 * rather than an enum. The ids are what the engine sees and what the manifest
 * records; these labels never replace them.
 */
export const POLICY_LABEL: Record<string, { name: string; blurb: string }> = {
  B0: { name: 'Single path', blurb: 'Switch only after the carrying link fails' },
  B1: { name: 'Reactive multipath', blurb: 'Bring up a backup once trouble is measured' },
  B2: { name: 'Always-on redundancy', blurb: 'Keep a second path warm at all times' },
  P1: { name: 'CONTINUA', blurb: 'Predict, prepare, steer - and account for the cost' },
  'P1-noPred': { name: 'CONTINUA · no predictor', blurb: 'Ablation: preparation without forecasting' },
  'P1-noApp': { name: 'CONTINUA · no app-awareness', blurb: 'Ablation: no per-class throttling' },
  'B2-defer': { name: 'Always-on redundancy · bulk deferred', blurb: 'B2 plus the bulk pause rule, nothing else app-aware' },
  P2: { name: 'CONTINUA P2', blurb: 'P1 plus per-class steering and control mode handover' },
  'P2-noSteer': { name: 'P2 · no steering', blurb: 'Ablation: mode handover without per-class steering' },
  'P2-noMode': { name: 'P2 · no mode handover', blurb: 'Ablation: per-class steering, control always teleop' },
  'P2-reactiveMode': { name: 'P2 · reactive mode', blurb: 'Ablation: mode changes only after a measured violation' },
};

const POLICY_GROUPS: readonly { label: string; ids: readonly string[] }[] = [
  { label: 'Baselines', ids: ['B0', 'B1', 'B2', 'B2-defer'] },
  { label: 'CONTINUA', ids: ['P1', 'P2'] },
  { label: 'Ablations', ids: ['P1-noPred', 'P1-noApp', 'P2-noSteer', 'P2-noMode', 'P2-reactiveMode'] },
];

/**
 * Eleven policies as three short rows of ids - baselines, CONTINUA, the
 * ablations that take it apart - and one line saying what the chosen one does.
 * Eleven two-line buttons were most of the column.
 */
export function PolicySelector({
  policies,
  value,
  onChange,
}: {
  policies: { id: string }[];
  value: PolicyIdString;
  onChange: (id: PolicyIdString) => void;
}) {
  const known = new Set(policies.map((policy) => policy.id));
  const grouped = new Set(POLICY_GROUPS.flatMap((group) => group.ids));
  const groups = [
    ...POLICY_GROUPS.map((group) => ({ ...group, ids: group.ids.filter((id) => known.has(id)) })),
    { label: 'Other', ids: policies.map((policy) => policy.id).filter((id) => !grouped.has(id)) },
  ].filter((group) => group.ids.length > 0);
  const meta = POLICY_LABEL[value] ?? { name: value, blurb: '' };
  const continua = value.startsWith('P');

  return (
    <div className="flex flex-col gap-2">
      {groups.map((group) => (
        <div key={group.label} className="flex items-start gap-2">
          <span className="w-[66px] shrink-0 pt-[5px] text-[11px] font-medium text-[color:var(--color-faint)]">{group.label}</span>
          <div className="flex flex-wrap gap-1">
            {group.ids.map((id) => {
              const selected = id === value;
              const label = POLICY_LABEL[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onChange(id as PolicyIdString)}
                  aria-pressed={selected}
                  title={label ? `${label.name} - ${label.blurb}` : id}
                  className="metric rounded-[8px] border px-2 py-[3px] text-[11.5px] font-semibold transition-colors"
                  style={{
                    borderColor: selected ? 'color-mix(in srgb, var(--color-violet) 45%, transparent)' : 'var(--color-line)',
                    background: selected ? 'color-mix(in srgb, var(--color-violet) 10%, white)' : 'var(--color-surface)',
                    color: selected ? 'var(--color-violet)' : 'var(--color-muted)',
                  }}
                >
                  {id}
                </button>
              );
            })}
          </div>
        </div>
      ))}
      <div
        className="mt-0.5 rounded-[10px] px-3 py-2"
        style={{ background: continua ? 'color-mix(in srgb, var(--color-violet) 6%, white)' : 'var(--color-surface-muted)' }}
      >
        <div className="text-[12.5px] font-semibold leading-tight">{meta.name}</div>
        {meta.blurb && <div className="mt-0.5 text-[11.5px] leading-snug text-[color:var(--color-muted)]">{meta.blurb}</div>}
      </div>
    </div>
  );
}

/* --- workloads ------------------------------------------------------------ */

/** Priority colour, matching the health panel: what gets protected first. */
const CLASS_COLOR: Record<TrafficClassId, string> = {
  control: '#176bff',
  telemetry: '#14b8e8',
  video: '#5156e8',
  voice: '#0db982',
  bulk: '#8995ab',
};

const CLASS_NAME: Record<TrafficClassId, string> = {
  control: 'Command',
  telemetry: 'Telemetry',
  video: 'Video',
  voice: 'Voice',
  bulk: 'Bulk logs',
};

export function WorkloadChip({
  id,
  enabled,
  onToggle,
}: {
  id: TrafficClassId;
  enabled: boolean;
  onToggle: () => void;
}) {
  const color = CLASS_COLOR[id];
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={enabled}
      className="flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition"
      style={{
        borderColor: enabled ? `color-mix(in srgb, ${color} 36%, transparent)` : 'var(--color-line)',
        background: enabled ? `color-mix(in srgb, ${color} 8%, white)` : 'var(--color-surface)',
        color: enabled ? color : 'var(--color-faint)',
      }}
    >
      <span
        aria-hidden
        className="h-[8px] w-[8px] rounded-full"
        style={{ background: enabled ? color : 'var(--color-line-strong)' }}
      />
      {CLASS_NAME[id]}
    </button>
  );
}

/* --- layout helpers ------------------------------------------------------- */

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="panel-label">{label}</span>
      {children}
    </label>
  );
}

/**
 * Fault injection gets its own visual treatment: an amber section, because it
 * is the part of the configuration that deliberately breaks something and
 * should never be confused with the baseline setup.
 */
export function FaultSection({ children, hidden }: { children: ReactNode; hidden?: boolean }) {
  return (
    <section
      hidden={hidden}
      className="rounded-[14px] border px-3.5 py-3"
      style={{
        borderColor: 'color-mix(in srgb, var(--color-warn) 32%, transparent)',
        background: 'color-mix(in srgb, var(--color-warn) 5%, white)',
      }}
    >
      <h3
        className="mb-2 text-[11.5px] font-bold uppercase tracking-[0.085em]"
        style={{ color: '#9a6606' }}
      >
        Fault injection
      </h3>
      {children}
    </section>
  );
}
