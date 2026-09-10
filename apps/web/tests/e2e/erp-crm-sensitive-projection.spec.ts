import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

// CRM vNext Prompt 3 continuation (§22): proves — with a real, deliberately
// restricted browser session, not just a unit-level function call — that
// Account GSTIN/PAN and Contact email/mobile never reach an unauthorized
// viewer's rendered page, and that an authorized viewer still sees them.
// Complements (does not replace) the function-level tests in
// crm-accounts-f002.test.mjs/crm-contacts-f003.test.mjs, which already
// prove projectAccountForContext/projectContactForContext redact correctly
// in isolation — this proves the full page render (getCrmAccountForCaller/
// getCrmContactForCaller wired into the actual Server Component) does too.
//
// Prompts 1-5 integrity closeout: this used to require four manually-set
// ERP_E2E_SENSITIVE_*/ERP_E2E_SENTINEL_* env vars with no seeding
// automation — exactly the "single durable CRM-owned E2E gate not
// dependent on manually-set env vars" anti-pattern the closeout review
// flagged, and it made every test in this file fail out of the box in any
// environment that hadn't hand-populated those four vars. It now self-seeds
// its own Account/Contact fixture (with a per-run sentinel GSTIN/email)
// using the same authenticated-org-owner session the shared `erp-auth.setup.ts`
// gate already establishes, following the same page.evaluate(fetch(...))
// same-origin-write pattern erp-crm-opportunity-journey.spec.ts uses.

const authFile = path.resolve("test-results/erp-auth.json");

let sensitiveAccountId: string;
let sensitiveContactId: string;
let sentinelGstin: string;
let sentinelContactEmail: string;

async function loginAs(page: Page, email: string, password: string) {
  await page.goto("/login", { waitUntil: "networkidle" });
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await Promise.all([
    page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 }),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);
  await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(
      `${name} is required for this E2E gate. See apps/web/.env.example's ERP_E2E_* block.`,
    );
  }
  return value;
}

test.beforeAll(async ({ browser }) => {
  const suffix = Date.now();
  // 15-char max on gstin (record-validation.js) — keep this well under it.
  sentinelGstin = `27SNTL${String(suffix).slice(-8)}`;
  sentinelContactEmail = `e2e.sentinel.${suffix}@vercentlabs.test`;

  const context = await browser.newContext({ storageState: authFile });
  const page = await context.newPage();
  // A relative fetch() URL needs a real document origin to resolve against
  // — a freshly-opened page defaults to about:blank, which has none.
  await page.goto("/crm/accounts", { waitUntil: "networkidle" });

  const account = await page.evaluate(
    async ({ gstin, suffix }) => {
      const res = await fetch("/api/crm/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          displayName: `E2E Sensitive Account ${suffix}`,
          partyType: "prospect",
          gstin,
        }),
      });
      return res.json();
    },
    { gstin: sentinelGstin, suffix },
  );
  if (!account.ok) {
    throw new Error(`Failed to seed sensitive-projection Account fixture: ${JSON.stringify(account)}`);
  }
  sensitiveAccountId = account.record.id as string;

  const contact = await page.evaluate(
    async ({ accountId, email, suffix }) => {
      const res = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          accountId,
          firstName: "Sentinel",
          lastName: `Contact${suffix}`,
          email,
        }),
      });
      return res.json();
    },
    { accountId: sensitiveAccountId, email: sentinelContactEmail, suffix },
  );
  if (!contact.ok) {
    throw new Error(`Failed to seed sensitive-projection Contact fixture: ${JSON.stringify(contact)}`);
  }
  sensitiveContactId = contact.record.id as string;

  await context.close();
});

test.describe("F002/F003 sensitive-field projection — restricted viewer", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a restricted viewer (no crm.accounts.view_sensitive / crm.contacts.view_sensitive) never sees the sentinel GSTIN or Contact email on the rendered page", async ({ page }) => {
    await loginAs(page, required("ERP_E2E_RESTRICTED_EMAIL"), required("ERP_E2E_RESTRICTED_PASSWORD"));

    await page.goto(`/crm/accounts/${sensitiveAccountId}`, { waitUntil: "networkidle" });
    const accountHtml = await page.content();
    const accountText = await page.locator("body").innerText();
    expect(accountHtml).not.toContain(sentinelGstin);
    expect(accountText).not.toContain(sentinelGstin);
    expect(accountText).toContain("Restricted account content");

    await page.goto(`/crm/contacts/${sensitiveContactId}`, { waitUntil: "networkidle" });
    const contactHtml = await page.content();
    const contactText = await page.locator("body").innerText();
    expect(contactHtml).not.toContain(sentinelContactEmail);
    expect(contactText).not.toContain(sentinelContactEmail);
    expect(contactText).toContain("Restricted contact content");
  });

  test("a restricted viewer cannot discover sensitive values through the JSON API routes either", async ({ page, request, baseURL }) => {
    await loginAs(page, required("ERP_E2E_RESTRICTED_EMAIL"), required("ERP_E2E_RESTRICTED_PASSWORD"));
    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const response = await request.get(`${baseURL}/api/crm/accounts/${sensitiveAccountId}`, {
      headers: { Cookie: cookieHeader },
    });
    const body = await response.text();
    expect(body).not.toContain(sentinelGstin);
  });
});

test.describe("F002/F003 sensitive-field projection — authorized viewer", () => {
  // Uses the default authenticated storageState from erp-auth.setup.ts
  // (the QA org owner, who holds crm.accounts.view_sensitive and
  // crm.contacts.view_sensitive) — the necessary positive-case control so
  // this gate proves redaction, not just "the field never renders at all."
  test("an authorized viewer sees the real GSTIN and Contact email", async ({ page }) => {
    await page.goto(`/crm/accounts/${sensitiveAccountId}`, { waitUntil: "networkidle" });
    await expect(page.locator("body")).toContainText(sentinelGstin);

    await page.goto(`/crm/contacts/${sensitiveContactId}`, { waitUntil: "networkidle" });
    await expect(page.locator("body")).toContainText(sentinelContactEmail);
  });
});
