// Real-browser evidence for the UI 2.0 CRM Leads golden reference
// (docs/ux/UI_REWRITE_TRACKER.md Phase 4): /crm/leads-next (List, built on
// EnterpriseDataGrid) and /crm/leads-next/[id] (Record 360, built on
// RecordHeader/Tabs/ActivityTimeline/AuditTimeline). Reuses the existing
// authenticated ERP Playwright gate (playwright.erp.config.ts,
// erp-auth.setup.ts) and the same createLead-via-real-API pattern as
// erp-crm-lead-lifecycle-scoring.spec.ts, against a real Postgres fixture
// organization -- no mocking.
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

async function createLead(page: Page, firstName: string, extra: Record<string, unknown> = {}) {
  return page.evaluate(
    async ({ firstName, extra }) => {
      const res = await fetch("/api/crm/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ firstName, email: `${firstName.toLowerCase()}.${Date.now()}@example.com`, ...extra }),
      });
      return res.json();
    },
    { firstName, extra },
  );
}

test.describe("CRM Leads golden reference (UI 2.0)", () => {
  test("List renders a real lead through EnterpriseDataGrid and links to its Record 360", async ({ page }) => {
    await page.goto("/crm/leads-next", { waitUntil: "networkidle" });
    await expect(page).not.toHaveURL(/\/login(?:\?|$)/);
    await expect(page.getByRole("heading", { name: "Leads" })).toBeVisible();

    const suffix = Date.now();
    const created = await createLead(page, `Golden${suffix}`, { companyName: `Golden Corp ${suffix}` });
    expect(created.ok).toBe(true);
    const leadId = created.record.id as string;

    await page.goto("/crm/leads-next", { waitUntil: "networkidle" });
    const link = page.getByRole("link", { name: new RegExp(`Golden${suffix}`) });
    await expect(link).toBeVisible();

    await link.click();
    await expect(page).toHaveURL(new RegExp(`/crm/leads-next/${leadId}$`));
    await expect(page.getByRole("heading", { name: new RegExp(`Golden${suffix}`) })).toBeVisible();
  });

  test("Record 360 renders identity, tabs and a working link back to the full CRM workspace", async ({ page }) => {
    await page.goto("/crm/leads-next", { waitUntil: "networkidle" });
    const suffix = Date.now();
    const created = await createLead(page, `Detail${suffix}`, { companyName: `Detail Corp ${suffix}`, jobTitle: "Operations Lead" });
    expect(created.ok).toBe(true);
    const leadId = created.record.id as string;

    await page.goto(`/crm/leads-next/${leadId}`, { waitUntil: "networkidle" });
    await expect(page.getByRole("heading", { name: new RegExp(`Detail${suffix}`) })).toBeVisible();
    await expect(page.getByText("Operations Lead")).toBeVisible();

    for (const tabName of ["Overview", "Activity", "Sales context", "Governance"]) {
      await page.getByRole("tab", { name: tabName }).click();
      await expect(page.getByRole("tabpanel")).toBeVisible();
    }

    const workspaceLink = page.getByRole("link", { name: "Open full workspace" });
    await expect(workspaceLink).toHaveAttribute("href", `/crm/leads/${leadId}`);
  });

  test("List and Record 360 have no critical/serious axe violations", async ({ page }) => {
    // .topbar-profile is the existing app-shell chrome shared by every
    // authenticated page (real, pre-existing "button-name" defect, found by
    // this same axe scan -- confirmed not introduced by leads-next by
    // grepping for it outside this new code). Excluded so this gate
    // measures the golden reference's own markup, not pre-existing shell
    // debt; tracked separately in docs/ux/UI_REWRITE_TRACKER.md rather than
    // silently passed over.
    await page.goto("/crm/leads-next", { waitUntil: "networkidle" });
    const listViolations = (await new AxeBuilder({ page }).exclude(".topbar-profile").analyze()).violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    expect(listViolations, JSON.stringify(listViolations, null, 2)).toHaveLength(0);

    const suffix = Date.now();
    const created = await createLead(page, `Axe${suffix}`);
    expect(created.ok).toBe(true);
    await page.goto(`/crm/leads-next/${created.record.id}`, { waitUntil: "networkidle" });
    const detailViolations = (await new AxeBuilder({ page }).exclude(".topbar-profile").analyze()).violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    expect(detailViolations, JSON.stringify(detailViolations, null, 2)).toHaveLength(0);
  });
});
