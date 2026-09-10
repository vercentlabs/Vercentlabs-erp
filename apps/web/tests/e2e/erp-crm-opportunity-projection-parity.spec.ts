import path from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// Prompts 1-5 integrity closeout (blocker B, §9): behavioral proof that web
// (crm/opportunities/[id]/page.tsx) and mobile (api/mobile/v1/crm/
// [resource]/[id]/route.ts) make the SAME authorization decision for the
// same caller and the same Opportunity, because both now route through one
// canonical projection (getOpportunityDetailData). Compares actual
// projected content (a real communication's subject line present/absent),
// not just HTTP status — status-only parity would not have caught the
// original CRM-VNEXT-105/106/107/108 findings, all of which returned 200
// with silently-wrong content.
//
// Four scenarios: an authorized (owning) viewer sees the real sensitive
// content on both surfaces (positive control); an out-of-scope caller gets
// no record and no related-data inference on either surface for a
// nonexistent id; a restricted (non-owning, non-view_all) viewer gets no
// access and no content leakage on either surface for a real Opportunity
// they do not own — this QA fixture role cannot itself own an Opportunity
// (Opportunities are never ownerless by design), so denial-parity is the
// real, testable restricted-viewer property in this environment, not
// field-level redaction within a visible record.
//
// The Sales-quotation-visibility gate (canSeeOpportunitySalesQuotations) is
// covered by the unit-level structural test in
// crm-opportunity-communications-integrity.test.mjs rather than duplicated
// here — creating a real, schema-valid Sales quotation fixture (customer,
// price list, line items) is Sales-module setup this CRM-owned gate
// shouldn't need to carry just to prove a permission check that already has
// direct test coverage.
//
// Mobile tokens are minted ONCE per file (test.beforeAll), not per test —
// /api/mobile/v1/auth/login is real password authentication subject to
// enforceLoginRateLimits (10 attempts / 15 min per credential+IP); minting
// a fresh token per assertion is exactly what tripped that limit during
// this spec's own development. The restricted-viewer web check uses a
// separate test.describe with a declarative empty storageState (the same
// erp-crm-sensitive-projection.spec.ts/erp-crm-merge-hierarchy.spec.ts
// convention every other restricted-viewer test in this suite already
// uses) rather than manually creating a second browser context mid-test —
// the manual-context approach reliably hung waiting for the login page to
// reach "networkidle" in this environment.

const authFile = path.resolve("test-results/erp-auth.json");

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for this E2E gate. See apps/web/.env.example's ERP_E2E_* block.`);
  }
  return value;
}

async function createOpportunity(page: Page, name: string, extra: Record<string, unknown> = {}) {
  return page.evaluate(
    async ({ name, extra }) => {
      const res = await fetch("/api/crm/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name, amount: 10000, ...extra }),
      });
      return res.json();
    },
    { name, extra },
  );
}

async function createCommunication(page: Page, opportunityId: string, subject: string) {
  return page.evaluate(
    async ({ opportunityId, subject }) => {
      const res = await fetch("/api/crm/communications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ opportunityId, channel: "email", direction: "outbound", subject, body: subject, occurredAt: new Date().toISOString() }),
      });
      return res.json();
    },
    { opportunityId, subject },
  );
}

async function openOpportunityTab(page: Page, name: string) {
  await page.getByRole("tab", { name }).click();
}

async function mobileLogin(request: APIRequestContext, email: string, password: string) {
  const response = await request.post("/api/mobile/v1/auth/login", {
    data: {
      email,
      password,
      device: { deviceId: randomUUID(), platform: "android", deviceName: "e2e-parity-device", appVersion: "1.0.0" },
    },
  });
  const result = await response.json();
  if (!result.ok) throw new Error(`Mobile login failed: ${JSON.stringify(result)}`);
  return {
    accessToken: result.accessToken as string,
    userId: result.session.user.id as string,
    activeCompanyId: result.session.workspace.activeCompanyId as string | null,
  };
}

async function fetchMobileOpportunity(request: APIRequestContext, accessToken: string, id: string) {
  const response = await request.get(`/api/mobile/v1/crm/opportunities/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "x-vercentlabs-client": "mobile/1.0.0" },
  });
  return { status: response.status(), body: await response.json() };
}

let ownerToken: string;
let restrictedToken: string;
let opportunityId: string;
let opportunityName: string;
let sentinelSubject: string;

test.beforeAll(async ({ browser, request }) => {
  const owner = await mobileLogin(request, required("ERP_E2E_EMAIL"), required("ERP_E2E_PASSWORD"));
  const restricted = await mobileLogin(request, required("ERP_E2E_RESTRICTED_EMAIL"), required("ERP_E2E_RESTRICTED_PASSWORD"));
  ownerToken = owner.accessToken;
  restrictedToken = restricted.accessToken;

  const context = await browser.newContext({ storageState: authFile });
  const page = await context.newPage();
  await page.goto("/crm/opportunities", { waitUntil: "networkidle" });
  const suffix = Date.now();
  opportunityName = `Parity${suffix}`;
  // Left unassigned (no ownerUserId — recordScope()'s owner-scope check
  // treats a NULL owner as visible to any caller regardless of
  // crm.records.view_all; assigning it to the restricted user instead was
  // tried and rejected server-side as CRM_OPPORTUNITY_OWNER_INELIGIBLE,
  // since their "read only" role is not an eligible Opportunity owner —
  // correct business behavior, not a bug to route around) and explicitly
  // scoped to the restricted viewer's own active company, discovered from
  // their own mobile login response rather than assumed — company scope
  // is an independent AND condition alongside owner scope, so an
  // unassigned record in a DIFFERENT company would still 404 for them.
  // Creating without an explicit ownerUserId still defaults ownership to
  // the creating actor (index.js: `prepared.ownerUserId ||= context.userId`
  // — a deliberate business rule, "avoids accidentally creating a broadly
  // visible unowned Opportunity"; Opportunities can never be genuinely
  // ownerless). Passing companyId matches company scope, but the record is
  // still owner-scoped to this session (the QA org owner).
  const created = await createOpportunity(page, opportunityName, { amount: 42000, companyId: restricted.activeCompanyId });
  if (!created.ok) throw new Error(`Failed to seed parity-fixture Opportunity: ${JSON.stringify(created)}`);
  opportunityId = created.record.id as string;
  sentinelSubject = `Parity sentinel ${suffix}`;
  const comm = await createCommunication(page, opportunityId, sentinelSubject);
  if (!comm.ok) throw new Error(`Failed to seed parity-fixture communication: ${JSON.stringify(comm)}`);
  await context.close();
});

test.describe("Opportunity detail projection parity — web vs mobile", () => {
  test("authorized viewer: web page and mobile API both show the real communication content (positive control)", async ({ page, request }) => {
    await page.goto(`/crm/opportunities/${opportunityId}`, { waitUntil: "networkidle" });
    await openOpportunityTab(page, "History");
    await expect(page.locator("body")).toContainText(sentinelSubject);

    const ownerMobile = await fetchMobileOpportunity(request, ownerToken, opportunityId);
    expect(ownerMobile.status).toBe(200);
    expect(JSON.stringify(ownerMobile.body.related.communications)).toContain(sentinelSubject);
  });

  test("out-of-scope caller: web and mobile agree on no record and no related-data inference for a well-formed but nonexistent Opportunity id", async ({ page, request }) => {
    const bogusId = "00000000-0000-4000-8000-000000000000";

    // The App Router's notFound() renders this app's custom not-found.tsx —
    // checked by content rather than raw HTTP status, since this
    // production-standalone server does not reliably surface a 404 status
    // code through page.goto() for a caught-and-rethrown notFound().
    await page.goto(`/crm/opportunities/${bogusId}`, { waitUntil: "networkidle" });
    await expect(page.getByText("Page not found")).toBeVisible();

    const mobile = await fetchMobileOpportunity(request, ownerToken, bogusId);
    expect(mobile.status).toBe(404);
    expect(mobile.body.ok).toBe(false);
    expect(mobile.body.record).toBeUndefined();
    expect(mobile.body.related).toBeUndefined();
  });
});

test.describe("Opportunity detail projection parity — restricted viewer", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // The QA "read only" restricted fixture role cannot itself be an
  // Opportunity owner (server rejects it: CRM_OPPORTUNITY_OWNER_INELIGIBLE)
  // and Opportunities can never be genuinely ownerless (see the beforeAll
  // comment above) — so this role can never legitimately hold owner-scope
  // access to ANY Opportunity it did not create. That is itself a real,
  // meaningful parity property to prove: web and mobile must agree, with
  // IDENTICAL content (not just status), that this restricted viewer gets
  // no access and no data leaks through either surface for an Opportunity
  // that both exists and holds real sensitive content — the sentinel
  // communication subject must never appear in either response body.
  test("restricted viewer: web page and mobile API agree on no access and no content leakage for an Opportunity outside this viewer's owner-scope", async ({ page, request }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.getByLabel("Work email").fill(required("ERP_E2E_RESTRICTED_EMAIL"));
    await page.getByLabel("Password").fill(required("ERP_E2E_RESTRICTED_PASSWORD"));
    await Promise.all([
      page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 }),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);

    await page.goto(`/crm/opportunities/${opportunityId}`, { waitUntil: "networkidle" });
    await expect(page.getByText("Page not found")).toBeVisible();
    const webBody = await page.content();
    expect(webBody).not.toContain(sentinelSubject);
    expect(webBody).not.toContain(opportunityName);

    const restrictedMobile = await fetchMobileOpportunity(request, restrictedToken, opportunityId);
    expect(restrictedMobile.status).toBe(404);
    expect(restrictedMobile.body.ok).toBe(false);
    expect(restrictedMobile.body.record).toBeUndefined();
    expect(restrictedMobile.body.related).toBeUndefined();
    expect(JSON.stringify(restrictedMobile.body)).not.toContain(sentinelSubject);
    expect(JSON.stringify(restrictedMobile.body)).not.toContain(opportunityName);
  });
});
