import assert from "node:assert/strict";
import test from "node:test";
import { LANDING_SOLUTIONS, LANDING_MODULES, LANDING_WORKFLOWS, PLATFORM_PAGES, PRODUCT_OVERVIEW_PAGE, getSolution } from "../src/index.js";

const BANNED_PHRASES = [/coming soon/i, /lorem ipsum/i, /placeholder/i, /\btbd\b/i, /\btodo\b/i, /best[- ]in[- ]class/i, /world[- ]class/i, /industry[- ]leading/i, /#1\b/, /number one/i];

test("exactly 5 solutions exist, per the approved Phase 5 IA amendment", () => {
  assert.equal(LANDING_SOLUTIONS.length, 5);
});

test("every solution has a unique slug, searchIntent, and metaDescription", () => {
  const slugs = LANDING_SOLUTIONS.map((s) => s.slug);
  const intents = LANDING_SOLUTIONS.map((s) => s.searchIntent);
  const metas = LANDING_SOLUTIONS.map((s) => s.metaDescription);
  assert.equal(new Set(slugs).size, 5);
  assert.equal(new Set(intents).size, 5);
  assert.equal(new Set(metas).size, 5);
});

test("every solution has a directDefinition distinct from its problemStatement (no duplicate hero/DirectDefinition text)", () => {
  for (const solution of LANDING_SOLUTIONS) {
    assert.ok(solution.directDefinition && solution.directDefinition.length > 40, `${solution.slug} needs a real directDefinition`);
    assert.notEqual(
      solution.directDefinition.trim().toLowerCase(),
      solution.problemStatement.trim().toLowerCase(),
      `${solution.slug}'s directDefinition must not repeat problemStatement verbatim (the hero and DirectDefinition sections render different fields)`,
    );
  }
});

test("every solution's relatedPlatformPageSlug resolves to a real platform or product-overview route", () => {
  const realRoutes = new Set([PRODUCT_OVERVIEW_PAGE.slug, ...PLATFORM_PAGES.map((p) => p.slug)]);
  for (const solution of LANDING_SOLUTIONS) {
    assert.ok(
      realRoutes.has(solution.relatedPlatformPageSlug),
      `${solution.slug}'s relatedPlatformPageSlug '${solution.relatedPlatformPageSlug}' does not resolve to a real route`,
    );
  }
});

test("every solution's relatedModuleKeys reference real modules", () => {
  const realKeys = new Set(LANDING_MODULES.map((m) => m.key));
  for (const solution of LANDING_SOLUTIONS) {
    assert.ok(solution.relatedModuleKeys.length >= 1, `${solution.slug} needs at least 1 related module`);
    for (const key of solution.relatedModuleKeys) {
      assert.ok(realKeys.has(key), `${solution.slug} references unknown module '${key}'`);
    }
  }
});

test("every solution's relatedWorkflowSlugs (if any) reference real workflows", () => {
  const realSlugs = new Set(LANDING_WORKFLOWS.map((w) => w.slug));
  for (const solution of LANDING_SOLUTIONS) {
    for (const slug of solution.relatedWorkflowSlugs) {
      assert.ok(realSlugs.has(slug), `${solution.slug} references unknown workflow '${slug}'`);
    }
  }
});

test("every solution has at least 3 approach items, each tied to real capability copy", () => {
  for (const solution of LANDING_SOLUTIONS) {
    assert.ok(solution.approach.length >= 3, `${solution.slug} needs at least 3 approach items`);
    for (const item of solution.approach) {
      assert.ok(item.description.length > 40, `${solution.slug}'s "${item.title}" description is too short/generic`);
    }
  }
});

test("every solution has a before/after narrative and at least 2 FAQs", () => {
  for (const solution of LANDING_SOLUTIONS) {
    assert.ok(solution.before.length > 20, `${solution.slug} needs a real 'before' narrative`);
    assert.ok(solution.after.length > 20, `${solution.slug} needs a real 'after' narrative`);
    assert.ok(solution.faqs.length >= 2, `${solution.slug} needs at least 2 FAQs`);
  }
});

test("no solution content contains a banned overclaiming or placeholder phrase", () => {
  for (const solution of LANDING_SOLUTIONS) {
    const haystack = JSON.stringify(solution);
    for (const pattern of BANNED_PHRASES) {
      assert.ok(!pattern.test(haystack), `${solution.slug} contains a banned phrase matching ${pattern}`);
    }
  }
});

test("problemStatement and directDefinition-equivalent copy are not duplicated across solutions", () => {
  const problems = LANDING_SOLUTIONS.map((s) => s.problemStatement);
  assert.equal(new Set(problems).size, 5, "problem statements must be unique per solution");
});

test("each solution page's problemStatement is textually distinct from its paired platform page's directDefinition (differentiation guard)", () => {
  const platformBySlug = new Map([
    [PRODUCT_OVERVIEW_PAGE.slug, PRODUCT_OVERVIEW_PAGE],
    ...PLATFORM_PAGES.map((p) => [p.slug, p]),
  ]);
  for (const solution of LANDING_SOLUTIONS) {
    const platformPage = platformBySlug.get(solution.relatedPlatformPageSlug);
    assert.ok(platformPage, `${solution.slug}'s paired platform page not found`);
    assert.notEqual(
      solution.problemStatement.toLowerCase(),
      platformPage.directDefinition.toLowerCase(),
      `${solution.slug}'s problemStatement must not restate its paired platform page's directDefinition verbatim`,
    );
  }
});

test("getSolution returns null for an unknown slug instead of throwing", () => {
  assert.equal(getSolution("not-a-real-slug"), null);
});
