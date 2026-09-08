/**
 * CONTINUA browser smoke tests.
 *
 * These run against the production build in a real browser because that is the
 * only place the claims in the handoff document can actually be checked: that
 * the glTF loads, that the rig nodes survived export, that the clock is
 * deterministic, and that the pages render without console errors.
 */

import { expect, test, type ConsoleMessage, type Page } from '@playwright/test';

const EVIDENCE_DIR = 'tests/output/evidence';

/** Noise we do not want to fail a build over. */
const IGNORED_CONSOLE = [
  /Download the React DevTools/i,
  /THREE\.WebGLRenderer: Context Lost/i,
  /Multiple instances of Three\.js being imported/i,
];

function collectConsoleErrors(page: Page): string[] {
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

async function waitForScene(page: Page): Promise<void> {
  await expect(page.locator('canvas')).toBeVisible({ timeout: 60_000 });
  await page.waitForFunction(
    () => Boolean((window as unknown as { __CONTINUA__?: unknown }).__CONTINUA__),
    undefined,
    { timeout: 60_000 },
  );
  // One rendered frame with the rover actually placed in the world.
  // Wait for the scene to have actually drawn: the debug bridge only appears
  // once the Canvas' Suspense boundary has resolved every glTF.
  await page.waitForFunction(
    () => {
      const api = (
        window as unknown as {
          __CONTINUA__?: { three?: unknown; getFrame: () => { vehicle: { position: { x: number } } } };
        }
      ).__CONTINUA__;
      return Boolean(api?.three && Number.isFinite(api.getFrame().vehicle.position.x));
    },
    undefined,
    { timeout: 60_000 },
  );
  await expect(page.getByText('Loading mission scene')).toBeHidden({ timeout: 60_000 });
}

// ---------------------------------------------------------------------------

test.describe('CONTINUA dashboard', () => {
  test('landing page renders the scene and the honest preview badge', async ({ page }, testInfo) => {
    const errors = collectConsoleErrors(page);

    const modelResponses: { url: string; status: number; bytes: number }[] = [];
    page.on('response', async (response) => {
      if (!response.url().includes('/models/')) return;
      modelResponses.push({
        url: response.url().split('/').pop() ?? '',
        status: response.status(),
        bytes: Number(response.headers()['content-length'] ?? 0),
      });
    });

    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await waitForScene(page);

    await expect(page.getByRole('heading', { name: 'CONTINUA', level: 1 })).toBeVisible();
    await expect(page.getByText('Predictive Network Continuity')).toBeVisible();
    await expect(page.getByText('by Team Kanban')).toBeVisible();

    // Phase 1 must never claim measured performance.
    await expect(page.getByText('SCENE PREVIEW').first()).toBeVisible();

    // The glTF assets really were fetched, and really were served.
    await page.waitForTimeout(1500);
    const rover = modelResponses.find((response) => response.url === 'continua_rover.glb');
    const props = modelResponses.find((response) => response.url === 'continua_props.glb');
    expect(rover, 'rover glb must be requested').toBeTruthy();
    expect(rover?.status).toBe(200);
    expect(props?.status).toBe(200);

    await page.screenshot({
      path: `${EVIDENCE_DIR}/dashboard-${testInfo.project.name}.png`,
      fullPage: false,
    });

    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });

  test('scene lab exposes working transport, cameras and overlays', async ({ page }, testInfo) => {
    const errors = collectConsoleErrors(page);
    await page.goto('/scene-lab', { waitUntil: 'domcontentloaded' });
    await waitForScene(page);

    await expect(page.getByRole('heading', { name: /CONTINUA/ })).toBeVisible();

    // --- transport ---------------------------------------------------------
    await page.getByRole('button', { name: /Play|Pause/ }).click();
    await page.waitForTimeout(1200);
    const advanced = await page.evaluate(
      () => (window as unknown as { __CONTINUA__: { clock: { time: number } } }).__CONTINUA__.clock.time,
    );
    expect(advanced, 'clock should advance while playing').toBeGreaterThan(0);

    await page.getByRole('button', { name: /Reset/ }).click();
    const afterReset = await page.evaluate(
      () => (window as unknown as { __CONTINUA__: { clock: { time: number } } }).__CONTINUA__.clock.time,
    );
    expect(afterReset).toBeLessThan(0.2);

    // --- cameras -----------------------------------------------------------
    for (const camera of ['Overview', 'Close-up', 'Follow']) {
      await page.getByRole('button', { name: camera, exact: true }).click();
      await page.waitForTimeout(350);
    }

    // --- overlays and modes -------------------------------------------------
    await page.getByRole('button', { name: /Coverage overlay/ }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${EVIDENCE_DIR}/scene-lab-coverage-${testInfo.project.name}.png` });
    await page.getByRole('button', { name: /Coverage overlay/ }).click();

    await page.getByRole('button', { name: 'Inspect rover' }).click();
    await page.waitForTimeout(900);
    await page.screenshot({ path: `${EVIDENCE_DIR}/scene-lab-inspect-${testInfo.project.name}.png` });
    await page.getByRole('button', { name: 'Mission route' }).click();

    await page.screenshot({ path: `${EVIDENCE_DIR}/scene-lab-${testInfo.project.name}.png` });
    expect(errors, `console errors: ${errors.join(' | ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

test.describe('determinism and rig integrity', () => {
  // These assert behaviour, not layout, so one viewport is enough.
  test.beforeEach(({}, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-1920', 'behaviour checks run once');
  });

  test('the same timestamp reproduces the same scene state', async ({ page }) => {
    await page.goto('/scene-lab', { waitUntil: 'domcontentloaded' });
    await waitForScene(page);

    const result = await page.evaluate(() => {
      const api = (
        window as unknown as {
          __CONTINUA__: {
            clock: { setTime: (t: number) => void; duration: number; pause: () => void };
            source: { sampleAt: (t: number) => unknown };
          };
        }
      ).__CONTINUA__;
      api.clock.pause();
      const times = [0, 7.5, 23.25, 41, 66.5];
      const forward = times.map((t) => JSON.stringify(api.source.sampleAt(t)));
      const backward = [...times].reverse().map((t) => JSON.stringify(api.source.sampleAt(t)));
      backward.reverse();
      return { forward, backward, duration: api.clock.duration };
    });

    expect(result.duration).toBeGreaterThan(30);
    expect(result.forward).toEqual(result.backward);
  });

  test('the exported rover keeps its wheels, steering pivots and materials', async ({ page }) => {
    await page.goto('/scene-lab', { waitUntil: 'domcontentloaded' });
    await waitForScene(page);
    await page.waitForTimeout(1500);

    const report = await page.evaluate(() => {
      // Reach into the live three.js scene through the renderer's canvas.
      const found: Record<string, boolean> = {};
      const materials = new Set<string>();
      let roverNodes = 0;
      let triangles = 0;

      const visit = (object: {
        name?: string;
        children?: unknown[];
        isMesh?: boolean;
        geometry?: { index?: { count: number } | null; attributes?: { position?: { count: number } } };
        material?: unknown;
      }): void => {
        if (object.name) {
          if (object.name.startsWith('CONTINUA_')) roverNodes += 1;
          found[object.name] = true;
        }
        if (object.isMesh && object.geometry) {
          const index = object.geometry.index;
          const position = object.geometry.attributes?.position;
          triangles += index ? index.count / 3 : position ? position.count / 3 : 0;
          const material = object.material as { name?: string } | { name?: string }[];
          for (const entry of Array.isArray(material) ? material : [material]) {
            if (entry?.name) materials.add(entry.name);
          }
        }
        for (const child of (object.children ?? []) as (typeof object)[]) visit(child);
      };

      const api = (
        window as unknown as { __CONTINUA__: { three?: { scene: unknown } } }
      ).__CONTINUA__;
      if (api.three?.scene) visit(api.three.scene as Parameters<typeof visit>[0]);

      return {
        roverNodes,
        triangles: Math.round(triangles),
        materials: [...materials].sort(),
        wheels: ['FL', 'FR', 'RL', 'RR'].map((tag) => Boolean(found[`CONTINUA_Wheel_${tag}`])),
        steer: ['FL', 'FR'].map((tag) => Boolean(found[`CONTINUA_Steer_${tag}`])),
        hasBody: Boolean(found['CONTINUA_Body']),
        hasGlass: Boolean(found['CONTINUA_Glass']),
        hasSensors: Boolean(found['CONTINUA_SensorAssembly']),
      };
    });

    console.log('[rig report]', JSON.stringify(report, null, 2));

    expect(report.wheels, 'all four wheels must survive export').toEqual([true, true, true, true]);
    expect(report.steer, 'both front steering pivots must survive export').toEqual([true, true]);
    expect(report.hasBody).toBe(true);
    expect(report.hasGlass).toBe(true);
    expect(report.hasSensors).toBe(true);
    expect(report.materials).toContain('CONTINUA_Paint_White');
    expect(report.materials).toContain('CONTINUA_Glass_Tint');
    expect(report.materials).toContain('CONTINUA_Rubber');
  });

  test('wheels turn with distance and the steering follows curvature', async ({ page }) => {
    await page.goto('/scene-lab', { waitUntil: 'domcontentloaded' });
    await waitForScene(page);

    const samples = await page.evaluate(() => {
      const api = (
        window as unknown as {
          __CONTINUA__: {
            source: {
              sampleAt: (t: number) => {
                vehicle: { wheelAngle: number; distance: number; steerAngle: number };
              };
            };
            clock: { duration: number };
          };
        }
      ).__CONTINUA__;
      const duration = api.clock.duration;
      const points = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85].map((fraction) => {
        const state = api.source.sampleAt(duration * fraction);
        return {
          distance: state.vehicle.distance,
          wheelAngle: state.vehicle.wheelAngle,
          steerAngle: state.vehicle.steerAngle,
        };
      });
      return points;
    });

    // Wheel rotation must be distance / radius, not a free-running timer.
    for (const sample of samples) {
      expect(Math.abs(sample.wheelAngle - sample.distance / 0.405)).toBeLessThan(1e-3);
    }
    // The route genuinely curves, so steering must actually move.
    const steerRange =
      Math.max(...samples.map((s) => s.steerAngle)) - Math.min(...samples.map((s) => s.steerAngle));
    expect(steerRange).toBeGreaterThan(0.02);
  });

  test('measures rendering performance and records the result', async ({ page }) => {
    await page.goto('/scene-lab', { waitUntil: 'domcontentloaded' });
    await waitForScene(page);
    await page.waitForTimeout(2500); // let assets settle and shadows bake

    const measurement = await page.evaluate(async () => {
      const api = (window as unknown as { __CONTINUA__: { clock: { play: () => void } } }).__CONTINUA__;
      api.clock.play();
      return await new Promise<{ frames: number; seconds: number; fps: number }>((resolve) => {
        let frames = 0;
        const start = performance.now();
        const tick = () => {
          frames += 1;
          const elapsed = performance.now() - start;
          if (elapsed < 4000) requestAnimationFrame(tick);
          else resolve({ frames, seconds: elapsed / 1000, fps: frames / (elapsed / 1000) });
        };
        requestAnimationFrame(tick);
      });
    });

    const renderer = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
      const info = gl?.getExtension('WEBGL_debug_renderer_info');
      return {
        vendor: info ? String(gl?.getParameter(info.UNMASKED_VENDOR_WEBGL)) : 'unknown',
        renderer: info ? String(gl?.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown',
      };
    });

    console.log(
      `[performance] ${measurement.fps.toFixed(1)} fps over ${measurement.seconds.toFixed(1)}s ` +
        `on ${renderer.renderer} (${renderer.vendor})`,
    );

    // A hard threshold here would only assert the speed of the CI machine.
    // What must hold is that frames are actually being produced.
    expect(measurement.frames).toBeGreaterThan(20);
  });
});
