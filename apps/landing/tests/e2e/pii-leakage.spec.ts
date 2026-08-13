import { test, expect } from "@playwright/test";

/**
 * Mandatory per the Phase 7 brief: exercise the real demo form with
 * distinctive fake PII values and assert those exact values never appear in
 * any analytics event payload. This checks the analytics sink specifically —
 * NOT the /api/book-demo request body, which is *supposed* to carry the
 * submitted lead data (that's the entire point of lead capture; it's sent
 * over HTTPS to a signed, trusted proxy, not to analytics). The distinction
 * matters: leaking PII into `track()` calls is the real risk this test
 * guards against (analytics events can end up in a third-party provider's
 * systems, dashboards visible to non-sales staff, etc.), not the lead
 * delivery itself.
 *
 * The real CRM proxy isn't configured with credentials in this test
 * environment, so /api/book-demo is intercepted and stubbed with a
 * controlled response — this test's job is analytics payload hygiene, not
 * re-proving lead delivery (see lead-reliability.spec.ts and
 * crm-capture.test.mjs for that).
 */

const PII = {
  firstName: "PiiTestFirstName93x7",
  lastName: "PiiTestLastNameQ42m",
  email: "pii-leak-test-8f3k2@example-pii-test.com",
  phone: "+15550009999",
  companyName: "Pii Leak Test Distinctive Company Name Zz9",
  jobTitle: "Pii Leak Test Distinctive Job Title Qq7",
  mainChallenge: "Pii Leak Test Distinctive Free Text Challenge Field Value Xk4",
};

test("no PII appears in any analytics event payload across a full demo-form submission", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __capturedAnalyticsEvents: unknown[] }).__capturedAnalyticsEvents = [];
    (window as unknown as { __vercentlabsAnalyticsSink: (event: string, properties?: unknown) => void }).__vercentlabsAnalyticsSink = (
      event: string,
      properties?: unknown,
    ) => {
      (window as unknown as { __capturedAnalyticsEvents: unknown[] }).__capturedAnalyticsEvents.push({ event, properties });
    };
  });

  await page.route("**/api/book-demo", async (route) => {
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, requestId: "pii-test-stub-request-id" }) });
  });

  await page.goto("/book-demo");

  await page.getByLabel("First name").fill(PII.firstName);
  await page.getByLabel("Last name").fill(PII.lastName);
  await page.getByLabel("Work email").fill(PII.email);
  await page.getByLabel("Phone number").fill(PII.phone);
  await page.getByLabel("Company name").fill(PII.companyName);
  await page.getByLabel("Your role").fill(PII.jobTitle);
  await page.getByLabel("What's the main challenge you're hoping to solve?").fill(PII.mainChallenge);
  await page.getByLabel("What are you most interested in?").selectOption({ label: "CRM & Sales" });
  await page.getByLabel(/I agree to be contacted/i).check();

  await page.getByRole("button", { name: "Book a Demo" }).click();
  await page.waitForURL(/\/book-demo\/thank-you/);

  const capturedEvents = await page.evaluate(() => (window as unknown as { __capturedAnalyticsEvents: unknown[] }).__capturedAnalyticsEvents);
  expect(capturedEvents.length).toBeGreaterThan(0);

  const serialized = JSON.stringify(capturedEvents);
  for (const [field, value] of Object.entries(PII)) {
    expect(serialized, `analytics payload leaked field "${field}"`).not.toContain(value);
  }
  // Also check partial/case-insensitive leakage of the email (the highest-risk field).
  expect(serialized.toLowerCase()).not.toContain(PII.email.toLowerCase());
});

test("analytics payloads contain no PII even on a validation error", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { __capturedAnalyticsEvents: unknown[] }).__capturedAnalyticsEvents = [];
    (window as unknown as { __vercentlabsAnalyticsSink: (event: string, properties?: unknown) => void }).__vercentlabsAnalyticsSink = (
      event: string,
      properties?: unknown,
    ) => {
      (window as unknown as { __capturedAnalyticsEvents: unknown[] }).__capturedAnalyticsEvents.push({ event, properties });
    };
  });

  await page.goto("/book-demo");
  await page.getByLabel("Work email").fill(PII.email);
  await page.getByLabel("First name").fill(PII.firstName);
  // Deliberately leave required fields (phone, company, consent) empty to trigger validation errors.
  await page.getByRole("button", { name: "Book a Demo" }).click();
  // "One field needs attention" (singular) vs "N fields need attention" (plural, no S) — match both.
  await expect(page.getByText(/attention below/i)).toBeVisible();

  const capturedEvents = await page.evaluate(() => (window as unknown as { __capturedAnalyticsEvents: unknown[] }).__capturedAnalyticsEvents);
  const serialized = JSON.stringify(capturedEvents);
  expect(serialized).not.toContain(PII.email);
  expect(serialized).not.toContain(PII.firstName);
});
