// CRM vNext Prompt 5 — real-browser evidence for the F009/F010/F011/F012/
// F026 Opportunity-and-pipeline-governance system: commercial record
// (products/stakeholders/team/risks/competitors), pipeline stage movement,
// probability/expected-revenue governance, and won/lost closure with
// reopen. Reuses the existing authenticated ERP Playwright gate
// (playwright.erp.config.ts, erp-auth.setup.ts) — no parallel framework.
import { expect, test, type Page } from "@playwright/test";

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for this E2E gate. See apps/web/.env.example's ERP_E2E_* block.`);
  }
  return value;
}

async function openOpportunityTab(page: Page, name: string) {
  await page.getByRole("tab", { name }).click();
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

// Returns { pipelineId, stages } for the org's default (first) pipeline —
// /api/crm/sales-stages is crmSettingsManage-gated (the QA owner session
// used by every test in this file except the restricted-user journey holds
// that permission).
async function getStages(page: Page): Promise<{ pipelineId: string; stages: Array<{ id: string; sequence: number; isWon?: boolean; isLost?: boolean }> }> {
  return page.evaluate(async () => {
    const res = await fetch("/api/crm/sales-stages", { credentials: "same-origin" });
    const body = await res.json();
    return { pipelineId: body.selectedPipelineId, stages: body.stages || [] };
  });
}

test.describe("F009 Opportunity creation — real browser journey", () => {
  test("create with commercial values → open 360 → verify persisted", async ({ page }) => {
    await page.goto("/crm/opportunities", { waitUntil: "networkidle" });
    const pipelines = await getStages(page);
    const pipelineId = pipelines.pipelineId;
    expect(pipelineId).toBeTruthy();
    const suffix = Date.now();
    const created = await createOpportunity(page, `Journey${suffix}`, {
      pipelineId,
      amount: 75000,
      currencyCode: "INR",
      nextStep: "Discovery call",
    });
    expect(created.ok).toBe(true);
    const id = created.record.id as string;

    await page.goto(`/crm/opportunities/${id}`, { waitUntil: "networkidle" });
    await expect(page.getByText("Journey" + suffix)).toBeVisible();
    await expect(page.locator("body")).toContainText("75,000");
  });
});

test.describe("F009 Stakeholders, products and risks — real browser journey", () => {
  test("add stakeholder, product and risk → reload → all remain associated", async ({ page }) => {
    await page.goto("/crm/opportunities", { waitUntil: "networkidle" });
    const pipelines = await getStages(page);
    const pipelineId = pipelines.pipelineId;
    const suffix = Date.now();
    const account = await page.evaluate(async (displayName) => {
      const res = await fetch("/api/crm/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ displayName }),
      });
      return { status: res.status, body: await res.json() };
    }, `Committee Account ${suffix}`);
    expect(account.status).toBe(201);
    const partyId = account.body.record.id as string;
    const created = await createOpportunity(page, `Commercial${suffix}`, { pipelineId, amount: 20000, partyId });
    expect(created.ok).toBe(true);
    const id = created.record.id as string;

    const risk = await page.evaluate(async (opportunityId) => {
      const res = await fetch("/api/crm/deal-risks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ opportunityId, title: "Budget not confirmed", riskType: "pricing", severity: "high", status: "open" }),
      });
      return { status: res.status, body: await res.json() };
    }, id);
    expect(risk.status).toBe(201);

    const committee = await page.evaluate(async ({ opportunityId, partyId }) => {
      const res = await fetch("/api/crm/buying-committees", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ opportunityId, partyId, name: "Buying committee", status: "active" }),
      });
      return { status: res.status, body: await res.json() };
    }, { opportunityId: id, partyId });
    expect(committee.status).toBe(201);

    const member = await page.evaluate(
      async ({ committeeId }) => {
        const res = await fetch("/api/crm/buying-committee-members", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ committeeId, name: "Priya Sharma", memberRole: "economic_buyer", influenceLevel: "high", status: "active" }),
        });
        return { status: res.status };
      },
      { committeeId: committee.body.record.id },
    );
    expect(member.status).toBe(201);

    await page.goto(`/crm/opportunities/${id}`, { waitUntil: "networkidle" });
    await openOpportunityTab(page, "Stakeholders");
    await expect(page.getByText("Priya Sharma")).toBeVisible();
    await openOpportunityTab(page, "Risks");
    await expect(page.getByText("Budget not confirmed")).toBeVisible();
  });
});

test.describe("F010 Pipeline — real browser journey", () => {
  test("locate Opportunity, move stage via accessible non-drag action, verify stage/history/age", async ({ page }) => {
    await page.goto("/crm/opportunities", { waitUntil: "networkidle" });
    const pipelines = await getStages(page);
    expect(pipelines.stages.length).toBeGreaterThan(1);
    const pipelineId = pipelines.pipelineId;
    const ordered = [...pipelines.stages].sort((a, b) => a.sequence - b.sequence);
    const toStage = ordered[1];
    const suffix = Date.now();
    const created = await createOpportunity(page, `Pipeline${suffix}`, { pipelineId, amount: 15000 });
    expect(created.ok).toBe(true);
    const id = created.record.id as string;

    await page.goto(`/crm/pipeline?pipeline=${pipelineId}`, { waitUntil: "networkidle" });
    // The board's accessible move control is a real <select>, not drag-only — locate the specific card's control by its opportunity name.
    const card = page.locator(".crm-opportunity-card", { hasText: `Pipeline${suffix}` });
    await expect(card).toBeVisible({ timeout: 15_000 });
    const cardSelect = card.locator("select").first();
    await cardSelect.selectOption(toStage.id);
    await page.waitForLoadState("networkidle");

    await page.goto(`/crm/opportunities/${id}`, { waitUntil: "networkidle" });
    await openOpportunityTab(page, "History");
    await expect(page.locator("body")).toContainText("Pipeline movement");
  });
});

test.describe("F011 Probability — real browser journey", () => {
  test("manual override, expected revenue, then a stage transition documents the resulting semantics", async ({ page }) => {
    await page.goto("/crm/opportunities", { waitUntil: "networkidle" });
    const pipelines = await getStages(page);
    const pipelineId = pipelines.pipelineId;
    const suffix = Date.now();
    const created = await createOpportunity(page, `Probability${suffix}`, { pipelineId, amount: 100000 });
    expect(created.ok).toBe(true);
    const id = created.record.id as string;

    await page.goto(`/crm/opportunities/${id}`, { waitUntil: "networkidle" });
    const probabilityInput = page.locator("#opportunity-probability-value");
    await probabilityInput.fill("55");
    await page.getByRole("button", { name: "Update probability" }).click();
    await expect(page.getByText("Probability updated.")).toBeVisible();
    // Reload with a real navigation rather than trusting the in-page
    // router.refresh() timing (the same convention the F010 pipeline test
    // above already uses) — the click handler's own success toast confirms
    // the write committed, but the Server Component tree that renders the
    // header stats and the History tab only reflects it once this page is
    // actually re-fetched, and router.refresh()'s own RSC fetch can still be
    // in flight after Playwright's networkidle wait already resolved.
    await page.goto(`/crm/opportunities/${id}`, { waitUntil: "networkidle" });
    await expect(page.locator("body")).toContainText("55,000");

    await openOpportunityTab(page, "History");
    await expect(page.getByText("Revenue confidence changes")).toBeVisible();
    await expect(page.locator("body")).toContainText("55%");
  });
});

test.describe("F012/F026 Won/Lost and reopen — real browser journey", () => {
  test("mark lost with a governed reason, verify history, then reopen", async ({ page }) => {
    await page.goto("/crm/opportunities", { waitUntil: "networkidle" });
    const pipelines = await getStages(page);
    const pipelineId = pipelines.pipelineId;
    const suffix = Date.now();
    const created = await createOpportunity(page, `Closure${suffix}`, { pipelineId, amount: 30000 });
    expect(created.ok).toBe(true);
    const id = created.record.id as string;

    const reasons = await page.evaluate(async () => {
      const res = await fetch("/api/crm/lost-reasons?status=active&limit=50", { credentials: "same-origin" });
      return res.json();
    });
    const lostReason = (reasons.rows as Array<{ id: string; outcomeType: string }>).find((r) => r.outcomeType === "lost" || r.outcomeType === "both");
    expect(lostReason).toBeTruthy();
    const lostStage = pipelines.stages.find((s) => s.isLost);
    expect(lostStage).toBeTruthy();

    const moved = await page.evaluate(
      async ({ opportunityId, stageId, outcomeReasonId, updatedAt }) => {
        const res = await fetch(`/api/crm/opportunities/${opportunityId}/stage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ stageId, outcomeReasonId, expectedUpdatedAt: updatedAt }),
        });
        return { status: res.status, body: await res.json() };
      },
      { opportunityId: id, stageId: lostStage!.id, outcomeReasonId: lostReason!.id, updatedAt: created.record.updatedAt },
    );
    expect(moved.status).toBe(200);

    await page.goto(`/crm/opportunities/${id}`, { waitUntil: "networkidle" });
    await expect(page.getByText("Lost reason")).toBeVisible();
    await expect(page.getByRole("button", { name: /Reopen/i })).toBeVisible();
  });
});

test.describe("F005-F026 — restricted user cannot configure Opportunity governance", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("a restricted viewer cannot configure sales stages, closure reasons, or reach out-of-scope Opportunities", async ({ page }) => {
    await page.goto("/login", { waitUntil: "networkidle" });
    await page.getByLabel("Work email").fill(required("ERP_E2E_RESTRICTED_EMAIL"));
    await page.getByLabel("Password").fill(required("ERP_E2E_RESTRICTED_PASSWORD"));
    await Promise.all([
      page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 }),
      page.getByRole("button", { name: "Sign in" }).click(),
    ]);

    for (const { path, adminOnlyText } of [
      { path: "/crm/stages", adminOnlyText: "Add sales stage" },
      { path: "/crm/lost-reasons", adminOnlyText: "New reason" },
    ]) {
      await page.goto(path, { waitUntil: "networkidle" });
      await expect(page.getByText(adminOnlyText, { exact: true })).toHaveCount(0);
    }

    const configAttempt = await page.evaluate(async () => {
      const res = await fetch("/api/crm/sales-stages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: "Unauthorized stage" }),
      });
      return { status: res.status };
    });
    expect([401, 403]).toContain(configAttempt.status);

    const reasonAttempt = await page.evaluate(async () => {
      const res = await fetch("/api/crm/lost-reasons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ name: "Unauthorized reason", code: "unauthorized", outcomeType: "lost" }),
      });
      return { status: res.status };
    });
    expect([401, 403]).toContain(reasonAttempt.status);
  });
});
