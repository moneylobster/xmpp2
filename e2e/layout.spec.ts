import { test, expect, type Page } from '@playwright/test';

/**
 * Layout invariant tests for the safe-area double-counting bugs.
 *
 * Headless browsers report env(safe-area-inset-*) as 0, so the bug can't
 * reproduce without help. We override the --safe-top/--safe-bottom CSS vars
 * (the single source of truth, defined on :root in global.css) to simulate a
 * notched/nav-bar device, then assert the page does not become scrollable and
 * nothing overflows the viewport.
 *
 * Before the fix, login-view used min-height:100dvh (the FULL viewport) while
 * <html> was padded by the insets — so the content overflowed by the inset
 * height and the page scrolled (the "thin white bar"). After the fix the host
 * is height:100% and clipped, so these assertions hold.
 */

const SAFE_TOP = 40;
const SAFE_BOTTOM = 48;

async function simulateInsets(page: Page, top = SAFE_TOP, bottom = SAFE_BOTTOM) {
  // A later :root rule with equal specificity overrides global.css's defaults.
  await page.addStyleTag({
    content: `:root { --safe-top: ${top}px; --safe-bottom: ${bottom}px; }`,
  });
}

/** Vertical overflow of the scrolling root, in CSS px (0 == no page scroll). */
async function pageVerticalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.scrollingElement || document.documentElement;
    return el.scrollHeight - el.clientHeight;
  });
}

test.describe('login screen', () => {
  test('does not scroll / show a white bar even with device safe-area insets', async ({ page }) => {
    await page.goto('/', { waitUntil: 'load' });
    // login-view renders inside xmpp-app's shadow root; Playwright pierces it.
    await page.locator('login-view').waitFor({ state: 'attached', timeout: 45_000 });

    await simulateInsets(page);
    // Allow layout to settle.
    await page.waitForTimeout(50);

    const overflow = await pageVerticalOverflow(page);
    // Allow 1px for sub-pixel rounding.
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

/**
 * Logged-in overflow test. Requires a real XMPP account, so it is skipped unless
 * XMPP_TEST_JID / XMPP_TEST_PASSWORD are provided. It verifies that the contact
 * list / chat layout does not overflow under the device nav bar with insets.
 */
const JID = process.env.XMPP_TEST_JID;
const PASSWORD = process.env.XMPP_TEST_PASSWORD;

test.describe('app shell (logged in)', () => {
  test('content does not overflow the viewport with safe-area insets', async ({ page }) => {
    test.skip(!JID || !PASSWORD, 'Set XMPP_TEST_JID and XMPP_TEST_PASSWORD to run this test');

    await page.goto('/');
    await page.locator('#jid').fill(JID!);
    await page.locator('#password').fill(PASSWORD!);
    await page.locator('button[type="submit"]').click();

    // Wait until the authenticated shell is mounted.
    await page.locator('app-shell').waitFor({ state: 'attached', timeout: 20_000 });

    await simulateInsets(page);
    await page.waitForTimeout(100);

    const overflow = await pageVerticalOverflow(page);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});
