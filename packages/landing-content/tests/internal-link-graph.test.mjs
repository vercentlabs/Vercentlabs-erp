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
