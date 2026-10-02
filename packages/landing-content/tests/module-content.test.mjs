import assert from "node:assert/strict";
import test from "node:test";
import {
  ROUTED_WORKFLOW_SLUGS,
  LANDING_MODULES,
  LANDING_WORKFLOWS,
  CAPABILITY_GROUPS,
  LAUNCH_CAPABILITIES,
  getLaunchCapabilitiesForOwner,
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

test("every module has at least 3 capability groups, each listing approved launch capabilities", () => {
  for (const module of LANDING_MODULES) {
    assert.ok(module.capabilityGroups.length >= 3, `${module.key} has fewer than 3 capability groups`);
    for (const group of module.capabilityGroups) {
      assert.ok(group.capabilityIds.length > 0, `${module.key}'s group ${group.id} has no capabilities listed`);
      assert.equal(group.capabilities.length, group.capabilityIds.length, `${module.key}'s group ${group.id} capability names must be derived from its IDs`);
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

test("each module's capability groups list exactly that module's approved launch capabilities, each once", () => {
  for (const module of LANDING_MODULES) {
    const grouped = module.capabilityGroups.flatMap((group) => group.capabilityIds);
    const approved = getLaunchCapabilitiesForOwner(module.key).map((capability) => capability.id);
    assert.equal(new Set(grouped).size, grouped.length, `${module.key} lists a capability in more than one group`);
    assert.deepEqual([...grouped].sort(), [...approved].sort(), `${module.key}'s capability groups must cover exactly its approved launch capabilities`);
  }
});

test("no duplicate capability group IDs, and every group has a resolvable public page", () => {
  const ids = CAPABILITY_GROUPS.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length, "capability group IDs must be unique");
  for (const group of CAPABILITY_GROUPS) {
    assert.ok(group.publicPage.startsWith("/"), `${group.id} has a malformed publicPage`);
    assert.ok(group.moduleId || group.platformArea, `${group.id} has neither a moduleId nor a platformArea`);
  }
});

test("capability groups across modules and the Shared Platform cover all approved launch capabilities exactly once", () => {
  const grouped = CAPABILITY_GROUPS.flatMap((group) => group.capabilityIds);
  assert.equal(new Set(grouped).size, grouped.length, "a launch capability appears in more than one group");
  assert.deepEqual([...grouped].sort(), LAUNCH_CAPABILITIES.map((capability) => capability.id).sort());
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
  "/workflows",
  ...ROUTED_WORKFLOW_SLUGS.map((slug) => `/workflows/${slug}`),
]);

function isResolvableHref(href) {
  if (KNOWN_ROUTES.has(href)) return true;
  // The assisted-evaluation (specialist) entry point.
  if (href === "/book-demo?intent=specialist") return true;
  // /book-demo accepts a validated ?module= query param (see app/book-demo/page.tsx).
  if (/^\/book-demo\?module=[a-z-]+$/.test(href)) {
    const key = href.split("=")[1];
    return LANDING_MODULES.some((m) => m.key === key);
  }
  return false;
}

test("every href in the platform, product-overview and modules-index content resolves to a real route", () => {
  const hrefs = (value) => (value && typeof value === "object" ? Object.entries(value).flatMap(([key, child]) => (key === "href" && typeof child === "string" ? [child] : hrefs(child))) : []);
  for (const page of [PRODUCT_OVERVIEW_PAGE, MODULES_INDEX_PAGE, ...PLATFORM_PAGES]) {
    const found = hrefs(page);
    assert.ok(found.length > 0, `${page.slug} has no calls to action`);
    for (const href of found) assert.ok(isResolvableHref(href), `${page.slug} links to '${href}', which does not resolve to a known route`);
  }
});
