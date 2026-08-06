import assert from "node:assert/strict";
import test from "node:test";
import { RELEASED_MODULE_KEYS } from "@vercentlabs/shared-types";
import {
  LANDING_MODULES,
  getLandingModule,
  getModulesByNavGroup,
  LANDING_WORKFLOWS,
  getWorkflowsForModule,
  LANDING_ICPS,
  getIcp,
  MODULE_NAV_GROUPS,
  CTAS,
} from "../src/index.js";

test("every released ERP module has a landing enrichment entry", () => {
  assert.equal(LANDING_MODULES.length, RELEASED_MODULE_KEYS.length);
  for (const key of RELEASED_MODULE_KEYS) {
    const module = getLandingModule(key);
    assert.ok(module, `missing landing enrichment for module "${key}"`);
    assert.ok(module.navGroup, `module "${key}" is missing a navGroup`);
    assert.ok(module.accentColor?.hex, `module "${key}" is missing an accent color`);
    assert.equal(typeof module.accentColor.sourcedFromProduct, "boolean");
  }
});

test("modules.js never overrides the canonical catalog name/description", () => {
  for (const module of LANDING_MODULES) {
    const canonical = getLandingModule(module.key);
    assert.equal(module.name, canonical.name);
    assert.equal(module.description, canonical.description);
  }
});

test("every nav group references only real module keys", () => {
  const validKeys = new Set(LANDING_MODULES.map((module) => module.key));
  for (const group of MODULE_NAV_GROUPS) {
    for (const key of group.moduleKeys) {
      assert.ok(validKeys.has(key), `nav group "${group.key}" references unknown module "${key}"`);
    }
  }
});

test("every module belongs to exactly one nav group", () => {
  const grouped = MODULE_NAV_GROUPS.flatMap((group) => group.moduleKeys);
  assert.equal(new Set(grouped).size, grouped.length, "a module key appears in more than one nav group");
  assert.equal(grouped.length, LANDING_MODULES.length, "not every module is assigned to a nav group");
});

test("workflows reference only real module keys and have a summary", () => {
  const validKeys = new Set(LANDING_MODULES.map((module) => module.key));
  assert.ok(LANDING_WORKFLOWS.length >= 12, "fewer than 12 documented cross-module workflows");
  for (const workflow of LANDING_WORKFLOWS) {
    assert.ok(workflow.modules.length >= 2, `workflow "${workflow.slug}" should span at least 2 modules`);
    for (const key of workflow.modules) {
      assert.ok(validKeys.has(key), `workflow "${workflow.slug}" references unknown module "${key}"`);
    }
    assert.ok(workflow.summary.length > 0);
  }
});

test("getWorkflowsForModule returns only workflows that include that module", () => {
  const results = getWorkflowsForModule("accounting");
  assert.ok(results.length > 0);
  for (const workflow of results) {
    assert.ok(workflow.modules.includes("accounting"));
  }
});

test("every ICP references real module keys and a real workflow slug", () => {
  const validKeys = new Set(LANDING_MODULES.map((module) => module.key));
  const validWorkflows = new Set(LANDING_WORKFLOWS.map((workflow) => workflow.slug));
  assert.equal(LANDING_ICPS.length, 3, "the brief caps primary ICPs at 4 and phase 1 selected exactly 3");
  for (const icp of LANDING_ICPS) {
    for (const key of icp.primaryModules) {
      assert.ok(validKeys.has(key), `ICP "${icp.slug}" references unknown module "${key}"`);
    }
    assert.ok(validWorkflows.has(icp.primaryWorkflow), `ICP "${icp.slug}" references unknown workflow "${icp.primaryWorkflow}"`);
  }
});

test("getIcp returns null for an unknown slug instead of throwing", () => {
  assert.equal(getIcp("not-a-real-icp"), null);
});

test("getModulesByNavGroup matches the group definition", () => {
  const revenueModules = getModulesByNavGroup("revenue").map((module) => module.key).sort();
  const expected = MODULE_NAV_GROUPS.find((group) => group.key === "revenue").moduleKeys.slice().sort();
  assert.deepEqual(revenueModules, expected);
});

test("no CTA uses a banned generic label", () => {
  const banned = ["learn more", "get started", "click here"];
  for (const cta of Object.values(CTAS)) {
    assert.ok(
      !banned.includes(cta.label.toLowerCase()),
      `CTA label "${cta.label}" uses a banned generic phrase per conversion-architecture.md`,
    );
  }
});
