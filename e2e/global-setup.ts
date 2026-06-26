import { chromium } from '@playwright/test';

/**
 * Warm up the Vite dev server before the test suite runs.
 *
 * Playwright's `webServer.url` health check passes as soon as the static
 * index.html is served, but Vite still pre-bundles the large converse.js
 * headless dependency on the first real page load. During that window module
 * transforms can fail transiently. A raw fetch doesn't drive Vite through its
 * normal optimize-then-full-reload flow the way a browser does, so we warm it
 * with an actual Chromium navigation and wait until <login-view> renders,
 * reloading until it does.
 */
export default async function globalSetup() {
  const base = process.env.E2E_BASE_URL || 'http://localhost:5173';
  const browser = await chromium.launch();
  const page = await browser.newPage();
  try {
    const deadline = Date.now() + 120_000;
    let lastErr: unknown;
    while (Date.now() < deadline) {
      try {
        await page.goto(base + '/', { waitUntil: 'load', timeout: 20_000 });
        await page.locator('login-view').waitFor({ state: 'attached', timeout: 15_000 });
        return; // server is warm
      } catch (e) {
        lastErr = e;
        await page.waitForTimeout(1500); // let Vite finish optimizing, then retry/reload
      }
    }
    throw new Error(`Dev server did not warm up in time: ${String(lastErr)}`);
  } finally {
    await browser.close();
  }
}
