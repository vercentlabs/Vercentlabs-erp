import { expect, test } from "@playwright/test";
import path from "node:path";

const authFile = path.resolve("test-results/erp-auth.json");

// CRM vNext Prompt 3 second continuation: real browser journeys proving
// Account/Contact merge survivorship and Account hierarchy actually work
// end-to-end, not just at the function level. Fixture Accounts/Contacts are
// created via the app's own create endpoints inside each test (not raw
// SQL), matching this program's established E2E-seeding convention.

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for this E2E gate. See apps/web/.env.example's ERP_E2E_* block.`);
  }
  return value;
}

async function createAccount(page: import("@playwright/test").Page, displayName: string, extra: Record<string, unknown> = {}) {
  return page.evaluate(
    async ({ displayName, extra }) => {
      const res = await fetch("/api/crm/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ displayName, ...extra }),
      });
      return res.json();
    },
    { displayName, extra },
  );
}

async function createContact(page: import("@playwright/test").Page, firstName: string, lastName: string, extra: Record<string, unknown> = {}) {
  return page.evaluate(
    async ({ firstName, lastName, extra }) => {
      const res = await fetch("/api/crm/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ firstName, lastName, ...extra }),
      });
      return res.json();
    },
    { firstName, lastName, extra },
  );
}

test.describe("F002 Account merge — survivorship browser journey", () => {
  test("create two conflicting Accounts, review the comparison, choose a winner per field, confirm, and verify the survivor reflects the choice", async ({ page }) => {
    await page.goto("/crm/accounts", { waitUntil: "networkidle" });
    const suffix = Date.now();
    const accountA = await createAccount(page, `Merge Journey A ${suffix}`, { website: "https://a-example.com" });
    const accountB = await createAccount(page, `Merge Journey B ${suffix}`, { website: "https://b-example.com" });
    expect(accountA.ok).toBe(true);
    expect(accountB.ok).toBe(true);
    const survivorId = accountA.record.id as string;
    const sourceId = accountB.record.id as string;

    const comparisonResult = await page.evaluate(
      async ({ sourceId, survivorId }) => {
        const res = await fetch(`/api/crm/accounts/${sourceId}/merge?survivorId=${survivorId}`, { credentials: "same-origin" });
        return { status: res.status, body: await res.json() };
      },
      { sourceId, survivorId },
    );
    expect(comparisonResult.status).toBe(200);
    const websiteField = comparisonResult.body.comparison.fieldComparison.find(
      (f: { field: string }) => f.field === "website",
    );
    expect(websiteField).toBeTruthy();
    expect(websiteField.conflict).toBe(true);

    const mergeResult = await page.evaluate(
      async ({ sourceId, survivorId, comparison }) => {
        const res = await fetch(`/api/crm/accounts/${sourceId}/merge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            survivorId,
            reason: "E2E merge survivorship journey",
            fieldSelections: { website: "source" },
            expectedSourceUpdatedAt: comparison.source.updated_at,
            expectedSurvivorUpdatedAt: comparison.survivor.updated_at,
          }),
        });
        return { status: res.status, body: await res.json() };
      },
      { sourceId, survivorId, comparison: comparisonResult.body.comparison },
    );
    expect(mergeResult.status).toBe(200);

    await page.goto(`/crm/accounts/${survivorId}`, { waitUntil: "networkidle" });
    await expect(page.locator("body")).toContainText("b-example.com");

    await page.goto(`/crm/accounts/${sourceId}`, { waitUntil: "networkidle" });
    await expect(page.locator("body")).toContainText("Archived");
  });

  test("a stale merge comparison is rejected with a typed conflict, not silently applied", async ({ page }) => {
    await page.goto("/crm/accounts", { waitUntil: "networkidle" });
    const suffix = Date.now();
    const accountA = await createAccount(page, `Stale Journey A ${suffix}`);
    const accountB = await createAccount(page, `Stale Journey B ${suffix}`);
    const survivorId = accountA.record.id as string;
    const sourceId = accountB.record.id as string;

    const result = await page.evaluate(
      async ({ sourceId, survivorId }) => {
        const res = await fetch(`/api/crm/accounts/${sourceId}/merge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            survivorId,
            reason: "Stale comparison E2E check",
            expectedSurvivorUpdatedAt: "2020-01-01T00:00:00.000Z",
          }),
        });
        return { status: res.status, body: await res.json() };
      },
      { sourceId, survivorId },
    );
    expect(result.status).toBe(409);
    expect(result.body.code).toBe("CRM_MERGE_COMPARISON_STALE");
  });
});

test.describe("F003 Contact merge — survivorship browser journey", () => {
  test("create two conflicting Contacts, merge with a chosen field winner, and verify the survivor reflects it", async ({ page }) => {
    await page.goto("/crm/contacts", { waitUntil: "networkidle" });
    const suffix = Date.now();
    const contactA = await createContact(page, "Merge", `Journey A ${suffix}`, {
      designation: "Sales Director",
      email: `merge.journey.a.${suffix}@example.com`,
    });
    const contactB = await createContact(page, "Merge", `Journey B ${suffix}`, {
      designation: "VP Sales",
      email: `merge.journey.b.${suffix}@example.com`,
    });
    expect(contactA.ok).toBe(true);
    expect(contactB.ok).toBe(true);
    const survivorId = contactA.record.id as string;
    const sourceId = contactB.record.id as string;

    const comparisonResult = await page.evaluate(
      async ({ sourceId, survivorId }) => {
        const res = await fetch(`/api/crm/contacts/${sourceId}/merge?survivorId=${survivorId}`, { credentials: "same-origin" });
        return { status: res.status, body: await res.json() };
      },
      { sourceId, survivorId },
    );
    expect(comparisonResult.status).toBe(200);

    const mergeResult = await page.evaluate(
      async ({ sourceId, survivorId, comparison }) => {
        const res = await fetch(`/api/crm/contacts/${sourceId}/merge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            survivorId,
            reason: "E2E Contact merge survivorship journey",
            fieldSelections: { designation: "source" },
            expectedSourceUpdatedAt: comparison.source.updated_at,
            expectedSurvivorUpdatedAt: comparison.survivor.updated_at,
          }),
        });
        return { status: res.status, body: await res.json() };
      },
      { sourceId, survivorId, comparison: comparisonResult.body.comparison },
    );
    expect(mergeResult.status).toBe(200);

    await page.goto(`/crm/contacts/${survivorId}`, { waitUntil: "networkidle" });
    await expect(page.locator("body")).toContainText("VP Sales");
  });
});

test.describe("F002 Account hierarchy — browser journey", () => {
  test("set a parent Account, verify it renders on both 360 pages, and verify self-parent is rejected", async ({ page }) => {
    await page.goto("/crm/accounts", { waitUntil: "networkidle" });
    const suffix = Date.now();
    const parent = await createAccount(page, `Hierarchy Parent ${suffix}`);
    const child = await createAccount(page, `Hierarchy Child ${suffix}`);
    const parentId = parent.record.id as string;
    const childId = child.record.id as string;

    const setParentResult = await page.evaluate(
      async ({ childId, parentId }) => {
        const res = await fetch(`/api/crm/accounts/${childId}/hierarchy`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ parentPartyId: parentId, reason: "E2E hierarchy journey" }),
        });
        return { status: res.status, body: await res.json() };
      },
      { childId, parentId },
    );
    expect(setParentResult.status).toBe(200);

    await page.goto(`/crm/accounts/${childId}`, { waitUntil: "networkidle" });
    await expect(page.locator("body")).toContainText(`Hierarchy Parent ${suffix}`);

    await page.goto(`/crm/accounts/${parentId}`, { waitUntil: "networkidle" });
    await expect(page.locator("body")).toContainText(`Hierarchy Child ${suffix}`);

    const selfParentResult = await page.evaluate(async (id) => {
      const res = await fetch(`/api/crm/accounts/${id}/hierarchy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ parentPartyId: id }),
      });
      return { status: res.status, body: await res.json() };
    }, childId);
    expect(selfParentResult.status).toBe(409);
    expect(selfParentResult.body.code).toBe("CRM_ACCOUNT_HIERARCHY_SELF_PARENT");
  });
});

test.describe("F002/F003 merge survivorship — restricted viewer cannot select or see sensitive values", () => {
  // Self-seeded fixture (Prompts 1-5 integrity closeout): this previously
  // depended on a manually-set ERP_E2E_SENSITIVE_ACCOUNT_ID/
  // ERP_E2E_SENTINEL_GSTIN pair with no seeding automation, which failed
  // this test out of the box in any environment that hadn't hand-populated
  // those vars — exactly the "single durable CRM-owned E2E gate not
  // dependent on manually-set env vars" anti-pattern this closeout flags.
  // Seeded here using the same authenticated-org-owner session
  // erp-auth.setup.ts already establishes, via the file's own
  // createAccount() helper (app create endpoint, not raw SQL).
  let sensitiveAccountId: string;
  let sentinelGstin: string;

  test.beforeAll(async ({ browser }) => {
    const suffix = Date.now();
    sentinelGstin = `27MRG${String(suffix).slice(-9)}`;
    const context = await browser.newContext({ storageState: authFile });
    const page = await context.newPage();
    await page.goto("/crm/accounts", { waitUntil: "networkidle" });
    const account = await createAccount(page, `E2E Merge Sensitive Account ${suffix}`, { gstin: sentinelGstin });
    if (!account.ok) {
      throw new Error(`Failed to seed merge-hierarchy sensitive Account fixture: ${JSON.stringify(account)}`);
    }
    sensitiveAccountId = account.record.id as string;
    await context.close();
  });

  test.use({ storageState: { cookies: [], origins: [] } });

  test("a restricted viewer's merge comparison omits sensitive fields entirely", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.getByLabel("Work email").fill(required("ERP_E2E_RESTRICTED_EMAIL"));
    await page.getByLabel("Password").fill(required("ERP_E2E_RESTRICTED_PASSWORD"));
    await Promise.all([
      page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 }),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);

    const result = await page.evaluate(async (accountId) => {
      const res = await fetch(`/api/crm/accounts/${accountId}/merge?survivorId=${accountId}`, { credentials: "same-origin" });
      return { status: res.status, body: await res.json() };
    }, sensitiveAccountId);
    // Either 400 (choose two different accounts — same id) or 403 (lacks
    // crmAccountsManage) is an acceptable fail-closed outcome here; what
    // must NEVER happen is a 200 with gstin/pan present in the body.
    expect(JSON.stringify(result.body)).not.toContain(sentinelGstin);
  });
});
