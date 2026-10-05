'use client';

/**
 * The story's opening and closing cards.
 *
 * The opening says what this is in three sentences and offers the two ways in.
 * The closing card turns one run into evidence: the same road driven twenty
 * times by every strategy, from the stored experiment - not this run - so a
 * viewer can see that what they just watched is what happens every time.
 */

import { AtAGlance, glanceRows } from '@/components/experiments/AtAGlance';
import { api } from '@/lib/api';
import type { PolicyIdString } from '@continua/contracts/engine';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PlayIcon, ReplayIcon } from '../ui/icons';
import { CHAPTERS } from './story';

/** The pre-registered comparison on the shadowed route (docs/PHASE_5_RESULTS.md). */
export const PROOF_EXPERIMENT = 'phase5-test4-shadow-survey';
const PROOF_ORDER: readonly PolicyIdString[] = ['P3', 'P1', 'B0', 'B2', 'B2-defer'];

export function StoryLanding({
  onWatch,
  onDrive,
  canWatch,
  busy,
}: {
  onWatch: () => void;
  onDrive: () => void;
  /** The story's two runs can be started (the engine is up, or they were recorded). */
  canWatch: boolean;
  busy: boolean;
}) {
  return (
    <section className="story-landing glass" aria-label="Introduction">
      <div className="story-landing-kicker">One rover · four networks · no dropped link</div>
      <h2 className="story-landing-title">
        The network changes. <span className="brand-text">The session doesn&apos;t.</span>
      </h2>
      <p className="story-landing-body">
        A rescue rover is driven from far away. On its way it moves from a cable, to Wi-Fi, to cellular, to satellite -
        and its operator must never lose the link. Watch two rovers take the same road: one with CONTINUA, one that only
        switches network after the one it is on has failed.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-2.5">
        <button type="button" className="control control-primary h-[42px] px-5 text-[14.5px]" onClick={onWatch} disabled={!canWatch || busy}>
          <PlayIcon size={15} /> Watch the story · 1 min
        </button>
        <button type="button" className="control h-[42px] px-5 text-[14.5px]" onClick={onDrive}>
          Drive it yourself
        </button>
      </div>
      <p className="story-landing-foot">
        A simulation, not a live network test. Every number on screen comes from the run you are watching.
      </p>
    </section>
  );
}

export function StoryProof({ onReplay, onDrive }: { onReplay: () => void; onDrive: () => void }) {
  const [results, setResults] = useState<Record<string, unknown> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
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
  }, []);
  const rows = useMemo(() => glanceRows(results, PROOF_ORDER), [results]);
  const row = (id: PolicyIdString) => rows.find((entry) => entry.policy === id) ?? null;
  const ours = row('P3');
  const noMap = row('P1');
  const always = row('B2');
  const kept = (entry: typeof ours) => (entry ? entry.trials.filter(Boolean).length : null);
  const ratio = ours?.cost && always?.cost ? always.cost / ours.cost : null;
  const trials = ours?.trials.length ?? 20;

  return (
    <section className="story-proof glass enter" aria-label="The proof">
      <div className="story-landing-kicker">
        Chapter {CHAPTERS.length} · {CHAPTERS[CHAPTERS.length - 1]}
      </div>
      <h2 className="story-proof-title">The same road, driven {trials} times by every strategy</h2>
      <p className="story-proof-body">
        Same signal every time; only the strategy changes. Each rover is one drive:{' '}
        <span className="font-semibold text-[color:var(--color-good)]">green</span> if the operator never lost the link,{' '}
        <span className="font-semibold text-[color:var(--color-bad)]">red</span> if they did.
      </p>
      {rows.length > 0 ? (
        <AtAGlance rows={rows} highlight="P3" />
      ) : (
        <p className="py-6 text-center text-[13px] text-[color:var(--color-faint)]">
          {failed ? 'The stored comparison is not available here.' : 'Loading the stored comparison…'}
        </p>
      )}
      {ours && noMap && (
        <ul className="story-proof-points">
          <li>
            <strong>
              With the road map, CONTINUA kept the link in {kept(ours)} of {trials} drives
            </strong>
            ; without it, in {kept(noMap)} of {trials}.
          </li>
          <li>
            {always && ratio !== null ? `Every network on, all the time, kept it too - at about ${ratio.toFixed(1)}× the cost. ` : ''}
            With big uploads held back it kept it for less than CONTINUA; an out-of-date road map costs extra and saves
            nothing.
          </li>
        </ul>
      )}
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
        {Boolean(results?.seed_block) && (
          <span className="ml-auto text-[11px] text-[color:var(--color-faint)]">
            {PROOF_EXPERIMENT} · {String(results?.seed_block)} seeds, used once
            {results?.code_commit ? ` · ${String(results.code_commit).slice(0, 7)}` : ''}
          </span>
        )}
      </div>
    </section>
  );
}
