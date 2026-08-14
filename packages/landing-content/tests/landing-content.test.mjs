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
  COLOR_TOKENS,
  SEMANTIC_BACKGROUND,
  SEMANTIC_TEXT,
  SEMANTIC_BORDER,
  SEMANTIC_STATE,
  SEMANTIC_PRODUCT,
  HOMEPAGE_SECTIONS,
  HERO,
  CONNECTED_SYSTEM_SECTION,
  MODULE_ARCHITECTURE_SECTION,
  FLAGSHIP_WORKFLOW_SECTION,
} from "../src/index.js";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

test("every semantic token resolves to a valid hex colour", () => {
  for (const group of [SEMANTIC_BACKGROUND, SEMANTIC_TEXT, SEMANTIC_BORDER, SEMANTIC_STATE, SEMANTIC_PRODUCT]) {
    for (const [key, value] of Object.entries(group)) {
      assert.match(value, HEX_COLOR, `token "${key}" is not a valid hex colour: "${value}"`);
    }
  }
});

test("semantic tokens only reuse COLOR_TOKENS values or a documented extension colour", () => {
  const baseValues = new Set(Object.values(COLOR_TOKENS));
  // A small number of extension colours (soft/strong state variants, disabled grey) are
  // allowed without a COLOR_TOKENS entry of their own — they are not brand accents.
  const allowedExtensions = new Set([
    "#98a2b3",
    "#eef1f4",
    "#eaf8ef",
    "#fef3e2",
    "#fdeded",
    "#e5f6fa",
    "#f2f4f7",
  ]);
  for (const group of [SEMANTIC_BACKGROUND, SEMANTIC_TEXT, SEMANTIC_BORDER, SEMANTIC_STATE, SEMANTIC_PRODUCT]) {
    for (const [key, value] of Object.entries(group)) {
      assert.ok(
        baseValues.has(value) || allowedExtensions.has(value.toLowerCase()),
        `token "${key}" ("${value}") is a new raw colour outside COLOR_TOKENS and the documented extension list`,
      );
    }
  }
});

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

test("all 12 released modules have distinct accent colours", () => {
  const accents = LANDING_MODULES.map((module) => module.accentColor.hex.toLowerCase());
  assert.equal(new Set(accents).size, LANDING_MODULES.length);
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

test("HOMEPAGE_SECTIONS has exactly 12 sections, each with a unique id, heading, and analyticsId", () => {
  assert.equal(HOMEPAGE_SECTIONS.length, 12);
  const ids = HOMEPAGE_SECTIONS.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length, "a homepage section id is duplicated");
  const analyticsIds = HOMEPAGE_SECTIONS.map((section) => section.analyticsId);
  assert.equal(new Set(analyticsIds).size, analyticsIds.length, "a homepage section analyticsId is duplicated");
  for (const section of HOMEPAGE_SECTIONS) {
    assert.ok(section.heading && section.heading.length > 0, `section "${section.id}" has no heading`);
  }
});

test("hero and final CTA use the approved primary CTA destination", () => {
  assert.equal(HERO.primaryCta.href, "/book-demo");
  assert.equal(HERO.primaryCta.label, "Book a Demo");
});

test("connected-system steps reference only real module keys", () => {
  const validKeys = new Set(LANDING_MODULES.map((module) => module.key));
  for (const step of CONNECTED_SYSTEM_SECTION.steps) {
    assert.ok(validKeys.has(step.module), `connected-system step "${step.label}" references unknown module "${step.module}"`);
  }
});

test("module architecture group summaries match real nav groups exactly", () => {
  const navGroupKeys = MODULE_NAV_GROUPS.map((group) => group.key).sort();
  const summaryKeys = MODULE_ARCHITECTURE_SECTION.groupSummaries.map((summary) => summary.groupKey).sort();
  assert.deepEqual(summaryKeys, navGroupKeys);
});

test("flagship workflow references a real workflow slug", () => {
  const validSlugs = new Set(LANDING_WORKFLOWS.map((workflow) => workflow.slug));
  assert.ok(validSlugs.has(FLAGSHIP_WORKFLOW_SECTION.workflowSlug));
});

test("no homepage section copy uses a banned overclaiming phrase", () => {
  const banned = ["seamless", "revolutioni", "game-chang", "transform overnight", "all-in-one"];
  const haystack = JSON.stringify(HOMEPAGE_SECTIONS).toLowerCase();
  for (const phrase of banned) {
    assert.ok(!haystack.includes(phrase), `homepage content uses banned phrase "${phrase}" per positioning-and-messaging.md copy rules`);
  }
});
