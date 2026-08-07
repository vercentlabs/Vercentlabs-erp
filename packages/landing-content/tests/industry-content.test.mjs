import assert from "node:assert/strict";
import test from "node:test";
import { LANDING_INDUSTRIES, LANDING_MODULES, LANDING_ICPS, ROUTED_WORKFLOW_SLUGS, BUYER_ROLES, getIndustry, getIndustriesForModule } from "../src/index.js";

const BANNED_PHRASES = [/coming soon/i, /lorem ipsum/i, /placeholder/i, /\btbd\b/i, /\btodo\b/i, /best[- ]in[- ]class/i, /world[- ]class/i, /industry[- ]leading/i, /#1\b/, /number one/i];

test("exactly 4 industries exist, per the approved Phase 5 IA amendment", () => {
  assert.equal(LANDING_INDUSTRIES.length, 4);
});

test("every industry has a unique slug, searchIntent, and metaDescription", () => {
  const slugs = LANDING_INDUSTRIES.map((i) => i.slug);
  const intents = LANDING_INDUSTRIES.map((i) => i.searchIntent);
  const metas = LANDING_INDUSTRIES.map((i) => i.metaDescription);
  assert.equal(new Set(slugs).size, 4, "industry slugs must be unique");
  assert.equal(new Set(intents).size, 4, "search intents must be unique");
  assert.equal(new Set(metas).size, 4, "meta descriptions must be unique");
});

test("every industry references a real ICP slug", () => {
  const realIcpSlugs = new Set(LANDING_ICPS.map((icp) => icp.slug));
  for (const industry of LANDING_INDUSTRIES) {
    assert.ok(realIcpSlugs.has(industry.icpSlug), `${industry.slug} references unknown ICP '${industry.icpSlug}'`);
  }
});

test("every ICP's industrySlugs resolve to real, routed industry pages (no stale route landmine)", () => {
  const realIndustrySlugs = new Set(LANDING_INDUSTRIES.map((i) => i.slug));
  for (const icp of LANDING_ICPS) {
    assert.ok(icp.industrySlugs.length >= 1, `ICP '${icp.slug}' has no industrySlugs`);
    for (const slug of icp.industrySlugs) {
      assert.ok(realIndustrySlugs.has(slug), `ICP '${icp.slug}' references unknown industry route '${slug}'`);
    }
  }
});

test("distribution and retail intentionally share one ICP, per the documented split reasoning", () => {
  const distribution = getIndustry("distribution");
  const retail = getIndustry("retail");
  assert.ok(distribution && retail, "both distribution and retail industries must exist");
  assert.equal(distribution.icpSlug, retail.icpSlug, "distribution and retail should share icpSlug 'distribution-retail'");
  assert.notEqual(distribution.operatingModel, retail.operatingModel, "sharing an ICP must not mean identical operating-model copy");
  assert.notEqual(JSON.stringify(distribution.moduleStack), JSON.stringify(retail.moduleStack), "distribution and retail must have distinct module-stack emphasis");
});

test("every industry has a real moduleStack referencing only real module keys, each with a specific role", () => {
  const realKeys = new Set(LANDING_MODULES.map((m) => m.key));
  for (const industry of LANDING_INDUSTRIES) {
    assert.ok(industry.moduleStack.length >= 3, `${industry.slug} needs at least 3 modules in its stack`);
    for (const entry of industry.moduleStack) {
      assert.ok(realKeys.has(entry.moduleKey), `${industry.slug} references unknown module '${entry.moduleKey}'`);
      assert.ok(entry.role && entry.role.length > 20, `${industry.slug}'s ${entry.moduleKey} role text is too generic/short`);
    }
  }
});

test("every industry's primaryWorkflowSlug (if set) resolves to one of the 6 routed workflows", () => {
  for (const industry of LANDING_INDUSTRIES) {
    if (!industry.primaryWorkflowSlug) continue;
    assert.ok(
      ROUTED_WORKFLOW_SLUGS.includes(industry.primaryWorkflowSlug),
      `${industry.slug}'s primaryWorkflowSlug '${industry.primaryWorkflowSlug}' does not resolve to a routed workflow page`,
    );
  }
});

test("every industry's buyerRoleSlugs resolve to real buyer roles", () => {
  const realSlugs = new Set(BUYER_ROLES.map((r) => r.slug));
  for (const industry of LANDING_INDUSTRIES) {
    assert.ok(industry.buyerRoleSlugs.length >= 1, `${industry.slug} needs at least 1 buyer role`);
    for (const slug of industry.buyerRoleSlugs) {
      assert.ok(realSlugs.has(slug), `${industry.slug} references unknown buyer role '${slug}'`);
    }
  }
});

test("every industry has at least 3 evidence highlights, 3 challenges, and 4-6 FAQs (seo-aeo-geo-architecture.md's documented floor for module/industry pages)", () => {
  for (const industry of LANDING_INDUSTRIES) {
    assert.ok(industry.evidenceHighlights.length >= 3, `${industry.slug} needs at least 3 evidence highlights`);
    assert.ok(industry.challenges.length >= 3, `${industry.slug} needs at least 3 challenges`);
    assert.ok(industry.faqs.length >= 4 && industry.faqs.length <= 6, `${industry.slug} needs 4-6 FAQs, has ${industry.faqs.length}`);
  }
});

test("no industry content contains a banned overclaiming or placeholder phrase", () => {
  for (const industry of LANDING_INDUSTRIES) {
    const haystack = JSON.stringify(industry);
    for (const pattern of BANNED_PHRASES) {
      assert.ok(!pattern.test(haystack), `${industry.slug} contains a banned phrase matching ${pattern}`);
    }
  }
});

test("operatingModel and directDefinition are not duplicated across industries", () => {
  const models = LANDING_INDUSTRIES.map((i) => i.operatingModel);
  const defs = LANDING_INDUSTRIES.map((i) => i.directDefinition);
  assert.equal(new Set(models).size, 4, "operating models must be unique per industry");
  assert.equal(new Set(defs).size, 4, "direct definitions must be unique per industry");
});

test("getIndustriesForModule returns only industries whose moduleStack includes that module", () => {
  const result = getIndustriesForModule("manufacturing");
  assert.ok(result.length >= 1);
  for (const industry of result) {
    assert.ok(industry.moduleStack.some((entry) => entry.moduleKey === "manufacturing"));
  }
});
