'use client';

/**
 * The brief, answered: the EDGE challenge's question and its five success
 * criteria, each with where in this project it is met - the two existing
 * mechanisms analysed, the adaptation proposed, the simulator, the paired
 * comparison and the guidelines drawn from it.
 *
 * Nothing here is a new measurement. The comparison block reads the stored
 * twenty-drive experiment at load (`useProofRows`), exactly as the Mission
 * page's proof card does; every figure in the guidelines is quoted from the
 * results documents, which were written against recorded experiments, and
 * names the one it comes from. What was not done is said at the foot.
 */

import Link from 'next/link';
import { AppShell } from './AppShell';
import { AtAGlance } from './experiments/AtAGlance';
import { PROOF_EXPERIMENT, useProofRows } from './mission/StoryCards';
import { REPO_URL } from '@/lib/deployment';
import { CompareIcon, FlightIcon, NetworkIcon, PlayIcon, RoadMapIcon } from './ui/icons';

const doc = (path: string) => `${REPO_URL}/blob/main/${path}`;

/** The five success criteria of the brief, in its own order, and where each is met. */
const CRITERIA: readonly {
  n: string;
  asked: string;
  done: string;
  where: readonly { label: string; href: string; external?: boolean }[];
}[] = [
  {
    n: '01',
    asked: 'Investigate existing seamless-connectivity mechanisms, with one or two key references analysed.',
    done: 'Multipath TCP (IETF RFC 8684) and 3GPP ATSSS (TS 23.501 §5.32, TS 24.193): what each gives a moving session, what it leaves missing - and each one’s behaviour modelled as a baseline to beat.',
    where: [{ label: 'The two references, below', href: '#mechanisms' }],
  },
  {
    n: '02',
    asked: 'Propose an improved or adapted mechanism.',
    done: 'CONTINUA: observe every link, predict the risk, prepare the next path before the current one fails, steer each kind of traffic on its own merits, and explain every decision. With a map of the road it also prepares for a dead zone that takes two networks at once.',
    where: [
      { label: 'How it decides', href: '#mechanism' },
      { label: 'Every decision, with its reason', href: '/decision-log' },
    ],
  },
  {
    n: '03',
    asked: 'Simulate, emulate or prototype it.',
    done: 'A deterministic engine models four access paths - queues, capacity, delay, jitter, burst loss, activation delay and per-byte cost - carrying five real traffic classes, and a 3D world shows the rover, its links and every handoff.',
    where: [
      { label: 'Drive it yourself', href: '/' },
      { label: 'Build a scenario', href: '/scenario-lab' },
    ],
  },
  {
    n: '04',
    asked: 'Compare the existing and proposed mechanisms through simulation.',
    done: 'Paired trials - the same road, signal and random draws for every strategy - on seed blocks fixed before any tuning, with the losses and the costs of acting early in the same tables as the wins.',
    where: [
      { label: 'The comparison on the shadowed road, below', href: '#comparison' },
      { label: 'Every result', href: '/experiments' },
    ],
  },
  {
    n: '05',
    asked: 'Create guidelines for improving quality of service and experience.',
    done: 'Seven, each drawn from a measured result and naming the experiment it comes from - including the two places where prediction did not pay.',
    where: [{ label: 'The guidelines, below', href: '#guidelines' }],
  },
];

const MECHANISMS: readonly {
  name: string;
  ref: string;
  gives: string;
  missing: string;
  modelled: string;
}[] = [
  {
    name: 'Single path, switch after it breaks',
    ref: 'What a session does with no continuity layer',
    gives: 'Simple, and available everywhere.',
    missing: 'A change of address ends the session, and the move only starts once the old network has already failed.',
    modelled: 'B0 - the "normal rover"',
  },
  {
    name: 'Multipath TCP',
    ref: 'IETF RFC 8684',
    gives: 'One connection over several subflows on different interfaces; a subflow can stand by as a backup and take over when the others fail.',
    missing: 'The transport layer does not know which traffic is mission-critical, nor where along the road the coverage will fail next.',
    modelled: 'B1 - reactive multipath, a backup started once trouble is measured. An MPTCP-inspired model, not MPTCP.',
  },
  {
    name: 'Access Traffic Steering, Switching and Splitting (ATSSS)',
    ref: '3GPP TS 23.501 §5.32 · TS 24.193',
    gives: 'Per-flow rules across 3GPP and non-3GPP access - active-standby, smallest delay, load-balancing, priority-based, and in later releases redundant duplication.',
    missing: 'Rules are configured ahead of time and switch on measured performance; duplicating everything keeps the session but pays for every byte twice.',
    modelled: 'B2 - every path on, always (and B2-defer, the same with big uploads held back). Modelled behaviour, not an ATSSS stack.',
  },
];

const GUIDELINES: readonly { title: string; body: string; evidence: string; source: string; href: string }[] = [
  {
    title: 'Keep the next network warm before you need it.',
    body: 'A session survives a handoff when the path it moves to is already up. That - not a forecast - is what removes the interruption: CONTINUA with its forecast switched off keeps the session just as well.',
    evidence: 'Wi-Fi fading, 20 paired drives: the single-path rover reconnects once and is cut off 7.32 s per drive; CONTINUA, 0 reconnects and 0.16 s (the session’s start-up) - the same as keeping every network on, on 4.8 MB of satellite instead of 61.2 MB.',
    source: 'wifi-degradation · test block, seeds 70 000-70 019',
    href: doc('docs/PROGRESS.md'),
  },
  {
    title: 'Where two networks fail at the same place, prepare from a map of the route.',
    body: 'A warm backup cannot help when a cutting takes Wi-Fi and the cell together. Looking the next 8 s of road up in a map built from earlier drives, and starting satellite in time, is what kept the session.',
    evidence: 'P3 - P1: -4.50 s interruption and -1.00 reconnect per drive on all four shadowed scenarios, and -1.00 safe stop on three. Kept the link: 20 of 20 drives, against 0 of 20 for the normal rover.',
    source: `Phase 5 reading, finding 2 · ${PROOF_EXPERIMENT}`,
    href: doc('docs/PHASE_5_RESULTS.md'),
  },
  {
    title: 'Steer each kind of traffic on its own merits.',
    body: 'Steering commands, video, telemetry and bulk uploads do not need the same path. Moving control onto whichever ready path meets its deadline helped in every scenario, at no extra cost.',
    evidence: '+0.9 to +3.1 points of teleop availability and 1.0-3.2 s less unsupported time, all eight scenarios, every interval excluding zero.',
    source: 'Phase 4 reading, finding 2',
    href: doc('docs/PHASE_4_RESULTS.md'),
  },
  {
    title: 'Duplicate what matters, not everything; hold back bulk under strain.',
    body: 'Keeping every network on keeps the session too - at a price. Pausing big uploads while the link is under strain is the cheap half of the saving.',
    evidence: 'On the shadowed road P3 costs 17-32 % of always-on redundancy and carries 55-68 MB less satellite per drive; bulk deferral alone removes 43-69 MB.',
    source: 'Phase 5 reading, finding 4 · Phase 4 reading, finding 4',
    href: doc('docs/PHASE_5_RESULTS.md'),
  },
  {
    title: 'Do not expect a forecast of a link’s own trend to save you.',
    body: 'Measured first: with a warm backup always ready, an earlier switch could have improved almost nothing - and anticipating a change of driving mode cost more than it saved.',
    evidence: 'At most 0.34 % of any class’s deadline misses or video stall was within reach of an earlier switch; anticipating mode changes cost 1.8-5.5 points of teleop availability.',
    source: 'Phase 5 reading, finding 1 · Phase 4 reading, finding 3',
    href: doc('docs/PHASE_5_RESULTS.md'),
  },
  {
    title: 'Keep the map fresh.',
    body: 'A road map is only as good as its last survey. One that remembers a cutting that has gone, and misses one that stands 50 m on, prepares for the wrong place.',
    evidence: 'On shadow-stale, continuity is exactly P1’s and the wasted preparation costs +0.40 units.',
    source: 'Phase 5 reading, finding 6',
    href: doc('docs/PHASE_5_RESULTS.md'),
  },
  {
    title: 'Count the cost of acting early in the same table as the wins.',
    body: 'Starting a path early, or starting it again, has a price. A strategy that keeps every path on and pays once can be the cheaper one - say so.',
    evidence: 'Against B2-defer, P3 costs 0.43-0.44 units more on two shadowed scenarios: it releases and re-activates satellite where B2-defer keeps it on.',
    source: 'Phase 5 reading, finding 5',
    href: doc('docs/PHASE_5_RESULTS.md'),
  },
];

const PIPELINE: readonly { step: string; what: string }[] = [
  { step: 'Observe', what: 'Round trip, loss, jitter and throughput on every link, from delivered packets - never from the map of coverage.' },
  { step: 'Predict', what: 'The risk on the carrying link; with the road map, where the networks are lost ahead.' },
  { step: 'Prepare', what: 'Bring the next path up - and validate it - before it is needed.' },
  { step: 'Steer', what: 'Switch, split or duplicate per traffic class; hold back bulk; change driving mode when the link cannot carry live steering.' },
  { step: 'Explain', what: 'Record every decision with the observations and the reason behind it.' },
];

function ProofBlock() {
  const { rows, results, failed } = useProofRows(true);
  const ours = rows.find((row) => row.policy === 'P3');
  const normal = rows.find((row) => row.policy === 'B0');
  const always = rows.find((row) => row.policy === 'B2');
  const kept = (row: typeof ours) => (row ? row.trials.filter(Boolean).length : null);
  const ratio = ours?.cost && always?.cost ? ours.cost / always.cost : null;
  return (
    <div className="doc-proof">
      <div className="doc-stats">
        <div className="doc-stat" data-tone="good">
          <span className="doc-stat-value metric">{ours ? `${kept(ours)}/${ours.trials.length}` : '-'}</span>
          <span className="doc-stat-label">drives in which CONTINUA with its road map kept the link</span>
        </div>
        <div className="doc-stat" data-tone="bad">
          <span className="doc-stat-value metric">{normal ? `${kept(normal)}/${normal.trials.length}` : '-'}</span>
          <span className="doc-stat-label">for the normal rover, which switches only after its network fails</span>
        </div>
        <div className="doc-stat" data-tone="blue">
          <span className="doc-stat-value metric">{ratio !== null ? `${Math.round(ratio * 100)} %` : '-'}</span>
          <span className="doc-stat-label">of the cost of keeping every network on, for the same continuity</span>
        </div>
      </div>
      {rows.length > 0 ? (
        <AtAGlance rows={rows} highlight="P3" compact />
      ) : (
        <p className="doc-muted">{failed ? 'The stored comparison is not available here.' : 'Loading the stored comparison…'}</p>
      )}
      <p className="doc-footnote">
        {PROOF_EXPERIMENT}
        {results?.seed_block ? ` · ${String(results.seed_block)} seed block` : ''} · each icon is one drive, the same seed for every
        strategy · green: the operator never lost the link · cost: the simulator&apos;s relative cost model, not money.
      </p>
    </div>
  );
}

export function ChallengeView() {
  return (
    <AppShell>
      <div className="doc-scroll scroll-y h-full">
        <article className="doc">
          <header className="doc-hero glass">
            <div className="doc-kicker">EDGE challenge · Advanced Technology Pioneers 2026</div>
            <h1 className="doc-title">
              How might we keep a user&apos;s experience unbroken as they move between Wi-Fi, mobile, satellite and wired
              networks?
            </h1>
            <p className="doc-lede">
              <span className="brand-text font-semibold">CONTINUA</span> readies the next network before the current one
              fails, steers each kind of traffic on its own merits - and, with a map of the road, prepares for a dead zone
              before it takes two networks at once. Below: each of the brief&apos;s five success criteria, and where this
              project meets it.
            </p>
            <div className="doc-actions">
              <Link href="/" className="control control-primary no-underline">
                <PlayIcon size={15} /> Drive it yourself
              </Link>
              <Link href="/experiments" className="control no-underline">
                <CompareIcon size={15} /> Every result
              </Link>
            </div>
          </header>

          <section aria-labelledby="criteria" className="doc-section">
            <h2 id="criteria" className="doc-h2">
              The five success criteria
            </h2>
            <ol className="doc-criteria">
              {CRITERIA.map((criterion) => (
                <li key={criterion.n} className="doc-criterion glass">
                  <span className="doc-criterion-n metric">{criterion.n}</span>
                  <div className="min-w-0">
                    <p className="doc-asked">{criterion.asked}</p>
                    <p className="doc-done">{criterion.done}</p>
                    <p className="doc-where">
                      {criterion.where.map((where) =>
                        where.href.startsWith('#') || where.external ? (
                          <a key={where.label} href={where.href}>
                            {where.label}
                          </a>
                        ) : (
                          <Link key={where.label} href={where.href}>
                            {where.label}
                          </Link>
                        ),
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section id="mechanisms" aria-labelledby="mechanisms-title" className="doc-section">
            <h2 id="mechanisms-title" className="doc-h2">
              01 · What exists, and what it leaves missing
            </h2>
            <p className="doc-p">
              Two key references, analysed for a vehicle that moves from cable to Wi-Fi, cellular and satellite. Each
              one&apos;s behaviour became a baseline CONTINUA is compared against - modelled in the same engine, from the
              same class with different flags, so no baseline is quietly worse than it needs to be.
            </p>
            <div className="doc-table-wrap glass">
              <table className="doc-table">
                <thead>
                  <tr>
                    <th>Mechanism</th>
                    <th>What it gives a moving session</th>
                    <th>What is still missing</th>
                    <th>In the comparison</th>
                  </tr>
                </thead>
                <tbody>
                  {MECHANISMS.map((mechanism) => (
                    <tr key={mechanism.name}>
                      <td>
                        <strong>{mechanism.name}</strong>
                        <span className="doc-ref">{mechanism.ref}</span>
                      </td>
                      <td>{mechanism.gives}</td>
                      <td>{mechanism.missing}</td>
                      <td>{mechanism.modelled}</td>
                    </tr>
                  ))}
                  <tr data-ours="true">
                    <td>
                      <strong className="brand-text">CONTINUA</strong>
                      <span className="doc-ref">This project</span>
                    </td>
                    <td>Predicts the risk, prepares the next path before failure, and treats each traffic class by what it needs.</td>
                    <td>With a map of the road (P3), also sees a dead zone that takes the carrying path and its backup together.</td>
                    <td>P1, and P3 with the road map</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section id="mechanism" aria-labelledby="mechanism-title" className="doc-section">
            <h2 id="mechanism-title" className="doc-h2">
              02 · The adapted mechanism
            </h2>
            <ol className="doc-pipeline">
              {PIPELINE.map((stage, index) => (
                <li key={stage.step} className="doc-stage glass">
                  <span className="doc-stage-n metric">0{index + 1}</span>
                  <strong>{stage.step}</strong>
                  <span>{stage.what}</span>
                </li>
              ))}
            </ol>
            <div className="doc-callout glass">
              <span className="doc-callout-icon" aria-hidden>
                <RoadMapIcon size={18} />
              </span>
              <p>
                <strong>The road map.</strong> A warm backup covers the common case. The case it cannot cover is a stretch of
                road where the carrying network and its backup are lost together - a cutting that blocks Wi-Fi and the cell at
                once. P3 looks the next 8 s of its route up in a radio map built from earlier survey drives on a separate seed
                block and, where both are lost ahead, starts a third path in time. It is the one place in this project where
                prediction changes the outcome.
              </p>
            </div>
          </section>

          <section aria-labelledby="sim-title" className="doc-section">
            <h2 id="sim-title" className="doc-h2">
              03 · Simulated, and shown as it happens
            </h2>
            <div className="doc-grid">
              <div className="doc-card glass">
                <NetworkIcon link="satellite" size={18} />
                <strong>Four access paths, five traffic classes</strong>
                <p>
                  Cable, Wi-Fi, cellular and satellite, each with finite queues, capacity, delay, jitter, correlated burst loss,
                  activation delay, competing demand and per-byte cost - carrying steering commands, telemetry, video, voice
                  and bulk uploads. Deterministic: the same scenario and seed give the same run.
                </p>
              </div>
              <div className="doc-card glass">
                <FlightIcon size={18} />
                <strong>See where each link comes from</strong>
                <p>
                  At every change of network the camera flies out to the new link&apos;s far end - the access point, the mast,
                  the sky over the satellite link - and rides the beam back to the rover.
                </p>
              </div>
            </div>
          </section>

          <section id="comparison" aria-labelledby="comparison-title" className="doc-section">
            <h2 id="comparison-title" className="doc-h2">
              04 · Compared, on the same road twenty times
            </h2>
            <p className="doc-p">
              The shadowed road - a cutting that blocks Wi-Fi and the cell together - driven twenty times by every
              strategy, with the same signal and the same random draws for each. Read from the stored experiment as this
              page loads.
            </p>
            <ProofBlock />
          </section>

          <section id="guidelines" aria-labelledby="guidelines-title" className="doc-section">
            <h2 id="guidelines-title" className="doc-h2">
              05 · Guidelines for quality of service and experience
            </h2>
            <p className="doc-p">
              Each one is drawn from a measured result, and says which. The ranges span the scenarios of that experiment.
            </p>
            <ol className="doc-guidelines">
              {GUIDELINES.map((guideline, index) => (
                <li key={guideline.title} className="doc-guideline glass">
                  <span className="doc-guideline-n metric">{index + 1}</span>
                  <div className="min-w-0">
                    <h3>{guideline.title}</h3>
                    <p>{guideline.body}</p>
                    <p className="doc-evidence">{guideline.evidence}</p>
                    <a className="doc-source" href={guideline.href} target="_blank" rel="noreferrer">
                      {guideline.source}
                    </a>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="scope-title" className="doc-section">
            <h2 id="scope-title" className="doc-h2">
              What this is not
            </h2>
            <ul className="doc-scope glass">
              <li>A software simulation. No radios, no satellite and no hardware; the shaped cellular profile is not 5G.</li>
              <li>
                Not MPTCP and not ATSSS: their behaviours are modelled. Network emulation and kernel MPTCP were probed on the
                development host and are not verified there.
              </li>
              <li>
                The road map is exact here, because coverage in the simulator is a function of position; a real survey map is
                noisy and ages.
              </li>
              <li>The shadowed road is a scenario family built to isolate the one case foresight can change, declared before its test run.</li>
            </ul>
            <p className="doc-footnote">
              The method, the assumptions and every result, with the losses:{' '}
              <a href={doc('docs/EXPERIMENT_METHOD.md')} target="_blank" rel="noreferrer">
                experiment method
              </a>
              ,{' '}
              <a href={doc('docs/ASSUMPTIONS.md')} target="_blank" rel="noreferrer">
                assumptions
              </a>
              ,{' '}
              <a href={doc('docs/PROGRESS.md')} target="_blank" rel="noreferrer">
                progress
              </a>
              .
            </p>
          </section>
        </article>
      </div>
    </AppShell>
  );
}
