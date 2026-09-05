/**
 * Landing page (signed out "/").
 *
 * No login needed: everything here is reachable with no session. Screenshots
 * land in .playwright/baseline/ next to the route walkthrough's.
 *
 *   npx playwright test tests/landing.spec.ts --reporter=list
 */
import { test, expect, Page } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const SHOTS = '.playwright/baseline';
const SETTLED = 'matrix(1, 0, 0, 1, 0, 0)'; // fill-mode: both leaves the identity matrix, not "none"

// The Google Identity script in index.html is loaded from accounts.google.com
// and logs on its own when the network is sandboxed; that is not the page.
function collectConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (/accounts\.google|gsi|ERR_(NAME_NOT_RESOLVED|INTERNET_DISCONNECTED)/i.test(text)) return;
    errors.push(text);
  });
  return errors;
}

test.describe('Landing', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('hero renders with the real sign-in form and no console errors', async ({ page }) => {
    const errors = collectConsoleErrors(page);
    await page.goto(BASE + '/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Every deal. Every rep.');
    await expect(page.getByText('Synced from Tableau Cloud', { exact: false })).toBeVisible();

    // The embedded card is the same <Login /> the suites type into.
    const card = page.locator('#signin');
    await expect(card.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByPlaceholder('Work email')).toBeVisible();
    await expect(page.getByPlaceholder(/Password/)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();

    // Product mock and its companions are decorative and say so.
    await expect(page.getByRole('img', { name: /Illustrative preview of the Executive Dashboard/ })).toBeVisible();
    await expect(page.locator('.ld-hero [data-depth]')).toHaveCount(6);
    await expect(page.locator('.ld-hero [aria-hidden="true"][data-depth]')).toHaveCount(4);
    await expect(page.locator('.ld-float')).toHaveCount(4);

    // Nothing scrolls sideways.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // The last bar of the mock finishes its entrance last; once it is at rest the hero is settled.
    await expect(page.locator('.ld-bars i').last()).toHaveCSS('transform', SETTLED, { timeout: 8000 });
    await expect(page.locator('.ld-float').last()).toHaveCSS('opacity', '1', { timeout: 8000 });
    await page.screenshot({ path: `${SHOTS}/landing_hero.png` });
    expect(errors).toEqual([]);
  });

  test('scrolling reveals every section and the anchors work', async ({ page }) => {
    await page.goto(BASE + '/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    // Ticker: every statement rendered once for readers, once for the loop.
    await expect(page.locator('.ld-marquee-track > span:not([aria-hidden])')).toHaveCount(10);

    // Boards: all seven, in the server's order, as bento tiles.
    await page.getByRole('link', { name: 'See the boards' }).click();
    await expect(page.locator('.ld-grid')).toHaveClass(/is-in/);
    for (const name of ['Opportunity Analytics', 'Executive Dashboard', 'Win Board', 'Loss Board', 'Product View', 'AE Performance', 'AM Performance']) {
      await expect(page.getByRole('heading', { level: 3, name, exact: true })).toBeVisible();
    }
    await expect(page.locator('.ld-tile')).toHaveCount(7);
    await expect(page.locator('.ld-tile .viz')).toHaveCount(7);
    // The cursor glow follows the pointer on a tile.
    const tile = page.locator('.ld-tile').first();
    await tile.hover({ position: { x: 40, y: 30 } });
    await expect(tile).toHaveAttribute('style', /--mx: (39|40|41)px/);
    await expect(page.locator('.viz-funnel i').last()).toHaveCSS('transform', 'none', { timeout: 8000 });
    await page.screenshot({ path: `${SHOTS}/landing_boards.png` });

    // Feature rows reveal on intersection.
    for (const id of ['#builder', '#tv', '#sources']) {
      await page.locator(id).scrollIntoViewIfNeeded();
      await expect(page.locator(id)).toHaveClass(/is-in/);
    }
    await expect(page.getByRole('heading', { name: "For everything the boards don't cover." })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Put it on the wall. Leave it there.' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Three ways in. One canonical schema.' })).toBeVisible();
    await page.locator('#tv').scrollIntoViewIfNeeded();
    await expect(page.locator('#tv .viz-bars i').last()).toHaveCSS('transform', 'none', { timeout: 8000 });
    await page.screenshot({ path: `${SHOTS}/landing_tv.png` });

    // Manifesto lights word by word as it crosses the viewport.
    const manifesto = page.locator('.ld-manifesto');
    await manifesto.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, 400));
    await expect(manifesto.locator('.w.lit').first()).toBeVisible();
    await expect.poll(() => manifesto.locator('.w.lit').count()).toBeGreaterThan(5);
    await page.screenshot({ path: `${SHOTS}/landing_manifesto.png` });

    // The final CTA takes you back to the form and focuses it.
    await page.getByRole('heading', { name: /Connect a Tableau source/ }).scrollIntoViewIfNeeded();
    await page.locator('.ld-final').getByRole('link', { name: 'Sign in' }).click();
    await expect(page.getByPlaceholder('Work email')).toBeInViewport();
    await expect(page.getByPlaceholder('Work email')).toBeFocused();
  });

  test('/login still serves the bare form for bookmarks', async ({ page }) => {
    await page.goto(BASE + '/login');
    await expect(page.locator('.login-wrap .login-card')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'TestMu BI' })).toBeVisible();
    await expect(page.getByPlaceholder('Work email')).toBeVisible();
    await expect(page.locator('.ld-hero')).toHaveCount(0);
  });

  test('stays a black tile with readable text when the app theme is light', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('testmu-theme', 'light'));
    await page.goto(BASE + '/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await expect(page.locator('.landing')).toHaveCSS('background-color', 'rgb(0, 0, 0)');
    await expect(page.locator('#signin h2')).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(page.locator('.ld-tile h3').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
    await expect(page.locator('.ld-source h3').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
  });
});

test.describe('Landing: reduced motion', () => {
  test.use({ viewport: { width: 1920, height: 1080 } });

  test('everything is readable with nothing moving', async ({ page }) => {
    // Emulated on the page, not through test.use: with this config the
    // context-level reducedMotion option never reached matchMedia.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(BASE + '/');
    await expect(page.locator('.landing')).toBeVisible();
    expect(await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await expect(page.locator('.landing')).toHaveClass(/ld-static/);
    // No IntersectionObserver in this mode: sections are simply visible.
    const opacity = await page.locator('.ld-sources').evaluate(el => getComputedStyle(el).opacity);
    expect(opacity).toBe('1');
    await expect(page.locator('.ld-manifesto .w').first()).toHaveCSS('color', 'rgb(255, 255, 255)');
    const heroTransform = await page.locator('.ld-mock').evaluate(el => getComputedStyle(el).transform);
    expect(heroTransform).toBe('none');
    // The ticker stands still and shows each statement once.
    await expect(page.locator('.ld-marquee-track > span[aria-hidden]').first()).toBeHidden();
  });
});

test.describe('Landing: small screen', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test('no sideways scroll and a sign-in call to action above the fold', async ({ page }) => {
    await page.goto(BASE + '/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('.ld-hero-copy').getByRole('link', { name: 'Sign in' })).toBeInViewport();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    await expect(page.locator('.ld-trust')).toHaveCSS('opacity', '1', { timeout: 8000 });
    await page.screenshot({ path: `${SHOTS}/landing_mobile.png`, fullPage: false });
  });
});
