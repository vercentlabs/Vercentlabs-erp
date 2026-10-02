import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";
import { LANDING_MODULES, PRODUCT_OVERVIEW_PAGE, ROUTED_WORKFLOW_SLUGS } from "@vercentlabs/landing-content";
import { APPROVED_SCREENSHOTS, getApprovedScreenshot, getApprovedScreenshotsForWorkflow } from "../lib/product/screenshots.ts";
import { CAPTURE_VIEWPORT, MARKETING_CAPTURE_PLAN } from "../scripts/marketing-capture-plan.mjs";

// Guardrails for the Product → Module → Workflow evaluation pages and the
// product-evidence pipeline behind them. Static checks only: no database or
// running ERP is needed.
const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const publicFile = (src) => new URL(`../public${src}`, import.meta.url);
const moduleKeys = new Set(LANDING_MODULES.map((landingModule) => landingModule.key));
const UI_REBUILD = "2026-09-14";

function pngSize(src) {
  const bytes = readFileSync(publicFile(src));
  assert.equal(bytes.toString("ascii", 1, 4), "PNG", `${src} is not a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("screenshot safety: retired captures of the replaced UI can never render", () => {
  const retired = APPROVED_SCREENSHOTS.filter((screenshot) => screenshot.retired);
  assert.equal(retired.length, 14);
  for (const screenshot of retired) {
    assert.equal(screenshot.approvedForMarketing, false, `${screenshot.id} is retired and must stay unapproved`);
    assert.equal(getApprovedScreenshot(screenshot.id), null);
  }
  const retiredSources = new Set(retired.map((screenshot) => screenshot.src));
  for (const screenshot of APPROVED_SCREENSHOTS.filter((entry) => !entry.retired)) {
    assert.ok(!retiredSources.has(screenshot.src), `${screenshot.id} reuses a retired file path`);
  }
});

test("screenshot safety: every approved screenshot is a current, complete, inspected capture", () => {
  const approved = APPROVED_SCREENSHOTS.filter((screenshot) => screenshot.approvedForMarketing);
  assert.ok(approved.length > 0);
  for (const screenshot of approved) {
    assert.ok(!screenshot.retired, `${screenshot.id} is retired`);
    assert.ok(screenshot.capturedAt && screenshot.capturedAt >= UI_REBUILD, `${screenshot.id} was not captured from the current ERP UI`);
    assert.ok(existsSync(publicFile(screenshot.src)), `${screenshot.id}: ${screenshot.src} is missing`);
    assert.deepEqual(pngSize(screenshot.src), { width: screenshot.width, height: screenshot.height }, `${screenshot.id}: registered dimensions must match the file`);
    assert.ok(moduleKeys.has(screenshot.module), `${screenshot.id}: unknown module ${screenshot.module}`);
    for (const slug of screenshot.workflows ?? []) assert.ok(ROUTED_WORKFLOW_SLUGS.includes(slug), `${screenshot.id}: unknown workflow ${slug}`);
    assert.ok(screenshot.alt.length > 40 && !/^screenshot of/i.test(screenshot.alt), `${screenshot.id} needs descriptive alt text`);
    assert.ok(screenshot.caption, `${screenshot.id} needs a caption`);
    const planned = MARKETING_CAPTURE_PLAN.find((entry) => entry.id === screenshot.id);
    assert.ok(planned, `${screenshot.id} must come from the capture plan`);
    assert.equal(planned.module, screenshot.module);
  }
});

test("capture plan: unique ids, real modules, current routes, crops inside the viewport", () => {
  const ids = MARKETING_CAPTURE_PLAN.map((entry) => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of MARKETING_CAPTURE_PLAN) {
    assert.ok(moduleKeys.has(entry.module), `${entry.id}: unknown module`);
    assert.match(entry.route, /^\/[a-z]/);
    assert.ok(entry.ready && entry.evidence, `${entry.id} needs ready text and an evidence description`);
    assert.ok(!APPROVED_SCREENSHOTS.some((screenshot) => screenshot.retired && screenshot.id === entry.id), `${entry.id} must not reuse a retired id`);
    if (entry.clip) {
      assert.ok(entry.clipReason, `${entry.id}: a crop must record why`);
      assert.ok(entry.clip.x + entry.clip.width <= CAPTURE_VIEWPORT.width && entry.clip.y + entry.clip.height <= CAPTURE_VIEWPORT.height, `${entry.id}: crop outside the viewport`);
    }
  }
  const capture = read("scripts/capture-marketing-screenshots.mjs");
  assert.match(capture, /redirected to/, "a moved route fails instead of silently capturing another screen");
  assert.match(capture, /host !== "localhost" && host !== "127\.0\.0\.1"/);
});

test("marketing seed: local-only, synthetic identities, no real-world contact data", () => {
  const seed = readFileSync(new URL("../../../scripts/qa/seed-marketing-demo-org.mjs", import.meta.url), "utf8");
  assert.match(seed, /NODE_ENV === "production"/);
  assert.match(seed, /Refusing to run against a non-local database/);
  const emails = [...seed.matchAll(/[\w.${}-]+@[\w.-]+\.[a-z]+/gi)].map((match) => match[0]);
  assert.ok(emails.length > 0);
  for (const email of emails) assert.match(email, /@([\w-]+\.)?example\.com$/, `${email} must use the reserved example.com domain`);
  assert.doesNotMatch(seed, /\b(mobile|phone)\s*:\s*["'`]\+?\d/, "no phone numbers are seeded");
  assert.doesNotMatch(seed, /vercentlabs\.com/i, "the vendor's own domain is never used for demo identities");
});

test("module pages: one hero h1, register-driven capabilities, evidence through ProductEvidence with a truthful fallback", () => {
  const page = read("app/modules/[slug]/page.tsx");
  assert.match(page, /LANDING_MODULES\.map\(\(landingModule\) => \(\{ slug: landingModule\.key \}\)\)/);
  assert.match(page, /<CapabilityGrid groups=\{landingModule\.capabilityGroups\} \/>/);
  assert.match(page, /<ProductEvidence screenshotId=\{primaryShot\}[^>]*fallback=\{<ModuleProcess landingModule=\{landingModule\} \/>\}/);
  assert.match(page, /getRoutedWorkflowsForModule\(landingModule\.key\)/);
  assert.doesNotMatch(page, /level="h1"/, "the hero component owns the page's only h1");
  assert.equal((read("components/modules/module-hero.tsx").match(/level="h1"/g) ?? []).length, 1);
  for (const landingModule of LANDING_MODULES) {
    for (const id of [landingModule.screenshots.primary, landingModule.screenshots.secondary].filter(Boolean)) {
      const screenshot = getApprovedScreenshot(id);
      assert.ok(screenshot, `${landingModule.key} references ${id}, which is not approved`);
      assert.equal(screenshot.module, landingModule.key);
    }
  }
});

test("workflow pages: server-rendered sequence, register capabilities, evidence matched by workflow metadata", () => {
  const page = read("app/workflows/[slug]/page.tsx");
  assert.match(page, /<WorkflowSwimlane steps=\{workflow\.sequence\} stepHeading="h3" \/>/, "step names nest directly under the section h2");
  assert.match(page, /<WorkflowCapabilities slug=\{workflow\.slug\} \/>/);
  assert.match(page, /getApprovedScreenshotsForWorkflow\(workflow\.slug\)/);
  for (const file of ["components/workflows/workflow-swimlane.tsx", "components/workflows/workflow-capabilities.tsx", "components/workflows/workflow-module-path.tsx"]) {
    assert.doesNotMatch(read(file), /^["']use client["']/m, `${file} stays a Server Component`);
  }
  for (const slug of ROUTED_WORKFLOW_SLUGS) {
    for (const screenshot of getApprovedScreenshotsForWorkflow(slug)) assert.ok(screenshot.workflows.includes(slug));
  }
});

test("product page: all 12 modules from content, exploration links, approved evidence only", () => {
  const page = read("app/product/page.tsx");
  assert.match(page, /MODULE_NAV_GROUPS\.flatMap/);
  assert.match(page, /<SystemArchitecture \/>/);
  assert.match(page, /<EvaluationPaths locationPrefix="product_evaluation" omitHref=\{page\.slug\} \/>/, "the product page never links an evaluation path back to itself");
  assert.doesNotMatch(page, new RegExp(`["'](${[...moduleKeys].join("|")})["']`), "module keys come from content");
  for (const id of [PRODUCT_OVERVIEW_PAGE.evidence.primaryScreenshotId, PRODUCT_OVERVIEW_PAGE.evidence.secondaryScreenshotId]) {
    assert.ok(getApprovedScreenshot(id), `${id} must be an approved screenshot`);
  }
});
