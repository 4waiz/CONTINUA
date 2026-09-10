'use client';

/**
 * The small set of chrome primitives the CONTINUA dashboard is built from.
 * Spacious rounded panels, hairline borders, restrained shadows - and no
 * decorative metrics: every value rendered here is passed in by a caller that
 * knows where it came from.
 */

import type { ReactNode } from 'react';

export function Panel({
  title,
  action,
  children,
  className = '',
  dense = false,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <section className={`panel ${dense ? 'p-3' : 'p-4'} ${className}`}>
      {(title || action) && (
        <header className="mb-2.5 flex items-center justify-between gap-2">
          {title && <h2 className="panel-label">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Chip({
  tone = 'muted',
  children,
  title,
}: {
  tone?: 'muted' | 'blue' | 'cyan' | 'violet' | 'good' | 'warn' | 'bad';
  children: ReactNode;
  title?: string;
}) {
  const tones: Record<string, string> = {
    muted: 'text-[color:var(--color-muted)] bg-[color:var(--color-surface-muted)] border-[color:var(--color-line)]',
    blue: 'text-[color:var(--color-blue)] bg-[color-mix(in_srgb,var(--color-blue)_9%,white)] border-[color-mix(in_srgb,var(--color-blue)_28%,white)]',
    cyan: 'text-[color:var(--color-cyan)] bg-[color-mix(in_srgb,var(--color-cyan)_10%,white)] border-[color-mix(in_srgb,var(--color-cyan)_30%,white)]',
    violet:
      'text-[color:var(--color-violet)] bg-[color-mix(in_srgb,var(--color-violet)_9%,white)] border-[color-mix(in_srgb,var(--color-violet)_28%,white)]',
    good: 'text-[color:var(--color-good)] bg-[color-mix(in_srgb,var(--color-good)_10%,white)] border-[color-mix(in_srgb,var(--color-good)_28%,white)]',
    warn: 'text-[color:var(--color-warn)] bg-[color-mix(in_srgb,var(--color-warn)_12%,white)] border-[color-mix(in_srgb,var(--color-warn)_32%,white)]',
    bad: 'text-[color:var(--color-bad)] bg-[color-mix(in_srgb,var(--color-bad)_10%,white)] border-[color-mix(in_srgb,var(--color-bad)_28%,white)]',
  };
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[11px] font-semibold tracking-wide ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

export function Dot({ color, pulse = false }: { color: string; pulse?: boolean }) {
  return (
    <span
      aria-hidden
      className={`inline-block h-[7px] w-[7px] shrink-0 rounded-full ${pulse ? 'animate-pulse' : ''}`}
      style={{ background: color }}
    />
  );
}

export function Stat({
  label,
  value,
  unit,
  tone,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  tone?: string;
  hint?: string;
}) {
  return (
    <div title={hint}>
      <div className="panel-label">{label}</div>
      <div className="metric mt-0.5 flex items-baseline gap-1">
        <span className="text-[22px] font-semibold leading-none" style={tone ? { color: tone } : undefined}>
          {value}
        </span>
        {unit && <span className="text-[11px] font-medium text-[color:var(--color-muted)]">{unit}</span>}
      </div>
    </div>
  );
}

export function ButtonGroup<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly { value: T; label: string; title?: string }[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          title={option.title}
          className="control"
          data-active={value === option.value}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="control w-full justify-between"
      data-active={checked}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    >
      <span>{children}</span>
      <span
        aria-hidden
        className="relative inline-block h-[16px] w-[28px] rounded-full transition-colors"
        style={{ background: checked ? 'var(--color-blue)' : 'var(--color-line-strong)' }}
      >
        <span
          className="absolute top-[2px] h-[12px] w-[12px] rounded-full bg-white transition-all"
          style={{ left: checked ? 14 : 2 }}
        />
      </span>
    </button>
  );
}

/** The honesty badge. Phase 1 must never claim measured performance. */
export function PreviewBadge({ source }: { source: 'preview' | 'engine' }) {
  if (source === 'engine') {
    return (
      <Chip tone="good">
        <Dot color="var(--color-good)" pulse /> LIVE ENGINE
      </Chip>
    );
  }
  return (
    <Chip tone="warn" title="Phase 1 shows a deterministic geometric preview. Values are illustrative, not measured network performance.">
      <Dot color="var(--color-warn)" /> SCENE PREVIEW
    </Chip>
  );
}
