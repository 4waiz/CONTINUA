import { defineConfig, devices } from '@playwright/test';

/**
 * Browser smoke tests for CONTINUA.
 *
 * These run against a production build on purpose: a scene that works in `next
 * dev` but breaks after minification or under React strict double-mounting is
 * not shipped.
 */
export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  outputDir: './output/test-results',
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: './output/report', open: 'never' }]],
  use: {
    baseURL: process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // WebGL in headless Chromium needs software rasterisation to be reliable
    // in CI; SwiftShader is slow but deterministic.
    launchOptions: {
      args: [
        '--use-gl=angle',
        '--use-angle=swiftshader',
        '--enable-unsafe-swiftshader',
        '--disable-gpu-sandbox',
      ],
    },
  },
  projects: [
    { name: 'desktop-1920', use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } } },
    { name: 'desktop-1440', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'desktop-1280', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } } },
    {
      // Real hardware rendering. `npm run test:perf` uses this so the frame
      // rate in docs/PROGRESS.md is a measurement, not a software-rasteriser
      // artefact. Requires a locally installed Chrome.
      name: 'gpu',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { width: 1920, height: 1080 },
        launchOptions: { args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] },
      },
    },
  ],
  webServer: {
    command: 'npm run start',
    cwd: '..',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 180_000,
  },
});
