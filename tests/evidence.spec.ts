/**
 * Visual evidence capture.
 *
 * Produces the inspection set required for the Phase 1 review: a vehicle
 * close-up, an overview, and each of the four mission zones. Scrubbing is done
 * through the deterministic clock, so re-running this produces the same frames.
 */

import { expect, test, type Page } from '@playwright/test';

const EVIDENCE_DIR = 'tests/output/evidence';

type SettingsPatch = {
  camera?: 'follow' | 'overview' | 'closeup' | 'turntable';
  mode?: 'mission' | 'inspect';
  showCoverage?: boolean;
};

async function ready(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      Boolean(
        (window as unknown as { __CONTINUA__?: { three?: unknown } }).__CONTINUA__?.three,
      ),
    undefined,
    { timeout: 60_000 },
  );
  await expect(page.getByText('Loading mission scene')).toBeHidden({ timeout: 60_000 });
}

async function frame(page: Page, time: number, settings: SettingsPatch): Promise<void> {
  await page.evaluate(
    ({ time: t, settings: patch }) => {
      const api = (
        window as unknown as {
          __CONTINUA__: {
            clock: { pause: () => void; setTime: (t: number) => void };
            settings: { set: (patch: Record<string, unknown>) => void };
          };
        }
      ).__CONTINUA__;
      api.clock.pause();
      api.settings.set(patch);
      api.clock.setTime(t);
    },
    { time, settings: settings as Record<string, unknown> },
  );
  // Let the render loop settle on the new pose before capturing.
  await page.waitForTimeout(1400);
}

test.describe('mission evidence', () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1920', 'capture once, at 1920x1080');
  });

  test('captures the inspection set', async ({ page }) => {
    await page.goto('/scene-lab', { waitUntil: 'domcontentloaded' });
    await ready(page);

    const shots: [string, number, SettingsPatch][] = [
      ['01-facility-dock', 4, { camera: 'follow', mode: 'mission' }],
      ['02-vehicle-closeup', 22, { camera: 'closeup' }],
      ['03-courtyard-wifi', 26, { camera: 'overview' }],
      ['04-corridor-cellular', 55, { camera: 'overview' }],
      ['05-remote-satellite', 88, { camera: 'overview' }],
      ['06-remote-follow', 92, { camera: 'follow' }],
      ['07-coverage-overlay', 46, { camera: 'overview', showCoverage: true }],
      ['08-inspect-turntable', 3, { mode: 'inspect', showCoverage: false }],
    ];

    for (const [name, time, settings] of shots) {
      await frame(page, time, settings);
      await page.locator('canvas').screenshot({ path: `${EVIDENCE_DIR}/view-${name}.png` });
    }

    const summary = await page.evaluate(() => {
      const api = (
        window as unknown as {
          __CONTINUA__: {
            three: { gl: { info: { render: { calls: number; triangles: number } }; capabilities?: unknown } };
            clock: { duration: number };
            getFrame: () => { vehicle: { distance: number } };
          };
        }
      ).__CONTINUA__;
      return {
        drawCalls: api.three.gl.info.render.calls,
        triangles: api.three.gl.info.render.triangles,
        duration: api.clock.duration,
        routeEnd: api.getFrame().vehicle.distance,
      };
    });
    console.log('[scene budget] ' + JSON.stringify(summary));
    expect(summary.drawCalls).toBeGreaterThan(0);
  });
});
