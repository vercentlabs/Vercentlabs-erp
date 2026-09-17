import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { fixtures } from "./fixtures";

const pages = [
  ["/crm", "CRM Home"],
  ["/crm/leads", "Lead List"],
  ["/crm/leads/new", "Lead Form"],
  ["/crm/accounts", "Account List"],
  ["/crm/contacts", "Contact List"],
  ["/crm/opportunities", "Opportunity List"],
  ["/crm/pipeline", "Pipeline"],
  ["/crm/dashboard", "Dashboard"],
] as const;

for (const [route, label] of pages) {
  test(`${label} has no critical/serious accessibility violations`, async ({ page }) => {
    await page.goto(route, { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();

    const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    const summary = blocking.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`);
    expect(blocking, summary.join("\n")).toEqual([]);
  });
}

test("Opportunity 360 has no critical/serious accessibility violations", async ({ page }) => {
  await page.goto(`/crm/opportunities/${fixtures.opportunityId}`, { waitUntil: "networkidle" });
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  const summary = blocking.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`);
  expect(blocking, summary.join("\n")).toEqual([]);
});
