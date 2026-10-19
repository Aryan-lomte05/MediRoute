/**
 * ==============================================================================
 * MEDIROUTE - PLAYWRIGHT CONFIGURATION
 * ==============================================================================
 *
 * These are end-to-end UI tests against the real stack: the built client, the
 * real API, the real database and the real AI provider. Nothing is mocked, so a
 * pass means the feature genuinely works for a user.
 *
 * Run:
 *   npx playwright test                 # everything, headless
 *   npx playwright test --headed        # watch it
 *   npx playwright test sos             # one spec
 *   npx playwright show-report
 *
 * The API must already be running on :5000 (cd server && npm run dev). The
 * client is built and served automatically by the webServer block below.
 * ==============================================================================
 */

import { defineConfig, devices } from '@playwright/test'

const APP_PORT = 4173
const BASE_URL = `http://localhost:${APP_PORT}`

export default defineConfig({
  testDir: './tests/e2e',

  // Dispatch tests need a free ambulance, and an incident holds its unit until
  // it is closed. These release the fleet before and after every run.
  globalSetup: './tests/e2e/global-setup.cjs',
  globalTeardown: './tests/e2e/global-teardown.cjs',

  // Dispatch involves a real model call plus a geospatial query, so individual
  // assertions need more headroom than Playwright's default.
  timeout: 90_000,
  expect: { timeout: 15_000 },

  // These tests write real incidents to a shared database, so they must not
  // race each other for the small pool of available ambulances.
  fullyParallel: false,
  workers: 1,

  // A failing emergency flow is worth re-checking once before being believed,
  // since the free-tier API can cold-start mid-run.
  retries: process.env.CI ? 2 : 1,

  reporter: process.env.CI
    ? [['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],

  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',

    // Mumbai, matching the seeded fleet and hospitals.
    geolocation: { latitude: 19.0176, longitude: 72.8296 },
    permissions: ['geolocation'],
    locale: 'en-IN',
    timezoneId: 'Asia/Kolkata',
  },

  projects: [
    {
      // The citizen-facing surfaces are mobile-first, so they are tested on a
      // phone profile with touch enabled.
      name: 'mobile',
      testMatch: /(sos|pwa|landing-mobile|i18n)\.spec\.js/,
      use: { ...devices['Pixel 7'] },
    },
    {
      // The staff consoles are desktop tools.
      name: 'desktop',
      testMatch: /(landing|patient|paramedic|hospital|admin|ux)\.spec\.js/,
      testIgnore: /landing-mobile\.spec\.js/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],

  webServer: {
    command: 'npm run preview -- --port 4173 --strictPort',
    cwd: './client',
    url: BASE_URL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
