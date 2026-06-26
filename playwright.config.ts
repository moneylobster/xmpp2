import { defineConfig, devices } from '@playwright/test';

// Layout invariant tests run against the Vite dev server in a mobile viewport.
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  fullyParallel: true,
  reporter: 'list',
  // Wait for Vite to finish optimizing the converse.js dep before navigating.
  globalSetup: './e2e/global-setup.ts',
  use: {
    baseURL: 'http://localhost:5173',
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: { ...devices['Pixel 5'] },
    },
  ],
  // Reuses a dev server you start yourself (recommended locally — see e2e/README.md),
  // and auto-spawns one on CI. globalSetup warms it before the suite navigates.
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
    // First run pre-bundles the large converse.js headless dep; allow time for it.
    timeout: 120_000,
  },
});
