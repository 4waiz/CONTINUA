/**
 * Phase 2 browser tests.
 *
 * These run against the production build with the engine actually running, and
 * they check the claims the dashboard makes: that it is driven by computed
 * experiment state, that unavailable measurements are shown as unavailable, that
 * every control does something, and that a lost backend is reported rather than
 * papered over.
 *
 * Requires the engine on 127.0.0.1:8000 (`npm run engine`).
 */

import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

const EVIDENCE = 'tests/output/evidence';
const ENGINE = 'http://127.0.0.1:8000';

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

/** Start a run through the UI and wait until events are flowing. */
async function startRun(page: Page, scenario?: string): Promise<void> {
  if (scenario) {
    await page.getByLabel('Scenario').first().selectOption({ label: scenario });
  }
  await page.getByRole('button', { name: /Start run/ }).click();
  await expect(page.getByText('CONNECTED', { exact: false })).toBeVisible({ timeout: 30_000 });
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
    await expect(page.getByText('SIMULATION')).toBeVisible();

    // Values must actually move. A dashboard of constants would pass a
    // screenshot test and fail this one.
    const readDistance = () =>
      page.evaluate(() => {
        const api = (window as unknown as { __CONTINUA__?: { getFrame: () => { vehicle: { distance: number } } } })
          .__CONTINUA__;
        return api ? api.getFrame().vehicle.distance : -1;
      });
    const first = await readDistance();
    await page.waitForTimeout(3500);
    const second = await readDistance();
    expect(second, 'the vehicle must actually travel').toBeGreaterThan(first);

    await page.screenshot({ path: `${EVIDENCE}/p2-mission-${testInfo.project.name}.png` });
    expect(errors, errors.join(' | ')).toEqual([]);
  });

  test('renders unavailable measurements as unavailable, never as zero', async ({ page }) => {
    await requireEngine(page);
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await startRun(page);

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
    await expect(page.getByText('CONNECTED', { exact: false })).toBeVisible({ timeout: 40_000 });
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
    await expect(page.getByText('SIMULATION')).toBeVisible();
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
    await expect(page.getByText(/Simulation services are unavailable/)).toBeVisible();

    // The interface must still be usable and must not invent numbers while the
    // engine is gone: the scene renders as a preview and metrics show a dash.
    await expect(page.getByText('SCENE PREVIEW')).toBeVisible();
    await expect(page.getByText(/Waiting for engine/).first()).toBeVisible();

    // The detail is reachable, and it names how to start the engine.
    await page.getByRole('button', { name: /Detail/ }).click();
    await expect(page.getByText(/npm run engine/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Retry connection/ })).toBeVisible();
  });
});
