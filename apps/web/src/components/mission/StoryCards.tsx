'use client';

/**
 * The Mission page's opening card, and the story's closing one.
 *
 * The opening says what this is in two sentences and offers one way in. The
 * closing card turns one run into evidence: the same road driven twenty times
 * by every strategy, from the stored experiment - not this run - so a viewer
 * can see that what they just watched is what happens every time.
 */

import { glanceRows, type GlanceRow } from '@/components/experiments/AtAGlance';
import { api } from '@/lib/api';
import type { PolicyIdString } from '@continua/contracts/engine';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { InfoTip } from '../ui/InfoTip';
import { PlayIcon, ReplayIcon } from '../ui/icons';
import { CHAPTERS } from './story';

/** The pre-registered comparison on the shadowed route (docs/PHASE_5_RESULTS.md). */
export const PROOF_EXPERIMENT = 'phase5-test4-shadow-survey';

/** The strategies in the comparison, in plain names, ours first. */
const PROOF_ROWS: readonly { policy: PolicyIdString; name: string }[] = [
  { policy: 'P3', name: 'CONTINUA with its road map' },
  { policy: 'B0', name: 'Normal rover' },
  { policy: 'P1', name: 'CONTINUA without the road map' },
  { policy: 'B2', name: 'Every network on, always' },
  { policy: 'B2-defer', name: 'Every network on, uploads wait' },
];

export function StoryLanding({ onDrive, busy }: { onDrive: () => void; busy: boolean }) {
  return (
    <section className="story-landing glass" aria-label="Introduction">
      <h2 className="story-landing-title">
        The network changes. <span className="brand-text">The session doesn&apos;t.</span>
      </h2>
      <p className="story-landing-body">
        Two rescue rovers take the same road, from cable to Wi-Fi, cellular and satellite - one with CONTINUA, one
        without. See which one stays connected.
      </p>
      <div className="mt-5">
        <button type="button" className="control control-primary h-[44px] px-6 text-[15px]" onClick={onDrive} disabled={busy}>
          <PlayIcon size={15} /> Drive it yourself
        </button>
      </div>
      <p className="story-landing-foot">A simulation, not a live network test.</p>
    </section>
  );
}

/**
 * The stored twenty-drive comparison on the shadowed route, as rows - loaded
 * once `enabled`. Empty until it arrives, and if it cannot.
 */
export function useProofRows(enabled: boolean): {
  rows: GlanceRow[];
  results: Record<string, unknown> | null;
  failed: boolean;
} {
  const [results, setResults] = useState<Record<string, unknown> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    api
      .getExperiment(PROOF_EXPERIMENT)
      .then((payload) => {
        if (cancelled) return;
        setResults(((payload as { results?: Record<string, unknown> }).results ?? payload) as Record<string, unknown>);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  const rows = useMemo(() => glanceRows(results, PROOF_ROWS.map((row) => row.policy)), [results]);
  return { rows, results, failed };
}

const keptOf = (row: GlanceRow | null | undefined) => (row ? row.trials.filter(Boolean).length : null);

/** How many of the drives CONTINUA with its road map and the normal rover kept the link in. */
function proofCounts(rows: GlanceRow[]): { trials: number; ours: number; normal: number } | null {
  const ours = rows.find((row) => row.policy === 'P3');
  const normal = rows.find((row) => row.policy === 'B0');
  if (!ours || !normal) return null;
  return { trials: ours.trials.length, ours: keptOf(ours) ?? 0, normal: keptOf(normal) ?? 0 };
}

/**
 * What the comparison found, in one sentence for a run's summary: what
 * CONTINUA with its road map and the normal rover did on this road, twenty
 * drives each. Null until both are in.
 */
export function proofSentence(rows: GlanceRow[]): string | null {
  const counts = proofCounts(rows);
  if (!counts) return null;
  return `On this road, ${counts.trials} drives each: CONTINUA with its road map kept the link ${counts.ours} times, the normal rover ${counts.normal}.`;
}

export function StoryProof({
  onReplay,
  onDrive,
  onNarrate,
}: {
  onReplay: () => void;
  onDrive: () => void;
  /** Read the card aloud, in the card's own words. */
  onNarrate?: (text: string) => void;
}) {
  const { rows, results, failed } = useProofRows(true);
  const row = (id: PolicyIdString) => rows.find((entry) => entry.policy === id) ?? null;
  const ours = row('P3');
  const always = row('B2');
  const deferred = row('B2-defer');
  const trials = ours?.trials.length ?? 20;
  const ratio = ours?.cost && always?.cost ? always.cost / ours.cost : null;
  // The card's sentences, written once: shown below and read aloud as they are.
  const title = `The same road, ${trials} times`;
  const counts = proofCounts(rows);
  const found = counts
    ? `CONTINUA with its road map kept the link ${counts.ours} times out of ${counts.trials}; the normal rover, ${counts.normal}.`
    : null;
  // What the comparison also found, as plainly: keeping every network on
  // stayed connected too - at a price, and with uploads held back for less.
  const rest =
    always && ratio !== null
      ? `Keeping every network on also stayed connected, at about ${ratio.toFixed(0)}× the cost${
          deferred?.cost && ours?.cost && deferred.cost < ours.cost
            ? ' - and, with big uploads held back, for less than CONTINUA'
            : ''
        }.`
      : null;
  const narration = found ? [`${title}.`, found, rest].filter(Boolean).join(' ') : null;
  useEffect(() => {
    if (narration) onNarrate?.(narration);
  }, [narration, onNarrate]);

  const provenance = results?.seed_block
    ? `Green: drives in which the operator never lost the link. ${PROOF_EXPERIMENT}: ${String(results.seed_block)} seeds, used once${
        results.code_commit ? `, code ${String(results.code_commit).slice(0, 7)}` : ''
      }. Same road, same signal and same random draws for every strategy. The full table is under Results.`
    : 'The stored comparison on this road: same signal and same random draws for every strategy.';

  return (
    <section className="story-proof glass enter" aria-label="The proof">
      <div className="story-landing-kicker">
        Chapter {CHAPTERS.length} · {CHAPTERS[CHAPTERS.length - 1]}
      </div>
      <h2 className="story-proof-title flex items-center gap-2">
        {title}
        <InfoTip text={provenance} />
      </h2>
      {found && <p className="story-proof-body font-medium text-[color:var(--color-ink)]">{found}</p>}
      {rows.length > 0 ? (
        <ul className="proof-rows" aria-label="Drives that kept the link, by strategy">
          {PROOF_ROWS.map(({ policy, name }) => {
            const entry = row(policy);
            if (!entry) return null;
            const count = keptOf(entry) ?? 0;
            return (
              <li key={policy} className="proof-row" data-ours={policy === 'P3'}>
                <span className="proof-row-name">{name}</span>
                <span className="proof-row-bar" aria-hidden>
                  <span style={{ width: `${(100 * count) / Math.max(1, entry.trials.length)}%` }} />
                </span>
                <span className="proof-row-count" data-none={count === 0}>
                  {count} of {entry.trials.length}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="py-6 text-center text-[13px] text-[color:var(--color-faint)]">
          {failed ? 'The stored comparison is not available here.' : 'Loading the stored comparison…'}
        </p>
      )}
      {rest && <p className="story-proof-note">{rest}</p>}
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <button type="button" className="control control-primary" onClick={onReplay}>
          <ReplayIcon size={15} /> Watch again
        </button>
        <button type="button" className="control" onClick={onDrive}>
          Drive it yourself
        </button>
        <Link href="/experiments" className="control no-underline">
          All the results
        </Link>
      </div>
    </section>
  );
}
