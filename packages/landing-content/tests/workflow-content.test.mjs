import assert from "node:assert/strict";
import test from "node:test";
import { LANDING_WORKFLOWS, ROUTED_WORKFLOW_SLUGS, LANDING_MODULES, getWorkflow, getRoutedWorkflows } from "../src/index.js";

const BANNED_PHRASES = [/coming soon/i, /lorem ipsum/i, /placeholder/i, /\btbd\b/i, /\btodo\b/i, /best[- ]in[- ]class/i, /world[- ]class/i, /industry[- ]leading/i, /#1\b/, /number one/i];

test("exactly 6 workflows are routed this phase", () => {
  assert.equal(ROUTED_WORKFLOW_SLUGS.length, 6);
});

test("every routed workflow slug resolves to a real LANDING_WORKFLOWS entry", () => {
  for (const slug of ROUTED_WORKFLOW_SLUGS) {
    assert.ok(getWorkflow(slug), `Routed workflow slug '${slug}' has no matching LANDING_WORKFLOWS entry`);
  }
});

test("order-to-fulfilment and hire-to-payroll are new, real entries with a modules array", () => {
  const orderToFulfilment = getWorkflow("order-to-fulfilment");
  const hireToPayroll = getWorkflow("hire-to-payroll");
  assert.ok(orderToFulfilment, "order-to-fulfilment must exist");
  assert.ok(hireToPayroll, "hire-to-payroll must exist");
  assert.ok(orderToFulfilment.modules.length >= 2);
  assert.ok(hireToPayroll.modules.length >= 2);
});

test("every routed workflow has a directDefinition distinct from its summary (no duplicate hero/DirectDefinition text)", () => {
  for (const workflow of getRoutedWorkflows()) {
    assert.ok(workflow.directDefinition && workflow.directDefinition.length > 40, `${workflow.slug} needs a real directDefinition`);
    assert.notEqual(
      workflow.directDefinition.trim().toLowerCase(),
      workflow.summary.trim().toLowerCase(),
      `${workflow.slug}'s directDefinition must not repeat summary verbatim (the hero and DirectDefinition sections render different fields)`,
    );
  }
});

test("every routed workflow has the full page-level structure: trigger, participants, sequence, automatedActions, approvals, exceptions, visibility, businessValue, faqs, screenshotId", () => {
  const routed = getRoutedWorkflows();
  assert.equal(routed.length, 6);
  for (const workflow of routed) {
    assert.ok(workflow.trigger && workflow.trigger.length > 10, `${workflow.slug} needs a real trigger`);
    assert.ok(workflow.participants && workflow.participants.length >= 2, `${workflow.slug} needs at least 2 participants`);
    assert.ok(workflow.sequence && workflow.sequence.length >= 3, `${workflow.slug} needs at least 3 sequence steps`);
    assert.ok(workflow.automatedActions && workflow.automatedActions.length >= 1, `${workflow.slug} needs at least 1 automated action`);
    assert.ok(Array.isArray(workflow.approvals), `${workflow.slug}'s approvals must be an array`);
    assert.ok(Array.isArray(workflow.exceptions), `${workflow.slug}'s exceptions must be an array`);
    assert.ok(workflow.visibility && workflow.visibility.length >= 1, `${workflow.slug} needs at least 1 visibility item`);
    assert.ok(workflow.businessValue && workflow.businessValue.length >= 2, `${workflow.slug} needs at least 2 business-value statements`);
    assert.ok(workflow.faqs && workflow.faqs.length >= 2, `${workflow.slug} needs at least 2 FAQs`);
    assert.ok(workflow.screenshotId, `${workflow.slug} needs a screenshotId`);
  }
});

test("every sequence step's moduleKey resolves to a real module and modules referenced in sequence appear in the workflow's own modules array", () => {
  const realKeys = new Set(LANDING_MODULES.map((m) => m.key));
  for (const workflow of getRoutedWorkflows()) {
    const moduleSet = new Set(workflow.modules);
    for (const step of workflow.sequence) {
      assert.ok(realKeys.has(step.moduleKey), `${workflow.slug}'s sequence step '${step.step}' references unknown module '${step.moduleKey}'`);
      assert.ok(moduleSet.has(step.moduleKey), `${workflow.slug}'s sequence step '${step.step}' references module '${step.moduleKey}' not listed in the workflow's own modules array`);
    }
  }
});

test("unrouted workflows keep their minimal shape (no page-level fields leaking in)", () => {
  const unrouted = LANDING_WORKFLOWS.filter((w) => !ROUTED_WORKFLOW_SLUGS.includes(w.slug));
  assert.ok(unrouted.length >= 6, "expected at least 6 unrouted workflows");
  for (const workflow of unrouted) {
    assert.equal(workflow.trigger, undefined, `${workflow.slug} is unrouted and should not have page-level fields`);
    assert.equal(workflow.sequence, undefined, `${workflow.slug} is unrouted and should not have page-level fields`);
  }
});

test("routed workflows have no banned overclaiming or placeholder phrase", () => {
  for (const workflow of getRoutedWorkflows()) {
    const haystack = JSON.stringify(workflow);
    for (const pattern of BANNED_PHRASES) {
      assert.ok(!pattern.test(haystack), `${workflow.slug} contains a banned phrase matching ${pattern}`);
    }
  }
});

test("routed workflow summaries and FAQ questions are not duplicated across workflows", () => {
  const routed = getRoutedWorkflows();
  const summaries = routed.map((w) => w.summary);
  assert.equal(new Set(summaries).size, routed.length, "workflow summaries must be unique");
  const allQuestions = routed.flatMap((w) => w.faqs.map((f) => f.question));
  assert.equal(new Set(allQuestions).size, allQuestions.length, "FAQ questions must not repeat across routed workflows");
});

test("no two routed workflows repeat the same sequence-step detail text verbatim (Phase 6 lead-to-cash/order-to-fulfilment overlap fix)", () => {
  const seen = new Map();
  for (const workflow of getRoutedWorkflows()) {
    for (const step of workflow.sequence) {
      const key = step.detail.trim().toLowerCase();
      const priorSlug = seen.get(key);
      assert.ok(
        !priorSlug,
        `${workflow.slug}'s sequence step '${step.step}' repeats ${priorSlug}'s step detail verbatim — cross-reference the owning workflow instead of restating it (see docs/landing-redesign/phase-6/decision-log.md item 5)`,
      );
      seen.set(key, workflow.slug);
    }
  }
});
