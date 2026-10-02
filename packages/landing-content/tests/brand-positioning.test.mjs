import assert from "node:assert/strict";
import test from "node:test";
import * as content from "../src/index.js";

const {
  BREADTH_SECTION,
  BUYER_QUESTIONS_SECTION,
  CTAS,
  FINAL_CTA_SECTION,
  HERO,
  HOMEPAGE_METADATA,
  HOMEPAGE_SECTIONS,
  LANDING_MODULES,
  LAUNCH_CAPABILITY_TOTAL,
  MODULE_ARCHITECTURE_SECTION,
  MODULE_NAV_GROUPS,
  POSITIONING,
  PRIMARY_NAV,
  PROBLEM_SECTION,
  SITE_IDENTITY,
} = content;

test("the master brand contract is exact", () => {
  assert.equal(SITE_IDENTITY.name, "Vercentlabs");
  assert.equal(SITE_IDENTITY.productName, "Vercentlabs ERP");
  assert.equal(SITE_IDENTITY.category, "ERP / Business Management Software");
  assert.equal(POSITIONING.heroHeadline, "One ERP. Your entire business.");
  assert.equal(POSITIONING.masterPromise, "Run your entire business in one ERP.");
  assert.equal(POSITIONING.problemStatement, "Stop running one business through disconnected systems.");
  assert.equal(HERO.heading, POSITIONING.heroHeadline);
  assert.equal(PROBLEM_SECTION.heading, POSITIONING.problemStatement);
});

// Brand-level surfaces must be horizontal. Industry and regional context
// belongs on its own pages (industries, solutions, localised capabilities).
const MASTER_SURFACES = { SITE_IDENTITY, POSITIONING, HOMEPAGE_METADATA, HERO, PROBLEM_SECTION, MODULE_ARCHITECTURE_SECTION, BUYER_QUESTIONS_SECTION, FINAL_CTA_SECTION };
const RETIRED_POSITIONING = [
  /outgrew spreadsheets/i,
  /manufacturers and distributors/i,
  /operational ERP/i,
  /multi-location businesses/i,
  /growing businesses/i,
  /\bIndia(n)?\b/i,
  /\bGST\b/,
];

test("brand-level surfaces carry no industry-first, size-first, or India-first positioning", () => {
  const haystack = JSON.stringify(MASTER_SURFACES);
  for (const pattern of RETIRED_POSITIONING) assert.ok(!pattern.test(haystack), `brand-level copy matches retired positioning ${pattern}`);
});

test("the capability count is proof, not the headline — it follows the modules and the workflow", () => {
  assert.ok(!HERO.heading.includes(String(LAUNCH_CAPABILITY_TOTAL)));
  const order = HOMEPAGE_SECTIONS.map((section) => section.id);
  assert.equal(order[0], "hero");
  assert.ok(order.indexOf("breadth") > order.indexOf("modules"), "breadth must come after the modules");
  assert.ok(order.indexOf("breadth") > order.indexOf("connected-workflows"), "breadth must come after the connected workflows");
  assert.ok(BREADTH_SECTION.heading.startsWith(String(LAUNCH_CAPABILITY_TOTAL)), "breadth uses the register-derived total");
});

test("the CTA contract has one entry per role, and the primary action is exploring the ERP", () => {
  assert.deepEqual(Object.keys(CTAS).sort(), ["bookDemo", "primary", "talkToSpecialist"]);
  assert.deepEqual({ ...CTAS.primary }, { label: "Explore the ERP", href: "/product" });
  assert.deepEqual({ ...CTAS.talkToSpecialist }, { label: "Talk to an ERP Specialist", href: "/book-demo?intent=specialist" });
  assert.equal(CTAS.bookDemo.href, "/book-demo");
});

test("no conversion or brand surface promises a trial, sandbox, live demo, or product tour that doesn't exist", () => {
  // Resource guides, glossary, and AEO answers are vendor-neutral education
  // (e.g. "ask every vendor for a live demo"); only their CTAs are in scope.
  const { RESOURCE_GUIDES, GLOSSARY_TERMS, AEO_ANSWERS, ...surfaces } = content;
  const haystack = JSON.stringify({ ...surfaces, resourceConversions: RESOURCE_GUIDES.map((guide) => guide.conversion) });
  for (const pattern of [/30-day/i, /free trial/i, /start (your )?trial/i, /try (it )?free/i, /sandbox/i, /product tour/i, /interactive demo/i, /live demo/i]) {
    assert.ok(!pattern.test(haystack), `public content matches ${pattern}`);
  }
});

test("primary navigation is Product, Modules, Workflows, Resources, Security — industries and solutions are not top-level", () => {
  assert.deepEqual(PRIMARY_NAV.map((item) => item.label), ["Product", "Modules", "Workflows", "Resources", "Security"]);
  const topLevel = PRIMARY_NAV.map((item) => item.href);
  assert.ok(!topLevel.includes("/industries") && !topLevel.includes("/solutions"));
  const productChildren = PRIMARY_NAV.find((item) => item.label === "Product").children.map((child) => child.label);
  for (const label of productChildren) assert.ok(!/tour|demo|sandbox|trial/i.test(label), `product menu item "${label}" names an experience that doesn't exist`);
});

test("all 12 modules are reachable from the module navigation exactly once, under one public label each", () => {
  const navKeys = MODULE_NAV_GROUPS.flatMap((group) => group.moduleKeys);
  assert.deepEqual([...navKeys].sort(), LANDING_MODULES.map((module) => module.key).sort());
  assert.equal(new Set(navKeys).size, navKeys.length);
  assert.deepEqual(
    LANDING_MODULES.map((module) => module.displayName).sort(),
    ["Accounting", "Assets", "CRM", "HR & Payroll", "Inventory", "Manufacturing", "POS", "Procurement", "Projects", "Quality", "Sales", "Support"],
  );
});
