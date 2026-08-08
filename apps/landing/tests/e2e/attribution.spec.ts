import { test, expect } from "@playwright/test";

/**
 * Real browser attribution behavior — Phase 7 Workstream M. `tests/attribution.test.mjs`
 * only proves the module degrades gracefully outside a browser; this suite exercises the
 * actual localStorage-backed first-touch logic in a real browser, across the scenarios the
 * governing brief names explicitly.
 */

const STORAGE_KEY = "vercentlabs_attribution_v1";

async function readAttribution(page: import("@playwright/test").Page) {
  // AttributionInit captures first-touch in a client-side useEffect after
  // hydration — reading localStorage immediately after goto() races that
  // effect on slower (mobile-emulated) runs. Poll briefly instead of
  // assuming hydration has already completed.
  await page.waitForFunction((key) => window.localStorage.getItem(key) !== null, STORAGE_KEY, { timeout: 5000 });
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, STORAGE_KEY);
}

test("initial campaign visit captures UTM params and referrer category as first touch", async ({ page }) => {
  await page.goto("/?utm_source=linkedin&utm_medium=paid_social&utm_campaign=q3_launch");
  const record = await readAttribution(page);
  expect(record).not.toBeNull();
  expect(record.utmSource).toBe("linkedin");
  expect(record.utmMedium).toBe("paid_social");
  expect(record.utmCampaign).toBe("q3_launch");
  expect(record.landingPath).toBe("/");
  expect(record.firstTouchAt).toBeTruthy();
});

test("internal navigation after first touch does not overwrite the original attribution", async ({ page }) => {
  await page.goto("/?utm_source=linkedin&utm_medium=paid_social&utm_campaign=q3_launch");
  const firstTouch = await readAttribution(page);

  await page.getByRole("link", { name: /modules/i }).first().click();
  await page.waitForLoadState("networkidle");
  const afterNav = await readAttribution(page);

  expect(afterNav.firstTouchAt).toBe(firstTouch.firstTouchAt);
  expect(afterNav.utmSource).toBe("linkedin");
});

test("attribution survives a refresh unchanged", async ({ page }) => {
  await page.goto("/?utm_source=google&utm_medium=cpc&utm_campaign=brand");
  const before = await readAttribution(page);

  await page.reload();
  const after = await readAttribution(page);

  expect(after).toEqual(before);
});

test("attribution survives back/forward navigation unchanged", async ({ page }) => {
  await page.goto("/?utm_source=google&utm_medium=cpc&utm_campaign=brand");
  const initial = await readAttribution(page);

  await page.goto("/product");
  await page.goBack();
  await page.waitForLoadState("networkidle");
  const afterBack = await readAttribution(page);

  expect(afterBack.firstTouchAt).toBe(initial.firstTouchAt);
});

test("a second, later campaign visit in the same browser does NOT overwrite first touch", async ({ page }) => {
  await page.goto("/?utm_source=linkedin&utm_medium=paid_social&utm_campaign=first_campaign");
  const firstTouch = await readAttribution(page);

  await page.goto("/?utm_source=google&utm_medium=cpc&utm_campaign=second_campaign");
  const stillFirstTouch = await readAttribution(page);

  expect(stillFirstTouch.utmSource).toBe("linkedin");
  expect(stillFirstTouch.utmCampaign).toBe("first_campaign");
  expect(stillFirstTouch.firstTouchAt).toBe(firstTouch.firstTouchAt);
});

test("a direct revisit with no campaign params does not overwrite existing attribution", async ({ page }) => {
  await page.goto("/?utm_source=linkedin&utm_medium=paid_social&utm_campaign=q3_launch");
  const firstTouch = await readAttribution(page);

  await page.goto("/book-demo");
  const afterDirectRevisit = await readAttribution(page);

  expect(afterDirectRevisit).toEqual(firstTouch);
});

test("a visit with no campaign params at all still records direct/referral attribution (no crash)", async ({ page }) => {
  await page.goto("/product");
  const record = await readAttribution(page);
  expect(record).not.toBeNull();
  expect(record.utmSource).toBeUndefined();
  expect(["direct", "search", "social", "referral", "email"]).toContain(record.referrerCategory);
});

test("malformed/oversized UTM params are truncated, not rejected or crashing", async ({ page }) => {
  const longValue = "x".repeat(500);
  await page.goto(`/?utm_source=${longValue}`);
  const record = await readAttribution(page);
  expect(record).not.toBeNull();
  expect(record.utmSource!.length).toBeLessThanOrEqual(200);
});

test("attribution reaches the demo form submission (available via getAttribution at submit time)", async ({ page }) => {
  await page.goto("/?utm_source=linkedin&utm_medium=paid_social&utm_campaign=q3_launch");
  // Wait for the FIRST page's AttributionInit effect to actually write to
  // localStorage before navigating away — without this, page.goto("/book-demo")
  // can race ahead of React's effect (goto() only waits for the load event,
  // not for a post-paint useEffect to run). If the second page's own
  // AttributionInit fires first, it sees no existing record, and since
  // /book-demo's URL has no utm params, it captures a NEW first-touch record
  // with utmSource undefined — a real, intermittent (~50%) race found during
  // Cycle 3 regression, not a product bug (every sibling test that reads
  // attribution on the first page before navigating away passes reliably).
  await readAttribution(page);
  await page.goto("/book-demo");
  const record = await readAttribution(page);
  expect(record.utmSource).toBe("linkedin");
});
