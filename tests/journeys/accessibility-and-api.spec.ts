import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { API_BASE_URL, ensureApiRunning } from './lib/api-process.js';

const FORBIDDEN_MOCK_DATA_PATTERNS = [
  /acme corp/i,
  /john doe/i,
  /jane doe/i,
  /lorem ipsum/i,
  /customer #\d+/i,
  /\$\d{1,3}(,\d{3})*\.\d{2}/, // a rendered money amount
];

test.beforeAll(async () => {
  await ensureApiRunning();
});

test.describe('apps/api contract (real runtime calls)', () => {
  test('liveness, readiness and OpenAPI document all respond for real', async ({ request }) => {
    const live = await request.get(`${API_BASE_URL}/health/live`);
    expect(live.ok()).toBe(true);
    expect(await live.json()).toEqual({ status: 'ok' });

    const ready = await request.get(`${API_BASE_URL}/health/ready`);
    expect(ready.ok()).toBe(true);
    const readyBody = (await ready.json()) as { status: string; checks: Record<string, boolean> };
    expect(readyBody.status).toBe('ok');
    expect(readyBody.checks['postgres']).toBe(true);
    expect(readyBody.checks['redis']).toBe(true);

    const openapi = await request.get(`${API_BASE_URL}/docs-json`);
    expect(openapi.ok()).toBe(true);
    const document = (await openapi.json()) as { openapi: string; paths: Record<string, unknown> };
    expect(document.openapi).toMatch(/^3\./);
    expect(document.paths['/api/v1/health/live']).toBeDefined();
    expect(document.paths['/api/v1/health/ready']).toBeDefined();
  });
});

test.describe('foundation page journey', () => {
  test('loads with an accessible heading and reflects live (not build-time) API status', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/Engineering Foundation/);
    // Proven live, not a static snapshot, together with api-availability.spec.ts
    // which shows this same value flips to "unreachable" when the API is down.
    await expect(page.locator('dd').nth(1)).toHaveText('ok');
  });

  test('successful journey has no console errors and no mock ERP/customer data', async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => consoleErrors.push(error.message));

    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    const bodyText = await page.locator('body').innerText();
    for (const pattern of FORBIDDEN_MOCK_DATA_PATTERNS) {
      expect(bodyText).not.toMatch(pattern);
    }

    expect(consoleErrors).toEqual([]);
  });

  test('shows a 404 page for an unknown route', async ({ page }) => {
    const response = await page.goto('/this-route-does-not-exist');
    expect(response?.status()).toBe(404);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
  });

  test('skip link is keyboard accessible, moves focus to main content, and does not trap focus', async ({
    page,
  }) => {
    await page.goto('/');
    await page.keyboard.press('Tab');
    await expect(page.locator('.skip-link')).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();

    await page.keyboard.press('Tab');
    await expect(page.locator('#main-content')).not.toBeFocused();
  });

  test('foundation page has no serious or critical automated accessibility violations', async ({
    page,
  }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page }).analyze();
    const seriousOrCritical = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
  });

  test('not-found page has no serious or critical automated accessibility violations', async ({
    page,
  }) => {
    await page.goto('/this-route-does-not-exist');
    const results = await new AxeBuilder({ page }).analyze();
    const seriousOrCritical = results.violations.filter(
      (violation) => violation.impact === 'serious' || violation.impact === 'critical',
    );
    expect(seriousOrCritical, JSON.stringify(seriousOrCritical, null, 2)).toEqual([]);
  });
});
