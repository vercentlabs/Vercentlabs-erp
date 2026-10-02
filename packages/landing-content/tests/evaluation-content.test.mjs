import assert from "node:assert/strict";
import test from "node:test";
import {
  LANDING_MODULES,
  LAUNCH_CAPABILITIES,
  LAUNCH_CAPABILITY_COUNTS,
  MODULES_INDEX_PAGE,
  MODULE_DETAIL_PAGE,
  PRODUCT_OVERVIEW_PAGE,
  ROUTED_WORKFLOW_SLUGS,
  SHARED_PLATFORM_KEY,
  WORKFLOWS_INDEX_PAGE,
  WORKFLOW_DETAIL_PAGE,
  getLaunchCapability,
  getRoutedWorkflowsForModule,
  getWorkflow,
  getWorkflowCapabilityGroups,
  getWorkflowModulePath,
} from "../src/index.js";

// Contracts behind the Product → Module → Workflow evaluation pages.

const moduleKeys = new Set(LANDING_MODULES.map((landingModule) => landingModule.key));

test("every module page presents each of its approved capabilities exactly once, and no other module's", () => {
  for (const landingModule of LANDING_MODULES) {
    const ids = landingModule.capabilityGroups.flatMap((group) => group.capabilityIds);
    assert.equal(new Set(ids).size, ids.length, `${landingModule.key} lists a capability twice`);
    for (const id of ids) assert.equal(getLaunchCapability(id)?.moduleKey, landingModule.key, `${landingModule.key} shows ${id}, which belongs elsewhere`);
    const registered = LAUNCH_CAPABILITIES.filter((capability) => capability.moduleKey === landingModule.key).map((capability) => capability.id).sort();
    assert.deepEqual([...ids].sort(), registered, `${landingModule.key}'s capability groups must cover its register entries exactly`);
    assert.equal(ids.length, LAUNCH_CAPABILITY_COUNTS[landingModule.key]);
    const names = landingModule.capabilityGroups.flatMap((group) => group.capabilities);
    assert.deepEqual(names, ids.map((id) => getLaunchCapability(id).name), `${landingModule.key} capability names come from the register`);
  }
});

test("each module's related workflows are routed workflows that include it", () => {
  for (const landingModule of LANDING_MODULES) {
    for (const workflow of getRoutedWorkflowsForModule(landingModule.key)) {
      assert.ok(ROUTED_WORKFLOW_SLUGS.includes(workflow.slug));
      assert.ok(workflow.sequence.some((step) => step.moduleKey === landingModule.key));
    }
  }
  assert.equal(getRoutedWorkflowsForModule("crm")[0].slug, "lead-to-cash");
  assert.equal(getRoutedWorkflowsForModule("procurement")[0].slug, "procure-to-pay");
  assert.equal(getRoutedWorkflowsForModule("manufacturing")[0].slug, "plan-to-production");
});

test("every routed workflow's steps, modules and capabilities are valid and traceable", () => {
  for (const slug of ROUTED_WORKFLOW_SLUGS) {
    const workflow = getWorkflow(slug);
    for (const step of workflow.sequence) assert.ok(moduleKeys.has(step.moduleKey), `${slug} step ${step.step} has unknown module ${step.moduleKey}`);
    for (const key of workflow.modules) assert.ok(moduleKeys.has(key), `${slug} lists unknown module ${key}`);
    for (const id of workflow.capabilityIds) assert.ok(getLaunchCapability(id), `${slug} references unknown capability ${id}`);

    const groups = getWorkflowCapabilityGroups(slug);
    assert.equal(groups.flatMap((group) => group.capabilities).length, workflow.capabilityIds.length, `${slug}: every capability is shown once`);
    for (const group of groups) assert.ok(group.ownerKey === SHARED_PLATFORM_KEY || moduleKeys.has(group.ownerKey));

    const path = getWorkflowModulePath(slug);
    assert.deepEqual(path.flatMap((segment) => segment.steps), workflow.sequence.map((step) => step.step), `${slug}: the module path keeps every step in order`);
    for (let index = 1; index < path.length; index += 1) assert.notEqual(path[index].moduleKey, path[index - 1].moduleKey, `${slug}: consecutive segments are distinct handoffs`);
  }
});

test("product overview figures are derived, and its evaluation copy promises nothing that doesn't exist", () => {
  const facts = Object.fromEntries(PRODUCT_OVERVIEW_PAGE.facts.map((fact) => [fact.label, fact.value]));
  assert.equal(facts["business modules"], String(LANDING_MODULES.length));
  assert.equal(facts["documented workflows"], String(ROUTED_WORKFLOW_SLUGS.length));
  assert.equal(facts["Shared Platform capabilities"], String(LAUNCH_CAPABILITY_COUNTS[SHARED_PLATFORM_KEY]));
  assert.equal(PRODUCT_OVERVIEW_PAGE.primaryCta.href, "/modules");
  assert.equal(PRODUCT_OVERVIEW_PAGE.secondaryCta.href, "/workflows");
  assert.equal(PRODUCT_OVERVIEW_PAGE.platformSection.cta.href, "/product/platform");

  const copy = JSON.stringify([PRODUCT_OVERVIEW_PAGE, MODULES_INDEX_PAGE, WORKFLOWS_INDEX_PAGE, MODULE_DETAIL_PAGE, WORKFLOW_DETAIL_PAGE, LANDING_MODULES.map((landingModule) => landingModule.faqs)]);
  for (const pattern of [/free trial/i, /30-day/i, /sandbox/i, /pricing/i, /AI-powered/i, /native offline/i, /\b991\b/, /\b897\b/]) {
    assert.doesNotMatch(copy, pattern);
  }
});
