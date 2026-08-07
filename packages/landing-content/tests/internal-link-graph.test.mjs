import assert from "node:assert/strict";
import test from "node:test";
import {
  LANDING_MODULES,
  LANDING_INDUSTRIES,
  LANDING_SOLUTIONS,
  ROUTED_WORKFLOW_SLUGS,
  getWorkflow,
  getIndustriesForModule,
  getSolutionsForModule,
  getWorkflowsForModule,
  RESOURCE_GUIDES,
  STANDALONE_GLOSSARY_SLUGS,
  GLOSSARY_TERMS,
  getResourceGuidesForModule,
  VERCENTLABS_VS_ODOO,
} from "../src/index.js";

/**
 * Content-layer half of the internal-link graph guarantee (the route/page
 * layer's real rendered links are covered by apps/landing/tests/e2e/
 * phase5-routes.spec.ts). Bidirectionality here is structural, not
 * data-duplicated: a module is "linked from" an industry/solution/workflow
 * purely because that entity's real content (moduleStack/relatedModuleKeys/
 * modules) references it — getIndustriesForModule()/getSolutionsForModule()/
 * getWorkflowsForModule() derive the reverse direction live, so there's no
 * second copy of the relationship that could drift out of sync.
 */

test("every industry/solution/routed-workflow has at least one real outbound module link (no dead-end pages)", () => {
  for (const industry of LANDING_INDUSTRIES) {
    assert.ok(industry.moduleStack.length > 0, `${industry.slug} has no outbound module links`);
  }
  for (const solution of LANDING_SOLUTIONS) {
    assert.ok(solution.relatedModuleKeys.length > 0, `${solution.slug} has no outbound module links`);
  }
  for (const slug of ROUTED_WORKFLOW_SLUGS) {
    const workflow = getWorkflow(slug);
    assert.ok(workflow.modules.length > 0, `${slug} has no outbound module links`);
  }
});

test("every module is referenced by at least one industry, solution, or workflow (no isolated module page)", () => {
  const orphans = [];
  for (const landingModule of LANDING_MODULES) {
    const inIndustry = getIndustriesForModule(landingModule.key).length > 0;
    const inSolution = getSolutionsForModule(landingModule.key).length > 0;
    const inWorkflow = getWorkflowsForModule(landingModule.key).length > 0;
    if (!inIndustry && !inSolution && !inWorkflow) orphans.push(landingModule.key);
  }
  assert.deepEqual(orphans, [], `Module(s) with zero cross-tier inbound links: ${orphans.join(", ")}`);
});

test("no industry links to every module (avoids an accidental all-to-all mesh)", () => {
  const totalModules = LANDING_MODULES.length;
  for (const industry of LANDING_INDUSTRIES) {
    assert.ok(
      industry.moduleStack.length < totalModules,
      `${industry.slug} links to all ${totalModules} modules — likely an unintentional all-to-all link, not a curated stack`,
    );
  }
});

test("no solution links to every module (avoids an accidental all-to-all mesh)", () => {
  const totalModules = LANDING_MODULES.length;
  for (const solution of LANDING_SOLUTIONS) {
    assert.ok(
      solution.relatedModuleKeys.length < totalModules,
      `${solution.slug} links to all ${totalModules} modules — likely an unintentional all-to-all link, not a curated set`,
    );
  }
});

test("every module referenced by an industry's moduleStack is reciprocally discoverable via getIndustriesForModule", () => {
  for (const industry of LANDING_INDUSTRIES) {
    for (const entry of industry.moduleStack) {
      const reciprocal = getIndustriesForModule(entry.moduleKey);
      assert.ok(
        reciprocal.some((i) => i.slug === industry.slug),
        `${entry.moduleKey} does not reciprocally list ${industry.slug} via getIndustriesForModule`,
      );
    }
  }
});

// --- Phase 6: resources, glossary, and comparison additions ---

test("every resource guide has at least one real outbound link (module, workflow, or related guide)", () => {
  for (const guide of RESOURCE_GUIDES) {
    const outboundCount = guide.relatedModuleKeys.length + guide.relatedWorkflowSlugs.length + guide.relatedResourceSlugs.length;
    assert.ok(outboundCount > 0, `${guide.slug} has no outbound content links at all`);
  }
});

test("every standalone glossary entry has at least one real outbound link (module or related term)", () => {
  for (const entry of GLOSSARY_TERMS.filter((t) => t.standalone)) {
    const outboundCount = entry.relatedModules.length + entry.relatedTerms.length + (entry.relatedWorkflow ? 1 : 0);
    assert.ok(outboundCount > 0, `${entry.term} has no outbound content links at all`);
  }
});

test("no module page's resource-guide backlink is forced onto every module (avoids an all-to-all mesh)", () => {
  const totalModules = LANDING_MODULES.length;
  for (const landingModule of LANDING_MODULES) {
    const guides = getResourceGuidesForModule(landingModule.key);
    // Threshold is 3, not the rendered link count (module pages only ever show 1
    // backlink — see app/modules/[slug]/page.tsx's .slice(0, 1)) — this guards the
    // underlying content-layer relationship data against an all-to-all mesh, with
    // room for a genuinely central module (e.g. stock) to have real, distinct
    // relationships to multiple guides without being flagged as padding.
    assert.ok(guides.length <= 3, `${landingModule.key} links to ${guides.length} resource guides — likely over-linked rather than a curated, genuine relationship`);
  }
  // At least one module should genuinely have zero related guides — confirms
  // relatedModuleKeys reflects real relevance, not every guide force-tagging every module.
  const modulesWithNoGuide = LANDING_MODULES.filter((m) => getResourceGuidesForModule(m.key).length === 0);
  assert.ok(modulesWithNoGuide.length > 0, "every module has at least one related guide — check relatedModuleKeys isn't over-applied");
  assert.ok(modulesWithNoGuide.length < totalModules, "no module has a related guide at all — check relatedModuleKeys isn't empty everywhere");
});

test("the comparison page has real outbound links to modules/resources it references", () => {
  // The comparison page's related-pages section links to the buying guide and
  // requirements checklist (see app/compare/vercentlabs-vs-odoo/page.tsx) —
  // verify those targets are real, existing resource guides, not dead slugs.
  const referencedSlugs = ["erp-buying-guide", "erp-requirements-checklist"];
  const realSlugs = new Set(RESOURCE_GUIDES.map((g) => g.slug));
  for (const slug of referencedSlugs) {
    assert.ok(realSlugs.has(slug), `/compare/${VERCENTLABS_VS_ODOO.slug} links to unknown resource guide '${slug}'`);
  }
});

test("no glossary standalone slug collides with a resource guide slug (avoids an ambiguous route)", () => {
  const guideSlugs = new Set(RESOURCE_GUIDES.map((g) => g.slug));
  for (const slug of STANDALONE_GLOSSARY_SLUGS) {
    assert.ok(!guideSlugs.has(slug), `glossary slug '${slug}' collides with a resource guide slug`);
  }
});
