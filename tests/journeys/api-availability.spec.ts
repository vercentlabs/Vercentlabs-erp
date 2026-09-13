import { expect, test } from '@playwright/test';
import {
  API_PORT,
  ensureApiRunning,
  isApiLive,
  startApi,
  stopProcessOnPort,
  waitUntil,
} from './lib/api-process.js';

/**
 * Stops and restarts the real, compiled apps/api process to prove the
 * foundation page reflects genuine live status rather than mocking the
 * network layer - the API status check runs server-side (Next.js Server
 * Component fetch), so browser-level request interception would never
 * observe it. Runs serially so no other spec races this process lifecycle.
 */
test.describe.configure({ mode: 'serial' });

test.describe('API availability and recovery (foundation gate)', () => {
  test.afterAll(async () => {
    // Leave the API running for any other spec files or manual use.
    await ensureApiRunning();
  });

  test('shows an actionable, honest non-ok state when apps/api is unreachable', async ({
    page,
  }) => {
    await stopProcessOnPort(API_PORT);
    expect(await isApiLive()).toBe(false);

    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    const readinessValue = page.locator('dd').nth(1);
    await expect(readinessValue).toHaveText('unreachable');
    await expect(readinessValue).not.toHaveText('ok');
    // page.getByRole('alert') would also match Next.js's own internal
    // (empty, shadow-DOM) route announcer, so target our element directly.
    await expect(page.locator('p[role="alert"]')).toContainText('did not respond');
  });

  test('recovers and reports live status once apps/api becomes available again', async ({
    page,
  }) => {
    startApi();
    await waitUntil(isApiLive, 30_000, 300);

    await page.goto('/');

    const readinessValue = page.locator('dd').nth(1);
    await expect(readinessValue).toHaveText('ok');
    await expect(page.locator('p[role="alert"]')).toHaveCount(0);
  });
});
