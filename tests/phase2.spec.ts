/**
 * Phase 2 browser tests.
 *
 * These run against the production build with the engine actually running, and
 * they check the claims the dashboard makes: that it is driven by computed
 * experiment state, that unavailable measurements are shown as unavailable, that
 * every control does something, and that a lost backend is reported rather than
 * papered over.
 *
 * Requires the engine on 127.0.0.1:8000 (`npm run engine`), or wherever
 * `CONTINUA_ENGINE` points when that port is taken.
 */

import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

const EVIDENCE = 'tests/output/evidence';
const ENGINE = process.env.CONTINUA_ENGINE ?? 'http://127.0.0.1:8000';

const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /THREE\.WebGLRenderer: Context Lost/i,
  /Multiple instances of Three\.js/i,
  /THREE\.\w+: .*deprecated/i,
];

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (IGNORED_CONSOLE.some((pattern) => pattern.test(text))) return;
    errors.push(text);
  });
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
}

async function requireEngine(page: Page): Promise<void> {
  const response = await page.request.get(`${ENGINE}/api/health`).catch(() => null);
  if (!response || !response.ok()) {
    throw new Error(
      `CONTINUA engine is not reachable at ${ENGINE}. Start it with: npm run engine`,
    );
  }
}

/**
 * The guided tours (apps/web/src/components/onboarding) open on a first visit,
 * and the first drive's is modal. These tests drive the pages themselves, so
 * each starts with the tours marked as taken - all but the test of the tour.
 */
const TOURS = ['mission-drive', 'results', 'decision-log', 'scenario-builder', 'brief'];

test.beforeEach(async ({ page }, testInfo) => {
  if (testInfo.title.includes('first drive')) return;
  await page.addInitScript((ids: string[]) => {
    try {
      for (const id of ids) window.localStorage.setItem(`continua.tour.${id}.v1`, 'done');
    } catch {
      // No storage: the tests that need the tours closed will say so.
    }
  }, TOURS);
});

/**
 * The Mission page opens on its introduction; one click starts the featured
 * run and shows the controls, which can start another.
 */
async function openDrive(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Watch the two rovers' }).click({ timeout: 60_000 });
}

/** Start a run through the UI and wait until events are flowing. */
async function startRun(page: Page, scenario?: string): Promise<void> {
  await openDrive(page);
  // What to run is chosen in one popover over the bar.
  await page.getByRole('button', { name: 'Change the run' }).click();
  if (scenario) {
    await page.getByLabel('Scenario').first().selectOption({ label: scenario });
  }
  await page.getByRole('button', { name: /Start run/ }).click();
  await expect(page.getByText('CONNECTED', { exact: true })).toBeVisible({ timeout: 30_000 });
  await page.waitForFunction(
    () => {
      const canvas = document.querySelector('canvas');
      return Boolean(canvas && canvas.clientWidth > 0);
    },
    undefined,
    { timeout: 60_000 },
  );
  // Wait until the engine has actually assigned a carrying path. The first
  // event carries no *action* (a session being established is not a switch), so
  // waiting on the decision list would wait forever.
  await page.waitForFunction(
    () => {
      const api = (
        window as unknown as { __CONTINUA__?: { getFrame: () => { active: string | null } } }
      ).__CONTINUA__;
      return Boolean(api && api.getFrame().active);
    },
    undefined,
    { timeout: 45_000 },
  );
}

// ---------------------------------------------------------------------------

test.describe('Mission dashboard', () => {
  test('is driven by engine state, not by constants', async ({ page }, testInfo) => {
    const errors = consoleErrors(page);
    await requireEngine(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    await expect(page.getByRole('heading', { name: 'CONTINUA', level: 1 })).toBeVisible();
    await expect(page.getByText('Predictive Network Continuity')).toBeVisible();
    await expect(page.getByText('by Team Kanban')).toBeVisible();

    // Mode must be visible before anything else is believed.
    await startRun(page);
    await expect(page.getByText('SIMULATION', { exact: true })).toBeVisible();

    // Values must actually move. A dashboard of constants would pass a
    // screenshot test and fail this one.
    const readDistance = () =>
      page.evaluate(() => {
        const api = (window as unknown as { __CONTINUA__?: { getFrame: () => { vehicle: { distance: number } } } })
          .__CONTINUA__;
        return api ? api.getFrame().vehicle.distance : -1;
      });
    const first = await readDistance();
    // Every run holds the rover at the dock for its first seconds
    // (`vehicle.dockDwellS` in world.json), so a fixed 3.5 s window could fall
    // entirely inside the dwell when the page loads quickly. Wait for movement
    // instead - bounded, so a dashboard of constants still fails.
    await expect
      .poll(readDistance, { timeout: 20_000, message: 'the vehicle must actually travel' })
      .toBeGreaterThan(first);

    await page.screenshot({ path: `${EVIDENCE}/p2-mission-${testInfo.project.name}.png` });
    expect(errors, errors.join(' | ')).toEqual([]);
  });

  test('opens the first drive on a short tour, then plays it', async ({ page }) => {
    const errors = consoleErrors(page);
    await requireEngine(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await openDrive(page);

    // Held at its start while the screen is explained.
    const tour = page.getByRole('dialog', { name: 'How to read the drive' });
    await expect(tour).toBeVisible({ timeout: 45_000 });
    await expect(tour.getByText('Step 1 of 4')).toBeVisible();
    const clock = () => page.locator('input[aria-label="Run timeline"]').inputValue().then(Number);
    // The hold is a pause and a seek on the engine: wait for them to land.
    await expect.poll(clock, { timeout: 15_000, message: 'held near its start' }).toBeLessThan(1.5);
    const held = await clock();
    await page.waitForTimeout(1500);
    expect(Math.abs((await clock()) - held), 'the drive waits for the tour').toBeLessThan(0.3);

    for (let step = 2; step <= 4; step += 1) {
      await tour.getByRole('button', { name: 'Next' }).click();
      await expect(tour.getByText(`Step ${step} of 4`)).toBeVisible();
    }
    await tour.getByRole('button', { name: 'Start the drive' }).click();
    await expect(tour).toBeHidden();
    await expect.poll(clock, { timeout: 15_000, message: 'the drive plays once the tour is done' }).toBeGreaterThan(held + 1);

    // Taken once, it does not come back by itself - but the Guide brings it back.
    await page.getByRole('button', { name: 'Guide' }).click();
    await expect(tour).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(tour).toBeHidden();
    expect(errors, errors.join(' | ')).toEqual([]);
  });

  test('a ?tour link opens the drive tour again for a browser that has seen it', async ({ page }) => {
    const errors = consoleErrors(page);
    await requireEngine(page);
    await page.goto('/?tour', { waitUntil: 'domcontentloaded' });
    await openDrive(page);

    // Opened by the drive's own start, at the hold - once.
    const tour = page.getByRole('dialog', { name: 'How to read the drive' });
    await expect(tour).toBeVisible({ timeout: 45_000 });
    await expect(tour.getByText('Step 1 of 4')).toBeVisible();
    const clock = () => page.locator('input[aria-label="Run timeline"]').inputValue().then(Number);
    await expect.poll(clock, { timeout: 15_000, message: 'held near its start' }).toBeLessThan(1.5);
    const held = await clock();

    // Skipped, the drive still starts.
    await tour.getByRole('button', { name: 'Skip tour' }).click();
    await expect(tour).toBeHidden();
    await expect.poll(clock, { timeout: 15_000, message: 'the drive plays once the tour is skipped' }).toBeGreaterThan(held + 1);
    await page.waitForTimeout(1500);
    await expect(tour).toBeHidden();
    expect(errors, errors.join(' | ')).toEqual([]);
  });

  test('renders unavailable measurements as unavailable, never as zero', async ({ page }) => {
    await requireEngine(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await startRun(page);

    // The measurements are behind Details; the simple view names states in words.
    await page.getByRole('button', { name: 'Details' }).click();
    // Select the satellite card: it has no RSSI, and early in the run it has no
    // acknowledged samples either.
    await page.getByRole('button', { name: /Satellite/ }).first().click();
    await expect(
      page.getByText('RSSI is a Wi-Fi measurement', { exact: false }).first(),
    ).toBeVisible({ timeout: 15_000 });

    // Nothing anywhere may claim an RSSI for a non-Wi-Fi link.
    // `getFrame()` returns the scene-facing state, whose optional measurements
    // are camelCase and are *absent* when they do not exist.
    const rssiClaims = await page.evaluate(() => {
      const api = (
        window as unknown as {
          __CONTINUA__?: { getFrame: () => { links: Record<string, { rssiDbm?: number }> } };
        }
      ).__CONTINUA__;
      if (!api) return [];
      const frame = api.getFrame();
      return Object.entries(frame.links ?? {})
        .filter(([link, obs]) => link !== 'wifi' && obs && obs.rssiDbm !== undefined)
        .map(([link]) => link);
    });
    expect(rssiClaims, 'only Wi-Fi has an RSSI').toEqual([]);
  });

  test('transport controls all do something', async ({ page }) => {
    await requireEngine(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await startRun(page);

    const clockText = () => page.locator('input[aria-label="Run timeline"]').inputValue();

    await page.waitForTimeout(2000);
    const running = Number(await clockText());
    expect(running).toBeGreaterThan(0);

    await page.getByRole('button', { name: /Pause/ }).click();
    await page.waitForTimeout(1500);
    const paused = Number(await clockText());
    await page.waitForTimeout(1500);
    const stillPaused = Number(await clockText());
    expect(Math.abs(stillPaused - paused), 'pause must stop the clock').toBeLessThan(0.5);

    await page.getByRole('button', { name: /Reset/ }).click();
    await expect
      .poll(async () => Number(await clockText()), { timeout: 15_000 })
      .toBeLessThan(1);

    // Seek forward.
    await page.locator('input[aria-label="Run timeline"]').fill('40');
    await expect.poll(async () => Number(await clockText()), { timeout: 15_000 }).toBeGreaterThan(35);
  });

  test('draws the normal rover beside the run, standing while its own link is down', async ({ page }) => {
    const errors = consoleErrors(page);
    await requireEngine(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    // The way in starts the featured pair: the shadowed route, CONTINUA beside the normal rover.
    await openDrive(page);

    type Span = { from: number; to: number };
    type Sample = { held?: number; sessionDown?: boolean; vehicle: { distance: number; speedMps: number } };
    type Source = { runId: string; sampleAt: (t: number) => Sample; downSpans: () => Span[] };
    type Api = {
      source: Source;
      settings: { get: () => { companion: Source | null } };
      three?: { scene?: { traverse: (visit: (node: { name: string }) => void) => void } };
    };

    // Both rovers are in the scene, and the second one is the normal rover's own run.
    const ids = await page
      .waitForFunction(
        () => {
          const api = (window as unknown as { __CONTINUA__?: Api }).__CONTINUA__;
          const companion = api?.settings.get().companion;
          let drawn = false;
          api?.three?.scene?.traverse((node) => {
            if (node.name === 'CONTINUA_Rover_Normal') drawn = true;
          });
          return api && companion && drawn ? { main: api.source.runId, base: companion.runId } : null;
        },
        undefined,
        { timeout: 120_000 },
      )
      .then((handle) => handle.jsonValue());
    expect(ids.base).not.toBe(ids.main);

    // Hurry both runs past the cutting, through the engine's own control.
    for (const id of [ids.main, ids.base]) {
      await page.request.post(`${ENGINE}/api/runs/${id}/control`, { data: { action: 'speed', speed: 8 } });
    }

    // The normal rover's receiver reports its link down for more than two
    // seconds in the cutting...
    const span = await page
      .waitForFunction(
        () => {
          const companion = (window as unknown as { __CONTINUA__?: Api }).__CONTINUA__?.settings.get().companion;
          return companion?.downSpans().find((down) => down.to !== Infinity && down.to - down.from > 2) ?? null;
        },
        undefined,
        { timeout: 90_000 },
      )
      .then((handle) => handle.jsonValue());

    // ...and the scene draws it standing then, while CONTINUA drives on, and
    // moving again once its link is back.
    const seen = await page.evaluate(({ from, to }) => {
      const api = (window as unknown as { __CONTINUA__: Api }).__CONTINUA__;
      const companion = api.settings.get().companion!;
      // Half-way through, and past the watchdog's grace and the braking.
      const mid = Math.max((from + to) / 2, from + 1.7);
      const standing = companion.sampleAt(mid);
      const main = api.source.sampleAt(mid);
      const after = companion.sampleAt(to + 3);
      return {
        held: standing.held ?? 0,
        speed: standing.vehicle.speedMps,
        down: standing.sessionDown === true,
        mainDown: main.sessionDown === true,
        mainSpeed: main.vehicle.speedMps,
        ahead: main.vehicle.distance - standing.vehicle.distance,
        afterHeld: after.held ?? 0,
        afterSpeed: after.vehicle.speedMps,
      };
    }, span);
    expect(seen.down, 'the normal rover is cut off then').toBe(true);
    expect(seen.held, 'and drawn standing').toBe(1);
    expect(seen.speed).toBe(0);
    expect(seen.mainDown, 'CONTINUA keeps its link').toBe(false);
    expect(seen.mainSpeed, 'and drives on').toBeGreaterThan(1);
    expect(seen.ahead, 'so it is drawn ahead').toBeGreaterThan(5);
    expect(seen.afterHeld, 'the normal rover pulls away once its link is back').toBeLessThan(0.01);
    expect(seen.afterSpeed).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });

  test('replay identifies its source run and mode', async ({ page }, testInfo) => {
    await requireEngine(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await startRun(page);
    await page.waitForTimeout(3000);

    await page.getByRole('button', { name: /Replay/ }).click();
    await expect(page.getByText(/REPLAY/)).toBeVisible({ timeout: 30_000 });

    // A replay must not be presented as live.
    const badge = await page.getByText(/REPLAY/).first().getAttribute('title');
    expect(badge).toContain('Replay of');
    await page.screenshot({ path: `${EVIDENCE}/p2-replay-${testInfo.project.name}.png` });
  });
});

// ---------------------------------------------------------------------------

test.describe('other sections', () => {
  test('scenario lab launches a configured run', async ({ page }, testInfo) => {
    const errors = consoleErrors(page);
    await requireEngine(page);
    await page.goto('/scenario-lab', { waitUntil: 'domcontentloaded' });

    await page.getByRole('button', { name: /video/i }).first().click(); // toggle a workload class
    await page.getByRole('button', { name: /Run scenario/ }).first().click();
    await expect(page.getByText('CONNECTED', { exact: true })).toBeVisible({ timeout: 40_000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `${EVIDENCE}/p2-scenario-lab-${testInfo.project.name}.png` });
    expect(errors, errors.join(' | ')).toEqual([]);
  });

  test('experiments page reports capability honestly', async ({ page }, testInfo) => {
    await requireEngine(page);
    await page.goto('/experiments', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('SIMULATION available')).toBeVisible({ timeout: 20_000 });
    // On this host emulation is unavailable; the page must say so rather than
    // implying it works.
    const emulationChip = page.getByText(/EMULATION (available|NOT VERIFIED HERE)/);
    await expect(emulationChip).toBeVisible();
    await expect(page.getByText(/MPTCP (available|unavailable)/)).toBeVisible();

    await page.screenshot({ path: `${EVIDENCE}/p2-experiments-${testInfo.project.name}.png` });
  });

  test('experiments page runs a small comparison end to end', async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    await requireEngine(page);
    await page.goto('/experiments', { waitUntil: 'domcontentloaded' });

    await page.getByLabel('Paired trials').fill('2');
    await page.getByRole('button', { name: /Run comparison/ }).click();
    await expect(page.getByText(/Results ·/)).toBeVisible({ timeout: 200_000 });

    // The table must contain every policy under comparison.
    for (const policy of ['B0', 'B1', 'B2', 'P1', 'P1-noPred', 'P1-noApp']) {
      await expect(
        page.getByRole('columnheader', { name: new RegExp(`^${policy} n=`) }),
      ).toBeVisible();
    }
    await expect(page.getByText(/does not mean the difference is statistically meaningful/i)).toBeVisible();
    await page.screenshot({
      path: `${EVIDENCE}/p2-experiments-results-${testInfo.project.name}.png`,
      fullPage: true,
    });
  });

  test('decision log shows recorded reasons and their observations', async ({ page }, testInfo) => {
    await requireEngine(page);
    await page.goto('/decision-log', { waitUntil: 'domcontentloaded' });

    await expect(page.getByText('Recorded runs')).toBeVisible();
    const firstDecision = page.getByText(/Session established on|Moved the session/).first();
    await expect(firstDecision).toBeVisible({ timeout: 30_000 });
    await firstDecision.click();

    await expect(page.getByText('Reason recorded at decision time')).toBeVisible();
    await expect(page.getByText('Observations at that instant')).toBeVisible();
    await page.screenshot({ path: `${EVIDENCE}/p2-decision-log-${testInfo.project.name}.png` });
  });

  test('capture view is 16:9, identified, and signals readiness', async ({ page }, testInfo) => {
    await requireEngine(page);
    // Start a run via the API so the capture view has something to show.
    const created = await page.request.post(`${ENGINE}/api/runs`, {
      data: {
        control: {
          scenario_id: 'wifi-degradation',
          policy_id: 'P1',
          seed: 1,
          speed: 2,
          predictor: 'heuristic',
          horizon_s: 3,
        },
      },
    });
    const { run_id: runId } = (await created.json()) as { run_id: string };

    await page.goto(`/capture?run=${runId}`, { waitUntil: 'domcontentloaded' });
    const frame = page.locator('[data-capture-ready]');
    await expect(frame).toBeVisible({ timeout: 30_000 });
    await expect.poll(async () => frame.getAttribute('data-capture-ready'), { timeout: 40_000 }).toBe('true');

    // Identity must always be present in a capture.
    await expect(page.getByText('SIMULATION', { exact: true })).toBeVisible();
    await expect(page.getByText(runId)).toBeVisible();
    // And there must be no invented LIVE badge.
    await expect(page.getByText(/^LIVE$/)).toHaveCount(0);

    const box = await frame.boundingBox();
    expect(box).not.toBeNull();
    const ratio = box!.width / box!.height;
    expect(Math.abs(ratio - 16 / 9)).toBeLessThan(0.05);

    const capture = await page.evaluate(
      () => (window as unknown as { __CONTINUA_CAPTURE__?: { ready: boolean } }).__CONTINUA_CAPTURE__,
    );
    expect(capture?.ready).toBe(true);
    await page.screenshot({ path: `${EVIDENCE}/p2-capture-${testInfo.project.name}.png` });
  });
});

// ---------------------------------------------------------------------------

test.describe('failure handling', () => {
  test('a missing run reports disconnected instead of inventing data', async ({ page }) => {
    await requireEngine(page);
    await page.goto('/capture?run=run-does-not-exist', { waitUntil: 'domcontentloaded' });
    // The socket is accepted then closed by the server, so the client reports a
    // disconnected/idle state and shows no metrics at all.
    await page.waitForTimeout(4000);
    const invented = await page.evaluate(() => {
      const text = document.body.innerText;
      // No fabricated numbers should appear for a run that does not exist.
      return /\b\d+\.\d\s?ms\b/.test(text);
    });
    expect(invented, 'must not display fabricated latencies for a nonexistent run').toBe(false);
  });

  test('the app states plainly when the engine is unreachable', async ({ page }) => {
    // Point the client at a dead port by blocking the engine origin.
    await page.route('**/api/**', (route) => route.abort());
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Plain language first. The raw host:port is a developer detail and lives
    // behind a disclosure rather than dominating the page.
    await expect(page.getByText(/CONTINUA engine offline/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(/scene is a preview · no measurements/)).toBeVisible();

    // The interface must still be usable and must not invent numbers while the
    // engine is gone: the scene renders as a preview and every metric card
    // shows a placeholder rather than a value. The reason is on the
    // placeholder's accessible name - the dashboard does not repeat the same
    // sentence down a column of four cards.
    // The landing has one way in. With no engine it opens the panels, waiting,
    // over a scene badged as a preview.
    await openDrive(page);
    await expect(page.getByText('SCENE PREVIEW')).toBeVisible();
    await expect(page.getByText('Waiting for a run').first()).toBeVisible();
    // Every measurement surface on screen. With no run only the links panel
    // is: the application and camera cards enter with a run's first event.
    const surfaces = page.locator('section[aria-label="Access links"], section[aria-label="Application health"]');
    await expect(surfaces).toHaveCount(1);
    await expect(page.locator('section[aria-label="Application health"]')).toHaveCount(0);
    const numericMetrics = await surfaces.locator('.metric').filter({ hasText: /\d/ }).count();
    expect(numericMetrics, 'no measurement panel may show a number with no engine').toBe(0);

    // The detail is reachable, and it names how to start the engine.
    await page.getByRole('button', { name: 'Detail', exact: true }).click();
    await expect(page.getByText(/npm run engine/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry connection/ })).toBeVisible();
  });
});
