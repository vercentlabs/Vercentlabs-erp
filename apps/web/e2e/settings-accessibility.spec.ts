import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

// Mirrors accessibility.spec.ts's exact pattern (axe-core, wcag2a/wcag2aa,
// critical/serious-only gate) for the shared-platform Settings screens
// built this pass -- these were not previously covered by any
// accessibility test.
const pages = [
  ["/settings", "Settings Index"],
  ["/settings/organization", "Organization"],
  ["/settings/companies", "Companies"],
  ["/settings/branches", "Branches"],
  ["/settings/users", "Users"],
  ["/settings/invitations", "Invitations"],
  ["/settings/roles", "Roles and permissions"],
  ["/settings/security", "Security"],
  ["/settings/profile", "Profile"],
] as const;

for (const [route, label] of pages) {
  test(`${label} has no critical/serious accessibility violations`, async ({ page }) => {
    await page.goto(route, { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
    const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
    const summary = blocking.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`);
    expect(blocking, summary.join("\n")).toEqual([]);
  });
}

test("New role dialog has no critical/serious accessibility violations", async ({ page }) => {
  await page.goto("/settings/roles", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "New role" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = results.violations.filter((v) => v.impact === "critical" || v.impact === "serious");
  const summary = blocking.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s)`);
  expect(blocking, summary.join("\n")).toEqual([]);
});
