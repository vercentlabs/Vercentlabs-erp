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
  ["/", "Home"],
  ["/work", "My work"],
  ["/search", "Search"],
  ["/crm/forecast", "Forecast"],
  ["/crm/tasks", "Task List"],
  ["/crm/calls", "Call List"],
  ["/crm/meetings", "Meeting List"],
  ["/crm/follow-ups", "Follow-up List"],
  ["/crm/communications", "Communications"],
  ["/crm/reports", "Reports"],
  ["/crm/data/duplicates", "Duplicates"],
  ["/crm/data/import-export", "Import and export"],
  ["/crm/settings/lead-lifecycle", "Lead lifecycle settings"],
  ["/crm/settings/lead-scoring", "Lead scoring settings"],
  ["/crm/settings/record-fields", "Record fields settings"],
  ["/crm/settings/custom-fields-and-tags", "Custom fields and tags settings"],
  ["/crm/settings/pipeline-stages", "Pipeline stages settings"],
  ["/crm/settings/lead-sources", "Lead sources settings"],
  ["/crm/settings/playbooks", "Playbooks settings"],
  ["/crm/settings/territories", "Territories settings"],
] as const;

for (const [route, label] of pages) {
  test(`${label} has no critical/serious accessibility violations`, async ({ page }) => {
    // The first visit to a page in a development server compiles it, which can take a minute.
    test.setTimeout(180_000);
    await page.goto(route, { waitUntil: "networkidle", timeout: 150_000 });
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
