'use client';

/**
 * What CONTINUA has just decided, and why, as a short feed of sentences - the
 * Explain step of its pipeline, readable without the Decision Log.
 *
 * Each line is one decision the engine logged (`plainDecision` turns its
 * actions and reason into words; nothing is added). The newest is on top and
 * in full colour; the engine's own wording is in each line's tooltip.
 */

import type { EngineEvent, EngineLinkId } from '@continua/contracts/engine';
import { actionsOf } from '@continua/contracts/engine';
import { NETWORK_COLOR } from '@continua/scene';
import { useMemo } from 'react';
import { NetworkIcon } from '../ui/icons';
import { InfoTip } from '../ui/InfoTip';
import { plainDecision } from './plain';

function clock(t: number): string {
  const minutes = Math.floor(t / 60);
  return `${minutes}:${String(Math.floor(t - minutes * 60)).padStart(2, '0')}`;
}

export function DecisionFeed({
  decisions,
  carryingBefore,
  title = "What CONTINUA decided",
  limit = 4,
}: {
  decisions: EngineEvent[];
  /** The link that was carrying just before a time - a switch's "from". */
  carryingBefore: (t: number) => EngineLinkId | null;
  title?: string;
  limit?: number;
}) {
  const lines = useMemo(() => {
    const out: { key: number; t: number; text: string; reason: string; link: EngineLinkId | null }[] = [];
    for (let i = decisions.length - 1; i >= 0 && out.length < limit; i -= 1) {
      const event = decisions[i]!;
      const text = plainDecision(event, carryingBefore(event.t - 0.05));
      if (!text) continue;
      if (out.length && out[out.length - 1]!.text === text) continue;
      const link = actionsOf(event).find((action) => action.link)?.link ?? event.carrying ?? null;
      out.push({ key: event.seq, t: event.t, text, reason: event.reason, link });
    }
    return out;
  }, [decisions, carryingBefore, limit]);

  return (
    <section className="glass px-4 pt-3 pb-3.5" aria-label="Decisions in plain words">
      <h2 className="section-label flex items-center gap-1.5">
        {title}
        <InfoTip align="end" text="CONTINUA's decisions as it makes them, in plain words. Hover a line for the engine's own wording; every one is in the Decision log." />
      </h2>
      {lines.length === 0 ? (
        <p className="mt-2 text-[12.5px] text-[color:var(--color-faint)]">Its decisions appear here as it makes them.</p>
      ) : (
        <ol className="mt-2 flex flex-col gap-2.5">
          {lines.map((line, index) => (
            <li key={line.key} className={`flex gap-2.5 ${index === 0 ? 'drop-in' : ''}`} style={{ opacity: index === 0 ? 1 : 0.62 }} title={line.reason}>
              <span
                className="mt-[1px] grid h-6 w-6 shrink-0 place-items-center rounded-full"
                style={{
                  background: line.link ? `color-mix(in srgb, ${NETWORK_COLOR[line.link]} 13%, white)` : 'var(--color-surface-muted)',
                  color: line.link ? NETWORK_COLOR[line.link] : 'var(--color-muted)',
                }}
                aria-hidden
              >
                {line.link && <NetworkIcon link={line.link} size={13} />}
              </span>
              <span className="min-w-0">
                <span className="metric block text-[11px] font-semibold text-[color:var(--color-faint)]">{clock(line.t)}</span>
                <span className="block text-[12.5px] leading-snug text-[color:var(--color-ink)]">{line.text}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
