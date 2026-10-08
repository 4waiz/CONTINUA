/**
 * What each page's tour says, step by step. Four steps at most, each about
 * one thing on the screen: what it is, and what to do with it. Written to be
 * true of the build it ships in - the public build replays recorded runs and
 * says so - and in the same plain words as the pages themselves.
 */

import { IS_PUBLIC_PREVIEW } from '@/lib/deployment';
import type { TourStep } from './Tour';

/** The Mission page once the drive has started: what is on the screen, before it plays. */
export const DRIVE_TOUR: readonly TourStep[] = [
  {
    target: '[data-tour="mission-status"]',
    placement: 'bottom',
    title: 'Two rovers, one road',
    body: (
      <>
        This panel follows both: <strong>CONTINUA</strong>, and a <strong>normal rover</strong> that changes network
        only once the one it is on has failed. Green: its operator can reach it. Red: the link is lost, and the rover
        stops until it is back. In the 3D view each rover carries its name.
      </>
    ),
  },
  {
    target: '[data-tour="mission-networks"]',
    placement: 'right',
    title: "CONTINUA's four networks",
    body: (
      <>
        Cable, Wi-Fi, cellular and satellite. The highlighted one carries the session; in the 3D view it is the line
        from the rover&apos;s roof. When CONTINUA changes network, the camera flies out to the new one and back.
      </>
    ),
  },
  {
    target: '[data-tour="mission-scoreboard"]',
    placement: 'left',
    title: 'The score, as it happens',
    body: (
      <>
        Time without a link, frozen video, late steering commands and data sent over satellite, for both rovers, counted
        as the drive goes. Lower is better. Above them, each rover&apos;s camera view.
      </>
    ),
  },
  {
    target: '[data-tour="mission-timeline"]',
    placement: 'top',
    title: 'Watch, pause, explore',
    body: (
      <>
        The bar fills in as the drive goes: its colour is the network carrying the link, and a flag marks each change.
        Pause or drag it whenever you like. The sliders button, <strong>Change the run</strong>, tries other roads and
        strategies; <strong>Details</strong> shows every measurement. With sound on, a voice says why each change happened.
      </>
    ),
  },
];

export const RESULTS_TOUR: readonly TourStep[] = [
  {
    target: '[data-tour="results-stored"]',
    placement: 'right',
    title: 'One road, many drives',
    body: (
      <>
        Each experiment is one scenario driven twenty times by every strategy, with the same signal and the same random
        draws for all of them. <strong>Shadowed route</strong> is the road the Mission page drives.
      </>
    ),
  },
  {
    target: '[data-tour="results-glance"]',
    placement: 'bottom',
    title: 'Every drive at a glance',
    body: (
      <>
        One row per strategy, one rover per drive: green if its operator never lost the link, red if they did. On the
        right, how many drives kept it, and the relative cost - the simulator&apos;s cost model, not money.
      </>
    ),
  },
  {
    target: '[data-tour="results-charts"]',
    placement: 'top',
    title: 'What the difference is made of',
    body: (
      <>
        Interruptions, steering latency and missed deadlines, video stalls, satellite data and handovers, strategy by
        strategy. Lower is better on every chart.
      </>
    ),
  },
  {
    target: '[data-tour="results-header"]',
    placement: 'bottom',
    title: 'How it was run',
    body: IS_PUBLIC_PREVIEW ? (
      <>
        Each paired trial gave every strategy identical link conditions, with seeds from blocks that never overlap. The
        engine is Python and runs locally; this site shows what it recorded, exactly as recorded.
      </>
    ) : (
      <>
        Each paired trial gives every strategy identical link conditions, with seeds from blocks that never overlap.{' '}
        <strong>Run comparison</strong> executes a new one on the engine.
      </>
    ),
  },
];

export const DECISION_LOG_TOUR: readonly TourStep[] = [
  {
    target: '[data-tour="log-runs"]',
    placement: 'right',
    title: 'Pick a recorded run',
    body: (
      <>
        Every run the engine recorded: each scenario, with each strategy. The badge is the strategy - B0 to B2 are the
        baselines, P1 and P3 are CONTINUA.
      </>
    ),
  },
  {
    target: '[data-tour="log-decisions"]',
    placement: 'right',
    title: 'Every decision, with its reason',
    body: (
      <>
        Each change of network, when it happened and why, in the controller&apos;s own words. The switch above the list
        shows handoffs only, every action, or every event.
      </>
    ),
  },
  {
    target: '[data-tour="log-ribbon"]',
    placement: 'bottom',
    title: 'The run in one line',
    body: (
      <>
        Which network carried the session from start to finish. Click or drag along it to jump to the nearest
        decision.
      </>
    ),
  },
  {
    target: '[data-tour="log-detail"]',
    placement: 'left',
    title: 'What it was based on',
    body: (
      <>
        Select a decision to see the observations behind it; <strong>↑</strong> and <strong>↓</strong> step through the
        list. Below it, how the run ended, from its recorded metrics.
      </>
    ),
  },
];

export const SCENARIO_TOUR: readonly TourStep[] = [
  {
    target: '[data-tour="lab-scenarios"]',
    placement: 'right',
    title: 'Choose a road',
    body: IS_PUBLIC_PREVIEW ? (
      <>
        From a clean journey to the loss of every path, and the shadowed roads the Mission page drives. Pick one and it
        plays at once: every combination here was run by the engine and is replayed as recorded.
      </>
    ) : (
      <>
        From a clean journey to the loss of every path, and the shadowed roads the Mission page drives. Pick one, then
        run it with the button on the right.
      </>
    ),
  },
  {
    target: '[data-tour="lab-policy"]',
    placement: 'right',
    title: 'Choose who drives',
    body: (
      <>
        The baselines switch only after a failure, bring up a backup once trouble is measured, or keep every network on.
        CONTINUA predicts, prepares and steers; P3 also has a map of the road.
      </>
    ),
  },
  {
    target: '[data-tour="lab-summary"]',
    placement: 'left',
    title: 'What is running',
    body: <>The road, how long the drive lasts and who drives it, and what the run measures. Pause or restart it here.</>,
  },
  {
    target: '[data-tour="lab-live"]',
    placement: 'top',
    title: 'Inside the controller',
    body: (
      <>
        The four links as the rover sees them, and the step CONTINUA is on: observe, predict, prepare, steer, explain.
      </>
    ),
  },
];

export const BRIEF_TOUR: readonly TourStep[] = [
  {
    target: '[data-tour="brief-hero"]',
    placement: 'bottom',
    title: 'The question',
    body: (
      <>
        The challenge this project answers, and the two places to see the answer: the drive, and every result.
      </>
    ),
  },
  {
    target: '[data-tour="brief-criterion"]',
    placement: 'top',
    title: 'Five success criteria',
    body: (
      <>
        Each of the brief&apos;s criteria, what was built for it, and links to the evidence. They continue down the page.
      </>
    ),
  },
];
