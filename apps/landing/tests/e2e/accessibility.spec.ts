import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Automated WCAG 2.2 AA-oriented scan (axe-core), not a substitute for the
 * manual review in docs/landing-redesign/phase-7/wcag-22-matrix.md — this
 * catches machine-detectable violations (missing labels, contrast, ARIA
 * misuse, heading structure); it cannot catch everything WCAG covers
 * (e.g. whether an error message is genuinely helpful, or focus order is
 * logical — those are manually verified elsewhere). Every route below is
 * one of the 13 representative templates named in the Phase 7 brief.
 * serious/critical violations are release blockers; moderate/minor are
 * investigated but not automatically failing.
 */
const REPRESENTATIVE_ROUTES = [
  "/",
  "/book-demo",
  "/product",
  "/modules",
  "/modules/manufacturing",
  "/industries/manufacturing",
  "/workflows/lead-to-cash",
  "/implementation",
  "/resources",
  "/resources/erp-buying-guide",
  "/resources/erp-requirements-checklist",
  "/resources/glossary",
  "/compare/vercentlabs-vs-odoo",
];

for (const route of REPRESENTATIVE_ROUTES) {
  test(`axe: ${route} has no serious or critical violations`, async ({ page }) => {
    // Prompt 16 UI/UX audit (bug A11Y-001): under this project's default
    // fullyParallel concurrency, page.goto(networkidle) + a full axe-core
    // scan against one production server can exceed the default 30s budget
    // purely from resource contention — 8/13 tests here failed with "Test
    // timeout of 30000ms exceeded" at default concurrency, while all 13
    // passed cleanly (zero violations) re-run serially. Tripling the
    // timeout keeps a real hang failing loudly while absorbing normal
    // parallel-worker contention.
    test.slow();
    await page.goto(route, { waitUntil: "networkidle" });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag22aa"]).analyze();

    const seriousOrCritical = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
    const moderateOrMinor = results.violations.filter((v) => v.impact === "moderate" || v.impact === "minor");

    if (moderateOrMinor.length > 0) {
      // Not a test failure — logged for the manual accessibility-audit doc to
      // investigate, per the brief's "investigate moderate issues too."
      console.log(
        `[axe] ${route}: ${moderateOrMinor.length} moderate/minor finding(s): ${moderateOrMinor.map((v) => `${v.id} (${v.impact})`).join(", ")}`,
      );
    }

    expect(
      seriousOrCritical,
      seriousOrCritical.map((v) => `${v.id} (${v.impact}): ${v.help} — ${v.nodes.length} node(s) — ${v.helpUrl}`).join("\n"),
    ).toEqual([]);
  });
}
