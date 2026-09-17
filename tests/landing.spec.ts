import { test, expect, Page } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173';
const SHOTS = '.playwright/landing-redesign';

// Test the real client against deterministic auth responses. No accounts are
// created, and no credentials or mutations reach a live database.
async function signedOut(page: Page, signup = false) {
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { error: 'Not signed in' } }));
  await page.route('**/api/auth/config', route => route.fulfill({ json: { googleClientId: null, selfSignupEnabled: signup } }));
}
async function expectNoOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(0);
}
async function settleBoard(page: Page) {
  await expect(page.locator('.rv-screen-shell .rv-board')).not.toHaveClass(/is-assembling/);
  await page.locator('.rv-screen-shell').evaluate(async el => {
    await Promise.all(el.getAnimations({ subtree: true }).map(animation => animation.finished.catch(() => {})));
  });
}

test.describe('Revenue landing', () => {
  test.beforeEach(async ({ page }) => { await signedOut(page); });

  for (const [name, width, height] of [['desktop', 1440, 1000], ['tablet', 820, 1180], ['mobile', 390, 844], ['small-mobile', 320, 740]] as const) {
    test(`${name}: entry, story, sign-in and presentation fit`, async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.setViewportSize({ width, height });
      await page.goto(BASE);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Your revenue.');
      await expect(page.locator('.rv-hero').getByRole('button', { name: 'Get started' })).toBeInViewport();
      await expect(page.locator('.ld-tile, .ld-grid')).toHaveCount(0);
      await expectNoOverflow(page);
      await page.evaluate(() => document.fonts.ready);
      const boardInView = await page.locator('.rv-screen-shell').evaluate(el => {
        const rect = el.getBoundingClientRect();
        return Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top) > rect.height * .22;
      });
      if (boardInView) await settleBoard(page);
      await page.screenshot({ path: `${SHOTS}/${name}-hero.png` });
      await page.getByRole('button', { name: 'See it live' }).click();
      await expect(page.locator('.rv-sticky')).toHaveClass(/rv-step-0/);
      await expect(page.locator('.rv-stage-control')).toBeInViewport();
      await expect.poll(() => page.locator('#experience').evaluate(el => Math.abs(el.getBoundingClientRect().top))).toBeLessThan(2);
      await settleBoard(page);
      await page.screenshot({ path: `${SHOTS}/${name}-board.png` });
      await page.getByRole('button', { name: /Ask your data/ }).click();
      await expect(page.getByRole('textbox', { name: 'Ask your data' })).toBeVisible();
      await page.getByRole('button', { name: 'Top reps', exact: true }).click();
      await expect(page.locator('#rv-query-status')).toContainText('Showing top reps');
      await expect(page.locator('.rv-bar')).toHaveCount(5);
      await settleBoard(page);
      await page.screenshot({ path: `${SHOTS}/${name}-ask.png` });
      await page.getByRole('button', { name: /On every screen/ }).click();
      await expect(page.locator('.rv-screen-shell .rv-board')).toHaveClass(/is-wall/);
      await page.getByRole('button', { name: 'Try fullscreen' }).click();
      const wall = page.getByRole('dialog', { name: 'Presentation preview' });
      await expect(wall).toBeVisible();
      await wall.evaluate(async el => { await Promise.all(el.getAnimations({ subtree: true }).map(a => a.finished.catch(() => {}))); });
      await expectNoOverflow(page);
      await page.screenshot({ path: `${SHOTS}/${name}-wall.png` });
      await page.keyboard.press('Escape');
      await expect(wall).not.toBeVisible();
      await page.locator('.rv-final').getByRole('button', { name: 'Get started' }).click();
      const auth = page.getByRole('dialog', { name: 'Access your workspace' });
      await expect(auth.getByLabel('Work email')).toBeFocused();
      await expect(auth.getByRole('button', { name: 'Create account', exact: true })).toHaveCount(0);
      await page.screenshot({ path: `${SHOTS}/${name}-auth.png` });
      await page.keyboard.press('Escape');
      await expect(auth).not.toBeVisible();
      await expect(page.locator('.rv-final').getByRole('button', { name: 'Get started' })).toBeFocused();
      await expectNoOverflow(page);
      expect(errors).toEqual([]);
    });
  }

  test('filters, keyboard tooltips, example prompts and unsupported questions', async ({ page }) => {
    await page.goto(BASE);
    await page.getByRole('button', { name: 'See it live' }).click();
    await page.getByLabel('Filter by region').selectOption('AMER');
    await expect(page.locator('.rv-big-number')).toHaveAttribute('aria-label', /\$2\.1M/);
    await page.locator('.rv-bar').first().focus();
    await expect(page.locator('.rv-tooltip').first()).toHaveCSS('opacity', '1');
    await page.getByRole('button', { name: /Ask your data/ }).click();
    for (const question of ['ARR by region', 'Pipeline this quarter', 'Top reps', 'Win rate', 'Forecast']) {
      await page.locator('.rv-prompts').getByRole('button', { name: question, exact: true }).click();
      await expect(page.locator('#rv-query-status')).toContainText(`Showing ${question.toLowerCase()}`);
      await expect(page.locator('.rv-chart-heading')).toContainText(question);
    }
    await page.getByRole('textbox', { name: 'Ask your data' }).fill('An unsupported question');
    await page.getByRole('button', { name: 'Run example question' }).click();
    await expect(page.locator('#rv-query-status')).toHaveText('Try one of the example questions below.');
    await page.getByRole('textbox', { name: 'Ask your data' }).fill('arr by region');
    await page.getByRole('textbox', { name: 'Ask your data' }).press('Enter');
    await expect(page.locator('#rv-query-status')).toContainText('Showing arr by region');
  });

  test('hero actions drive the board, and bar/trend styles switch', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(BASE);
    await page.getByRole('button', { name: 'See AMER revenue' }).click();
    await expect(page.locator('.rv-signal-metric')).toContainText('$2.1');
    await page.getByRole('button', { name: 'See it live' }).click();
    await settleBoard(page);
    await expect(page.getByLabel('Filter by region')).toHaveValue('AMER');
    await page.getByRole('button', { name: 'Show trend chart' }).click();
    await expect(page.locator('.rv-trend-line')).toBeVisible();
    await expect(page.locator('.rv-bar-fill').first()).toHaveCSS('opacity', '0');
    await page.locator('.rv-bar').nth(3).focus();
    await expect(page.locator('.rv-tooltip').nth(3)).toHaveCSS('opacity', '1');
    await settleBoard(page);
    await page.screenshot({ path: `${SHOTS}/trend-mode.png` });
    await page.getByRole('button', { name: 'Show bar chart' }).click();
    await expect(page.locator('.rv-trend-line')).toHaveCount(0);
    await expect(page.locator('.rv-bar-fill').first()).toHaveCSS('opacity', '1');
  });

  test('workspace navigation and motion controls remain usable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto(BASE);
    await page.getByRole('button', { name: 'See it live' }).click();
    await settleBoard(page);
    await page.getByRole('button', { name: 'View rep performance' }).click();
    await expect(page.locator('#rv-query-status')).toContainText('Showing top reps');
    await page.getByRole('button', { name: 'View revenue forecast' }).click();
    await expect(page.locator('#rv-query-status')).toContainText('Showing forecast');
    await page.getByRole('button', { name: 'View revenue overview' }).click();
    await expect(page.locator('.rv-chart-heading')).toContainText('Revenue momentum');
    await page.getByRole('button', { name: 'Pause animation' }).click();
    await expect(page.locator('.revenue-landing')).toHaveClass(/rv-static/);
    await expect(page.locator('.rv-signal-beam').first()).toHaveCSS('animation-name', 'none');
    await page.getByRole('button', { name: 'Play animation' }).click();
    await expect(page.locator('.revenue-landing')).not.toHaveClass(/rv-static/);
    await page.getByRole('button', { name: 'Show trend chart' }).click();
    await settleBoard(page);
    await expect(page.locator('.rv-big-number')).not.toContainText('$0.0');
  });

  test('native validation, password visibility, busy and failure states', async ({ page }) => {
    let requests = 0;
    await page.route('**/api/auth/login', async route => {
      requests++;
      expect(route.request().postDataJSON()).toEqual({ email: 'demo@example.test', password: 'example-password' });
      await new Promise(resolve => setTimeout(resolve, 400));
      await route.fulfill({ status: 401, json: { error: 'Incorrect email or password' } });
    });
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    expect(requests).toBe(0);
    await dialog.getByLabel('Work email').fill('demo@example.test');
    await dialog.getByLabel('Password', { exact: true }).fill('example-password');
    await dialog.getByRole('button', { name: 'Show password' }).click();
    await expect(dialog.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await dialog.getByRole('button', { name: 'Hide password' }).click();
    await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(dialog.getByRole('button', { name: 'Please wait' })).toBeDisabled();
    await expect(dialog.getByLabel('Work email')).toBeDisabled();
    await expect(dialog.getByRole('alert')).toHaveText('Incorrect email or password');
    await expect(dialog.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    expect(requests).toBe(1);
    await page.screenshot({ path: `${SHOTS}/auth-error.png` });
  });

  test('successful password sign-in keeps the /gallery navigation', async ({ page }) => {
    await page.route('**/api/auth/login', route => route.fulfill({ json: { id: 1, email: 'demo@example.test' } }));
    await page.route('**/gallery', route => route.fulfill({ contentType: 'text/html', body: '<h1>Workspace destination</h1>' }));
    await page.goto(BASE + '/login');
    await expect(page.getByRole('heading', { name: 'TestMu BI' })).toBeVisible();
    await page.getByLabel('Work email').fill('demo@example.test');
    await page.getByLabel('Password', { exact: true }).fill('example-password');
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page).toHaveURL(BASE + '/gallery');
    await expect(page.getByRole('heading', { name: 'Workspace destination' })).toBeVisible();
  });

  test('enabled signup validates 12 characters and handles pending accounts', async ({ page }) => {
    await page.unroute('**/api/auth/config');
    await page.route('**/api/auth/config', route => route.fulfill({ json: { googleClientId: null, selfSignupEnabled: true } }));
    let requests = 0;
    await page.route('**/api/auth/signup', route => {
      requests++;
      expect(route.request().postDataJSON()).toEqual({ name: 'Demo Person', email: 'demo@example.test', password: 'long-example-password' });
      return route.fulfill({ status: 202, json: { pending: true, message: 'Check your email to finish setting up this account.' } });
    });
    await page.goto(BASE);
    await page.locator('.rv-hero').getByRole('button', { name: 'Get started' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByLabel('Full name')).toBeFocused();
    await dialog.getByLabel('Full name').fill('Demo Person');
    await dialog.getByLabel('Work email').fill('demo@example.test');
    await dialog.getByLabel('Password', { exact: true }).pressSequentially('short');
    await dialog.locator('button[type=submit]').click();
    expect(requests).toBe(0);
    await dialog.getByLabel('Password', { exact: true }).fill('long-example-password');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog.getByRole('status')).toHaveText('Check your email to finish setting up this account.');
    expect(requests).toBe(1);
    await expect(page).toHaveURL(BASE + '/');
    await page.screenshot({ path: `${SHOTS}/signup-pending.png` });
  });

  test('successful signup posts the existing payload and opens the gallery', async ({ page }) => {
    await page.unroute('**/api/auth/config');
    await page.route('**/api/auth/config', route => route.fulfill({ json: { googleClientId: null, selfSignupEnabled: true } }));
    await page.route('**/api/auth/signup', route => {
      expect(route.request().postDataJSON()).toEqual({ name: 'Demo Person', email: 'demo@example.test', password: 'long-example-password' });
      return route.fulfill({ json: { id: 1, email: 'demo@example.test' } });
    });
    await page.route('**/gallery', route => route.fulfill({ contentType: 'text/html', body: '<h1>Workspace destination</h1>' }));
    await page.goto(BASE);
    await page.locator('.rv-hero').getByRole('button', { name: 'Get started' }).click();
    await page.getByLabel('Full name').fill('Demo Person');
    await page.getByLabel('Work email').fill('demo@example.test');
    await page.getByLabel('Password', { exact: true }).fill('long-example-password');
    await page.locator('.login-form button[type=submit]').click();
    await expect(page).toHaveURL(BASE + '/gallery');
  });

  test('Google is loaded only when configured and keeps the current auth intent', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    let sdkLoads = 0;
    await page.unroute('**/api/auth/config');
    await page.route('**/api/auth/config', route => route.fulfill({ json: { googleClientId: 'configured-test-client', selfSignupEnabled: true } }));
    await page.route('https://accounts.google.com/gsi/client', route => {
      sdkLoads++;
      return route.fulfill({ contentType: 'application/javascript', body: `
        let options;
        window.google = { accounts: { id: {
          initialize: value => { options = value; },
          renderButton: (element, style) => {
            const button = document.createElement('button');
            button.textContent = 'Continue with Google';
            button.style.width = style.width + 'px';
            button.onclick = () => options.callback({ credential: 'synthetic-credential' });
            element.appendChild(button);
          }
        } } };
      ` });
    });
    await page.route('**/api/auth/verify', route => {
      expect(route.request().postDataJSON()).toEqual({ credential: 'synthetic-credential', intent: 'signup' });
      return route.fulfill({ status: 403, json: { error: 'Use your invited work account.' } });
    });
    await page.goto(BASE);
    expect(sdkLoads).toBe(0);
    await page.locator('.rv-hero').getByRole('button', { name: 'Get started' }).click();
    await expect(page.getByLabel('Full name')).toBeVisible();
    await page.getByRole('button', { name: 'Continue with Google' }).click();
    await expect(page.getByRole('alert')).toHaveText('Use your invited work account.');
    expect(await page.locator('.rv-auth-dialog').evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    expect(sdkLoads).toBe(1);
  });

  test('short landscape screens keep every demo stage reachable', async ({ page }) => {
    await page.setViewportSize({ width: 740, height: 390 });
    await page.goto(BASE);
    await page.getByRole('button', { name: /Ask your data/ }).click();
    await page.getByRole('button', { name: 'Top reps', exact: true }).click();
    await expect(page.locator('#rv-query-status')).toContainText('Showing top reps');
    await page.getByRole('button', { name: /On every screen/ }).click();
    await page.getByRole('button', { name: 'Try fullscreen' }).click();
    await page.getByRole('button', { name: 'Exit presentation mode' }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expectNoOverflow(page);
  });

  test('configuration failure can be retried', async ({ page }) => {
    let attempts = 0;
    await page.unroute('**/api/auth/config');
    await page.route('**/api/auth/config', route => ++attempts === 1
      ? route.fulfill({ status: 500, json: { error: 'Service unavailable' } })
      : route.fulfill({ json: { googleClientId: null, selfSignupEnabled: false } }));
    await page.goto(BASE);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not reach the login service');
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('reduced motion disables animations and supports the complete journey', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(BASE);
    await expect(page.locator('.revenue-landing')).toHaveClass(/rv-static/);
    await expect(page.locator('.rv-bar-fill').first()).toHaveCSS('animation-name', 'none');
    await expect(page.locator('.rv-screen-shell')).toHaveCSS('transition-duration', '0s');
    await page.getByRole('button', { name: /Ask your data/ }).click();
    await page.getByRole('button', { name: 'Win rate', exact: true }).click();
    await expect(page.locator('#rv-query-status')).toContainText('Showing win rate');
    await page.getByRole('button', { name: /On every screen/ }).click();
    await expect(page.getByRole('heading', { name: 'Put it on the wall.', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Try fullscreen' }).click();
    await expect(page.getByRole('dialog', { name: 'Presentation preview' })).toBeVisible();
  });

  test('connection preview uses only supported sources and ends at authentication', async ({ page }) => {
    await page.goto(BASE);
    await page.getByRole('link', { name: 'Connect your data' }).click();
    await page.getByRole('button', { name: 'File upload', exact: true }).click();
    await expect(page.locator('.rv-source-surface h3')).toHaveText('File upload');
    await page.getByRole('button', { name: 'Next connection step' }).click();
    await expect(page.locator('.rv-source-surface h3')).toHaveText('Revenue overview');
    await page.getByRole('button', { name: 'Next connection step' }).click();
    await expect(page.locator('.rv-source-surface h3')).toHaveText('Your board is ready.');
    await page.screenshot({ path: `${SHOTS}/connection.png` });
    await page.getByRole('button', { name: 'Get started with your data' }).click();
    await expect(page.getByRole('dialog', { name: 'Access your workspace' })).toBeVisible();
  });
});
