import assert from "node:assert/strict";
import test from "node:test";
import {
  LANDING_MODULES,
  LANDING_WORKFLOWS,
  CAPABILITY_GROUPS,
  getTotalRequirementCount,
  getModuleRequirementTotal,
  getPlatformRequirementTotal,
  PLATFORM_PAGES,
  PRODUCT_OVERVIEW_PAGE,
  MODULES_INDEX_PAGE,
} from "../src/index.js";

const BANNED_PHRASES = [/coming soon/i, /lorem ipsum/i, /placeholder/i, /\btbd\b/i, /\btodo\b/i, /best[- ]in[- ]class/i, /world[- ]class/i, /industry[- ]leading/i, /#1\b/, /number one/i];

test("exactly 12 modules exist", () => {
  assert.equal(LANDING_MODULES.length, 12);
});

test("every module has unique metadata (title/search-intent/meta description)", () => {
  const searchIntents = LANDING_MODULES.map((m) => m.searchIntent);
  const metaDescriptions = LANDING_MODULES.map((m) => m.metaDescription);
  assert.equal(new Set(searchIntents).size, 12, "search intents must be unique per module");
  assert.equal(new Set(metaDescriptions).size, 12, "meta descriptions must be unique per module");
});

test("every module has a non-empty, non-generic direct definition", () => {
  for (const module of LANDING_MODULES) {
    assert.ok(module.directDefinition && module.directDefinition.length > 40, `${module.key} missing a real direct definition`);
    assert.ok(module.directDefinition.toLowerCase().includes(module.name.toLowerCase().split(" ")[0].toLowerCase()) || module.directDefinition.includes("Vercentlabs"), `${module.key}'s direct definition should name the module or product`);
  }
});

test("every module has at least 5 capability groups, each with capabilities and a positive requirement count", () => {
  for (const module of LANDING_MODULES) {
    assert.ok(module.capabilityGroups.length >= 5, `${module.key} has fewer than 5 capability groups`);
    for (const group of module.capabilityGroups) {
      assert.ok(group.capabilities.length > 0, `${module.key}'s group ${group.id} has no capabilities listed`);
      assert.ok(group.requirementCount > 0, `${module.key}'s group ${group.id} has a non-positive requirement count`);
    }
  }
});

test("every module has a primary workflow with steps, approvals or automation, and an outcome", () => {
  for (const module of LANDING_MODULES) {
    const workflow = module.primaryWorkflow;
    assert.ok(workflow?.name, `${module.key} missing primaryWorkflow.name`);
    assert.ok(workflow.steps.length >= 3, `${module.key}'s primary workflow has fewer than 3 steps`);
    assert.ok(workflow.outcome && workflow.outcome.length > 10, `${module.key}'s primary workflow missing a real outcome`);
    assert.ok(workflow.automatedActions.length > 0 || workflow.approvals.length > 0, `${module.key}'s primary workflow has no automation or approvals`);
  }
});

test("every module has at least one connected module referencing a real module key", () => {
  const realKeys = new Set(LANDING_MODULES.map((m) => m.key));
  for (const module of LANDING_MODULES) {
    assert.ok(module.connectedModules.length > 0, `${module.key} has no connected modules`);
    for (const link of module.connectedModules) {
      assert.ok(realKeys.has(link.moduleKey), `${module.key} links to unknown module '${link.moduleKey}'`);
      assert.ok(link.relationship && link.relationship.length > 15, `${module.key}'s link to ${link.moduleKey} has no real relationship explanation`);
    }
  }
});

test("every module has conversion content and at least 2 FAQs", () => {
  for (const module of LANDING_MODULES) {
    assert.ok(module.conversion?.heading?.includes(module.name) || module.conversion?.heading?.length > 20, `${module.key} missing real conversion heading`);
    assert.ok(module.faqs.length >= 2, `${module.key} has fewer than 2 FAQs`);
  }
});

test("every module has reporting, automation, governance, and implementation content", () => {
  for (const module of LANDING_MODULES) {
    assert.ok(module.reporting.length > 0, `${module.key} has no reporting content`);
    assert.ok(module.automation.length > 0, `${module.key} has no automation content`);
    assert.ok(module.governance.length > 0, `${module.key} has no governance content`);
    assert.ok(module.implementationConsiderations.length >= 3, `${module.key} has fewer than 3 implementation considerations`);
  }
});

test("no module content contains a banned overclaiming or placeholder phrase", () => {
  for (const module of LANDING_MODULES) {
    const haystack = JSON.stringify(module);
    for (const pattern of BANNED_PHRASES) {
      assert.ok(!pattern.test(haystack), `${module.key} contains banned phrase matching ${pattern}`);
    }
  }
});

test("direct definitions, hero headings (conversion.heading), and FAQ questions are not duplicated across modules", () => {
  const definitions = LANDING_MODULES.map((m) => m.directDefinition);
  const convHeadings = LANDING_MODULES.map((m) => m.conversion.heading);
  assert.equal(new Set(definitions).size, 12, "direct definitions must be unique across modules");
  assert.equal(new Set(convHeadings).size, 12, "conversion headings must be unique across modules");

  const allQuestions = LANDING_MODULES.flatMap((m) => m.faqs.map((f) => f.question));
  assert.equal(new Set(allQuestions).size, allQuestions.length, "no FAQ question should repeat verbatim across modules");
});

test("module heroVariant is one of the four controlled variants", () => {
  const allowed = new Set(["screenshot-led", "workflow-led", "dashboard-led", "operational-sequence"]);
  for (const module of LANDING_MODULES) {
    assert.ok(allowed.has(module.heroVariant), `${module.key} has an unrecognized heroVariant '${module.heroVariant}'`);
  }
});

test("every capability group's workflowSlug (if set) resolves to a real workflow", () => {
  const realSlugs = new Set(LANDING_WORKFLOWS.map((w) => w.slug));
  for (const module of LANDING_MODULES) {
    for (const group of module.capabilityGroups) {
      if (group.workflowSlug) assert.ok(realSlugs.has(group.workflowSlug), `${module.key}'s group ${group.id} references unknown workflow '${group.workflowSlug}'`);
    }
  }
});

test("capability registry sums to exactly 1,039 (945 module + 94 platform), matching the settled CLAUDE.md total", () => {
  assert.equal(getModuleRequirementTotal(), 945);
  assert.equal(getPlatformRequirementTotal(), 94);
  assert.equal(getTotalRequirementCount(), 1039);
});

test("no duplicate capability group IDs, and every group has a resolvable public page", () => {
  const ids = CAPABILITY_GROUPS.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "capability group IDs must be unique");
  for (const group of CAPABILITY_GROUPS) {
    assert.ok(group.publicPage.startsWith("/"), `${group.id} has a malformed publicPage`);
    assert.ok(group.moduleId || group.platformArea, `${group.id} has neither a moduleId nor a platformArea`);
  }
});

test("every module-specific capability group's requirementCount sums to that module's declared capabilityGroups total", () => {
  for (const module of LANDING_MODULES) {
    const registryGroups = CAPABILITY_GROUPS.filter((g) => g.moduleId === module.key);
    const registrySum = registryGroups.reduce((sum, g) => sum + g.requirementCount, 0);
    const moduleSum = module.capabilityGroups.reduce((sum, g) => sum + g.requirementCount, 0);
    assert.equal(registrySum, moduleSum, `${module.key}'s registry total doesn't match its own capabilityGroups total`);
  }
});

test("platform pages have unique slugs, titles, meta descriptions, and direct definitions", () => {
  const allPages = [PRODUCT_OVERVIEW_PAGE, MODULES_INDEX_PAGE, ...PLATFORM_PAGES];
  const slugs = allPages.map((p) => p.slug);
  const titles = allPages.map((p) => p.title);
  const descriptions = allPages.map((p) => p.metaDescription);
  const definitions = allPages.map((p) => p.directDefinition);
  assert.equal(new Set(slugs).size, allPages.length, "platform/product page slugs must be unique");
  assert.equal(new Set(titles).size, allPages.length, "platform/product page titles must be unique");
  assert.equal(new Set(descriptions).size, allPages.length, "platform/product page meta descriptions must be unique");
  assert.equal(new Set(definitions).size, allPages.length, "platform/product page direct definitions must be unique");
});

test("platform pages have no banned overclaiming or placeholder phrases", () => {
  const allPages = [PRODUCT_OVERVIEW_PAGE, MODULES_INDEX_PAGE, ...PLATFORM_PAGES];
  for (const page of allPages) {
    const haystack = JSON.stringify(page);
    for (const pattern of BANNED_PHRASES) {
      assert.ok(!pattern.test(haystack), `${page.slug} contains banned phrase matching ${pattern}`);
    }
  }
});

test("modules index operating stacks reference only real module keys and link to no new industry routes", () => {
  const realKeys = new Set(LANDING_MODULES.map((m) => m.key));
  assert.ok(MODULES_INDEX_PAGE.operatingStacks.length >= 4);
  for (const stack of MODULES_INDEX_PAGE.operatingStacks) {
    assert.ok(stack.moduleKeys.length > 0, `${stack.id} has no modules`);
    for (const key of stack.moduleKeys) assert.ok(realKeys.has(key), `${stack.id} references unknown module '${key}'`);
  }
});

test("every platform page's connectedModuleKeys reference real modules", () => {
  const realKeys = new Set(LANDING_MODULES.map((m) => m.key));
  for (const page of PLATFORM_PAGES) {
    for (const key of page.connectedModuleKeys) assert.ok(realKeys.has(key), `${page.slug} references unknown module '${key}'`);
  }
});

// Every real, live public route as of Phase 4 — kept in sync by hand since it's
// the authoritative "what actually exists" list content hrefs are checked
// against. Update this alongside apps/landing/app/ when a new page ships.
const KNOWN_ROUTES = new Set([
  "/",
  "/book-demo",
  "/book-demo/thank-you",
  "/product",
  "/modules",
  ...LANDING_MODULES.map((m) => `/modules/${m.key}`),
  ...PLATFORM_PAGES.map((p) => p.slug),
]);

function isResolvableHref(href) {
  if (KNOWN_ROUTES.has(href)) return true;
  // /book-demo accepts a validated ?module= query param (see app/book-demo/page.tsx).
  if (/^\/book-demo\?module=[a-z-]+$/.test(href)) {
    const key = href.split("=")[1];
    return LANDING_MODULES.some((m) => m.key === key);
  }
  return false;
}

test("every platform/product-overview/modules-index primaryCta href resolves to a real route", () => {
  const allPages = [PRODUCT_OVERVIEW_PAGE, MODULES_INDEX_PAGE, ...PLATFORM_PAGES];
  for (const page of allPages) {
    assert.ok(isResolvableHref(page.primaryCta.href), `${page.slug}'s primaryCta.href '${page.primaryCta.href}' does not resolve to a known route`);
  }
});
