import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import test from "node:test";
import {
  CONNECTED_WORKFLOWS_SECTION,
  CTAS,
  HERO,
  HOMEPAGE_SECTIONS,
  LANDING_MODULES,
  MODULE_ARCHITECTURE_SECTION,
  MODULE_NAV_GROUPS,
  POSITIONING,
} from "@vercentlabs/landing-content";
import { APPROVED_SCREENSHOTS, getApprovedScreenshot } from "../lib/product/screenshots.ts";

// Semantic contracts for the flagship homepage. These test what the page
// promises — headline, CTAs, module coverage, crawlable workflows, truthful
// product evidence — not its CSS.
const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");
const homeFiles = readdirSync(new URL("../components/home/", import.meta.url)).filter((name) => name.endsWith(".tsx"));
const homeSource = homeFiles.map((name) => read(`components/home/${name}`)).join("\n");
const visualSources = [
  homeSource,
  read("components/product/connected-erp-map.tsx"),
  read("components/workflows/workflow-swimlane.tsx"),
  read("components/workflows/workflow-tabs.tsx"),
  read("components/modules/module-group-columns.tsx"),
  read("components/platform/shared-platform-band.tsx"),
  read("components/conversion/evaluation-paths.tsx"),
].join("\n");

test("hero: the exact master headline is the homepage's only h1, with the CTA contract", () => {
  assert.equal(HERO.heading, "One ERP. Your entire business.");
  assert.equal(HERO.heading, POSITIONING.heroHeadline);
  const hero = read("components/home/home-hero.tsx");
  assert.match(hero, /<Heading level="h1"/);
  assert.match(hero, /HERO\.heading/);
  const h1s = homeSource.match(/<Heading level="(h1|display)"[^>]*>/g) ?? [];
  assert.equal(h1s.filter((tag) => !tag.includes('as="h2"')).length, 1, "exactly one h1 on the homepage");
  assert.deepEqual([HERO.primaryCta.label, HERO.primaryCta.href], [CTAS.primary.label, CTAS.primary.href]);
  assert.deepEqual([HERO.secondaryCta.label, HERO.secondaryCta.href], [CTAS.talkToSpecialist.label, CTAS.talkToSpecialist.href]);
  assert.match(hero, /primary=\{\{ href: HERO\.primaryCta\.href, event: HERO\.primaryCta\.analyticsId/);
  assert.match(hero, /secondary=\{\{ href: HERO\.secondaryCta\.href, event: HERO\.secondaryCta\.analyticsId/);
});

test("modules: the explorer and the connected-ERP map cover all 12 modules exactly once, by public name", () => {
  const navKeys = MODULE_NAV_GROUPS.flatMap((group) => group.moduleKeys);
  assert.equal(navKeys.length, LANDING_MODULES.length);
  assert.deepEqual([...navKeys].sort(), LANDING_MODULES.map((landingModule) => landingModule.key).sort());
  for (const file of ["components/modules/module-group-columns.tsx", "components/product/connected-erp-map.tsx"]) {
    const source = read(file);
    assert.match(source, /MODULE_NAV_GROUPS/, `${file} derives its modules from the nav groups`);
    assert.match(source, /href=\{`\/modules\/\$\{landingModule\.key\}`\}/, `${file} links each module page`);
    assert.match(source, /landingModule\.displayName/, `${file} uses the public display name`);
  }
  assert.equal(MODULE_ARCHITECTURE_SECTION.platform.href, "/product/platform");
  assert.match(read("components/home/home-modules.tsx"), /<ModuleGroupColumns /);
  assert.match(read("components/home/home-modules.tsx"), /<SharedPlatformBand /);
  assert.match(read("components/platform/shared-platform-band.tsx"), /href=\{platform\.href\}/, "the Shared Platform row links /product/platform");
});

test("no homepage visual hard-codes module keys or capability counts", () => {
  const moduleKeyLiteral = new RegExp(`["'](${LANDING_MODULES.map((landingModule) => landingModule.key).join("|")})["']`);
  assert.doesNotMatch(visualSources, moduleKeyLiteral, "module keys come from content, not JSX");
  assert.doesNotMatch(visualSources, /\b(222|176|46)\b/, "capability counts are derived, never typed");
});

test("workflows: every homepage workflow panel is server-rendered behind accessible tabs", () => {
  const tabs = read("components/workflows/workflow-tabs.tsx");
  for (const pattern of [/role="tablist"/, /role="tab"/, /role="tabpanel"/, /aria-selected=/, /aria-controls=/, /aria-labelledby=/, /"ArrowRight"/, /"ArrowLeft"/, /"Home"/, /"End"/]) {
    assert.match(tabs, pattern);
  }
  // Every panel is always in the HTML; inactive ones are only `hidden`.
  assert.match(tabs, /panels\.map\(/);
  assert.match(tabs, /hidden=\{index !== active\}/);
  assert.match(tabs, /useState\(0\)/, "the first workflow is the server-rendered default");
  // The interaction event fires on a real selection, never on mount or view.
  assert.doesNotMatch(tabs, /useEffect/);
  assert.match(tabs, /function select\([\s\S]*?track\(interactionEvent/);
  assert.equal(CONNECTED_WORKFLOWS_SECTION.interactionAnalyticsId, "workflow_interaction");
  assert.notEqual(CONNECTED_WORKFLOWS_SECTION.analyticsId, "workflow_interaction", "workflow_interaction is no longer a view event");
});

test("product evidence: stale screenshots cannot render; approval requires a current capture", () => {
  const UI_REBUILD = "2026-09-14";
  for (const screenshot of APPROVED_SCREENSHOTS) {
    if (!screenshot.approvedForMarketing) {
      assert.equal(getApprovedScreenshot(screenshot.id), null, `${screenshot.id} is unapproved and must not render`);
      continue;
    }
    assert.ok(screenshot.capturedAt && screenshot.capturedAt >= UI_REBUILD, `${screenshot.id} is approved but was not captured from the current ERP UI`);
    assert.ok(screenshot.alt.length > 40 && !/^screenshot of/i.test(screenshot.alt), `${screenshot.id} needs descriptive alt text`);
  }
  const evidence = read("components/product/product-evidence.tsx");
  assert.match(evidence, /if \(!screenshotId \|\| !getApprovedScreenshot\(screenshotId\)\) return <>\{fallback\}<\/>;/, "falls back when no approved capture exists");
  assert.match(read("components/home/home-hero.tsx"), /fallback=\{<ConnectedErpMap \/>\}/);
});

test("accessibility: decorative connectors stay out of the accessibility tree; relationships are stated in text", () => {
  const map = read("components/product/connected-erp-map.tsx");
  assert.match(map, /<span className="vl-map-link" data-side=\{column\.side\} aria-hidden="true" \/>/);
  assert.match(map, /<figcaption id="connected-erp-map-caption"/, "the traced route is stated in text");
  const lane = read("components/workflows/workflow-swimlane.tsx");
  assert.match(lane, /<div className="vl-lane-grid hidden lg:grid" aria-hidden="true">/, "the lane diagram is decorative; the step list carries the content");
  assert.match(lane, /Handoff: \{handoff\.name\} to \{lane\.name\}/, "module handoffs are stated in text");
});

test("no prohibited marketing on the homepage", () => {
  const haystack = `${JSON.stringify(HOMEPAGE_SECTIONS)}\n${visualSources}\n${read("app/page.tsx")}`;
  for (const pattern of [/free trial/i, /30-day trial/i, /sandbox/i, /AI-powered/i, /native offline/i, /\b991\b/, /\b897\b/]) {
    assert.doesNotMatch(haystack, pattern);
  }
});
