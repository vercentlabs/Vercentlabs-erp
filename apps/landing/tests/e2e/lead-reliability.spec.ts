import { test, expect } from "@playwright/test";

/**
 * Controlled-failure tests across the real lead-delivery chain: visitor →
 * form → validation → /api/book-demo → (HMAC-signed proxy → apps/web,
 * covered separately by crm-capture.test.mjs's real signature-contract
 * tests, which don't need a browser). This file covers what only a real
 * browser + real HTTP round-trip can prove: no crash, no duplicate lead
 * from a double click, a real user-facing message on failure, and that the
 * existing rate limiter actually engages over real requests.
 */

const VALID_FORM_BODY = {
  firstName: "Reliability",
  lastName: "Test",
  email: "reliability-test@example.com",
  phone: "+15550001111",
  companyName: "Reliability Test Co",
  jobTitle: "",
  industry: "",
  companySize: "",
  primaryInterest: "CRM & Sales",
  mainChallenge: "",
  preferredContactTime: "",
  consentEmail: true,
  websiteUrl: "",
  companyWebsiteHidden: "",
};

/**
 * The rate limiter (lib/rate-limit.ts) buckets by client IP and is real,
 * shared, in-memory state on the running server process — so every test
 * that hits /api/book-demo needs its own synthetic IP (via x-forwarded-for,
 * which clientIp() reads first) or repeated test runs / test order would
 * cross-contaminate each other's buckets. This isn't a workaround for a
 * product bug — it's the correct way to simulate distinct real clients.
 */
function uniqueClientHeaders(seed: string) {
  return { "x-forwarded-for": `203.0.113.${(Math.abs(hashCode(seed)) % 200) + 10}` };
}
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return h;
}

test.describe("direct API-level failure injection", () => {
  test("malformed JSON body returns a real 400, not a crash", async ({ request }) => {
    // A plain string `data` value gets JSON.stringify'd by Playwright's own
    // request context (producing a *valid* JSON string literal, not raw
    // invalid bytes) — a real gotcha found while running this test. A Buffer
    // is sent as raw, unmodified bytes, which is what actually exercises
    // route.ts's `request.json()` parse-failure path.
    const response = await request.post("/api/book-demo", {
      headers: { "Content-Type": "application/json", ...uniqueClientHeaders("malformed-json") },
      data: Buffer.from("{not valid json"),
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.requestId).toBeTruthy();
  });

  test("a literal `null` JSON body (syntactically valid, not an object) returns a real 400, not a crash", async ({ request }) => {
    // Found this way during Phase 7 Cycle 2 review: JSON.parse("null") succeeds
    // (unlike the malformed-JSON case above), so this previously reached
    // validateDemoForm(null), which threw on property access and crashed into
    // an uncaught, unlogged 500 with an empty body. See decision-log.md item 13.
    const response = await request.post("/api/book-demo", {
      headers: { "Content-Type": "application/json", ...uniqueClientHeaders("null-body") },
      data: Buffer.from("null"),
    });
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.requestId).toBeTruthy();
  });

  test("missing required fields returns a real 422 with per-field errors, not a 500", async ({ request }) => {
    const response = await request.post("/api/book-demo", {
      headers: uniqueClientHeaders("missing-fields"),
      data: { firstName: "", email: "not-an-email", phone: "", consentEmail: false },
    });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.ok).toBe(false);
    expect(body.errors).toBeTruthy();
    expect(Object.keys(body.errors).length).toBeGreaterThan(0);
  });

  test("a honeypot field being non-empty is rejected, not silently accepted", async ({ request }) => {
    const response = await request.post("/api/book-demo", {
      headers: uniqueClientHeaders("honeypot"),
      data: { ...VALID_FORM_BODY, websiteUrl: "http://spam-bot-filled-this-in.example" },
    });
    expect(response.status()).toBe(422);
    const body = await response.json();
    expect(body.errors?.websiteUrl).toBeTruthy();
  });

  test("real rate limiting engages after repeated requests from the same client", async ({ request }) => {
    const headers = uniqueClientHeaders(`rate-limit-${Date.now()}`);
    const responses = [];
    for (let i = 0; i < 6; i++) {
      responses.push(await request.post("/api/book-demo", { headers, data: { ...VALID_FORM_BODY, email: `rate-limit-test-${i}@example.com` } }));
    }
    const statuses = responses.map((r) => r.status());
    // Every one of the 6 is either a real delivery attempt — 201 if apps/web's
    // real CRM capture endpoint is reachable, or 500 if it isn't (this test
    // environment doesn't run apps/web alongside apps/landing, so a real
    // connection-refused is expected and correct — confirmed via a direct
    // curl showing 500, not a crash) — or 429 once the rate limit engages.
    // The real invariant this test protects is "never anything else,"
    // i.e. the rate limiter itself never produces an unexpected status.
    expect(statuses.every((s) => [201, 429, 500, 502].includes(s)), `unexpected statuses: ${statuses.join(",")}`).toBe(true);
    expect(statuses).toContain(429);
    const limited = responses[responses.length - 1];
    expect(limited.headers()["retry-after"]).toBeTruthy();
  });
});

test.describe("client-level failure handling", () => {
  test("a 502 upstream failure shows a real retry-able message, not a crash", async ({ page }) => {
    await page.route("**/api/book-demo", async (route) => {
      await route.fulfill({ status: 502, contentType: "application/json", body: JSON.stringify({ ok: false, requestId: "test-rid", error: "We couldn't submit your request. Please try again." }) });
    });
    await page.goto("/book-demo");
    await page.getByLabel("First name").fill("Reliability");
    await page.getByLabel("Work email").fill("reliability@example.com");
    await page.getByLabel("Phone number").fill("+15550001111");
    await page.getByLabel("Company name").fill("Reliability Co");
    await page.getByLabel("What are you most interested in?").selectOption({ label: "CRM & Sales" });
    await page.getByLabel(/I agree to be contacted/i).check();
    await page.getByRole("button", { name: "Book a Product Demo" }).click();

    await expect(page.getByText(/couldn't submit your request/i)).toBeVisible();
    // The form must still be usable — fields aren't cleared, a retry is possible.
    await expect(page.getByLabel("First name")).toHaveValue("Reliability");
  });

  test("a network-level abort shows a real connection-error message, not a blank page", async ({ page }) => {
    await page.route("**/api/book-demo", (route) => route.abort("failed"));
    await page.goto("/book-demo");
    await page.getByLabel("First name").fill("Reliability");
    await page.getByLabel("Work email").fill("reliability@example.com");
    await page.getByLabel("Phone number").fill("+15550001111");
    await page.getByLabel("Company name").fill("Reliability Co");
    await page.getByLabel("What are you most interested in?").selectOption({ label: "CRM & Sales" });
    await page.getByLabel(/I agree to be contacted/i).check();
    await page.getByRole("button", { name: "Book a Product Demo" }).click();

    await expect(page.getByText(/couldn't reach the server/i)).toBeVisible();
  });

  test("rapid double-click on submit sends exactly one request, not a duplicate lead", async ({ page }) => {
    let requestCount = 0;
    await page.route("**/api/book-demo", async (route) => {
      requestCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 300));
      await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ ok: true, requestId: "dedup-test-rid" }) });
    });
    await page.goto("/book-demo");
    await page.getByLabel("First name").fill("Reliability");
    await page.getByLabel("Work email").fill("reliability@example.com");
    await page.getByLabel("Phone number").fill("+15550001111");
    await page.getByLabel("Company name").fill("Reliability Co");
    await page.getByLabel("What are you most interested in?").selectOption({ label: "CRM & Sales" });
    await page.getByLabel(/I agree to be contacted/i).check();

    // A genuinely concurrent double-click, not two sequentially-awaited
    // `.click()` calls (which each wait for actionability first — by the
    // time the second one's wait resolves, the real race this test exists
    // to catch has already been decided one way or the other). Dispatching
    // both native click events in the same tick is what actually exercises
    // demo-form.tsx's `if (submitting) return;` guard under real contention.
    const submitButton = page.getByRole("button", { name: "Book a Product Demo" });
    await submitButton.evaluate((el: HTMLButtonElement) => {
      el.click();
      el.click();
    });

    await page.waitForURL(/\/book-demo\/thank-you/, { timeout: 10_000 });
    expect(requestCount).toBe(1);
  });
});
