import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CTAS, LANDING_INDUSTRIES, LANDING_MODULES, PRIMARY_NAV, getRoutedWorkflows } from "@vercentlabs/landing-content";

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(path.join(appRoot, relative), "utf8");

/** True when a pathname is served by a page in app/ — a static folder or a single [param] segment. */
function routeExists(href) {
  const [pathname] = href.split("?");
  let directory = path.join(appRoot, "app");
  for (const segment of pathname.split("/").filter(Boolean)) {
    const exact = path.join(directory, segment);
    if (existsSync(exact) && statSync(exact).isDirectory()) {
      directory = exact;
      continue;
    }
    const dynamic = readdirSync(directory).find((entry) => /^\[[^.\]]+\]$/.test(entry));
    if (!dynamic) return false;
    directory = path.join(directory, dynamic);
  }
  return existsSync(path.join(directory, "page.tsx"));
}

test("every header and product-menu destination is a real page", () => {
  const hrefs = PRIMARY_NAV.flatMap((item) => [item.href, ...(item.children ?? []).map((child) => child.href)]);
  for (const href of hrefs) assert.ok(routeExists(href), `navigation links to ${href}, which has no page`);
});

test("the product mega menu only lists real pages", () => {
  const source = read("components/navigation/product-mega-menu.tsx");
  const hrefs = [...source.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
  assert.ok(hrefs.length > 0);
  for (const href of hrefs) assert.ok(routeExists(href), `product menu links to ${href}, which has no page`);
});

test("footer destinations — modules, workflows, industries, solutions, resources — are real pages", () => {
  const source = read("components/layout/footer.tsx");
  const staticHrefs = [...source.matchAll(/href: "([^"]+)"/g)].map((match) => match[1]);
  const generated = [
    ...LANDING_MODULES.map((module) => `/modules/${module.key}`),
    ...getRoutedWorkflows().map((workflow) => `/workflows/${workflow.slug}`),
    ...LANDING_INDUSTRIES.map((industry) => `/industries/${industry.slug}`),
  ];
  for (const href of [...staticHrefs, ...generated, "/privacy", "/terms"]) assert.ok(routeExists(href), `footer links to ${href}, which has no page`);
});

test("every global CTA resolves, and the primary action is not the demo form", () => {
  for (const cta of Object.values(CTAS)) assert.ok(routeExists(cta.href), `${cta.label} links to ${cta.href}, which has no page`);
  assert.notEqual(CTAS.primary.href.split("?")[0], "/book-demo");
});

test("the header renders CTAs from the contract, with Industries not in the primary navigation", () => {
  const header = read("components/navigation/header.tsx");
  assert.ok(!/Industries/.test(header), "Industries must not be hard-coded into the header");
  assert.ok(!PRIMARY_NAV.some((item) => item.label === "Industries"));
  assert.ok(header.includes("CTAS.primary.label") && header.includes("CTAS.talkToSpecialist.label"));
  assert.ok(!/>\s*Book a Demo\s*</.test(header), "the header must not hard-code Book a Demo");
});

function sourceFiles(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const fullPath = path.join(directory, entry);
    if (statSync(fullPath).isDirectory()) return sourceFiles(fullPath);
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

test("no app source promises a trial, sandbox, or product tour", () => {
  const violations = [];
  for (const file of ["app", "components", "lib"].flatMap((directory) => sourceFiles(path.join(appRoot, directory)))) {
    const source = readFileSync(file, "utf8");
    for (const pattern of [/30-day (free )?trial/i, /free trial/i, /start (your )?trial/i, /sandbox/i, /product tour/i, /interactive demo/i]) {
      if (pattern.test(source)) violations.push(`${path.relative(appRoot, file)} matches ${pattern}`);
    }
  }
  assert.deepEqual(violations, []);
});

test("global brand surfaces no longer carry the retired master positioning", () => {
  for (const relative of ["lib/metadata.ts", "app/opengraph-image.tsx", "app/manifest.ts", "components/layout/footer.tsx", "app/page.tsx", "components/home/home-hero.tsx", "components/home/home-final-cta.tsx", "app/llms.txt/route.ts"]) {
    const source = read(relative);
    for (const pattern of [/outgrew spreadsheets/i, /manufacturers and distributors/i, /operational ERP/i, /multi-location businesses/i]) {
      assert.ok(!pattern.test(source), `${relative} still matches ${pattern}`);
    }
  }
});
