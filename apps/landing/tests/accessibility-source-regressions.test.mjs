import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

test("landing a11y: glossary index uses list semantics, never orphan dt/dd nodes", () => {
  const source = read("app/resources/glossary/page.tsx");
  assert.match(source, /<ul className="mt-10 border-y/);
  assert.match(source, /<li key=\{entry\.term\}/);
  assert.match(source, /<h3 className=/);
  assert.match(source, /<p className="max-w-\[76ch\]/);
  assert.doesNotMatch(source, /<dt\b|<dd\b/);
});

test("landing a11y: homepage description-list source order is term then description", () => {
  const source = read("app/page.tsx");
  const term = source.indexOf('<dt className="vl-index order-2 mt-3">');
  const description = source.indexOf('<dd className="tabular-data order-1');
  assert.ok(term >= 0 && description > term);
  assert.doesNotMatch(source, /text-white\/42/);
});

test("landing a11y: border colors are not used as visible section-number text on representative index pages", () => {
  for (const path of ["app/product/page.tsx", "app/modules/page.tsx", "app/resources/page.tsx"]) {
    const source = read(path);
    assert.doesNotMatch(source, /font-mono text-4xl[^\n]*text-\(--color-border-strong\)/, path);
  }
});

test("landing a11y: arbitrary module accent colors stay decorative, not small textual indexes", () => {
  const platformHero = read("components/platform/platform-hero.tsx");
  const product = read("app/product/page.tsx");
  const industryStack = read("components/industries/recommended-module-stack.tsx");
  assert.doesNotMatch(platformHero, /className="vl-index" style=\{\{ color: moduleInfo\.accentColor\.hex \}\}/);
  assert.doesNotMatch(product, /className="vl-index" style=\{\{ color: moduleInfo\.accentColor\.hex \}\}/);
  assert.doesNotMatch(industryStack, /className="vl-index" style=\{\{ color: landingModule\.accentColor\.hex \}\}/);
});

test("landing a11y: axe scans wait for transient entrance animations to settle", () => {
  const source = read("tests/e2e/accessibility.spec.ts");
  const navigation = source.indexOf('await page.goto(route, { waitUntil: "networkidle" });');
  const animationWait = source.indexOf("document.getAnimations()");
  const axeScan = source.indexOf("new AxeBuilder({ page })");
  assert.ok(navigation >= 0 && animationWait > navigation && axeScan > animationWait);
  assert.match(source, /Promise\.allSettled\(active\.map\(\(animation\) => animation\.finished\)\)/);
  assert.match(source, /animation\.playState === "running"/);
  assert.match(source, /requestAnimationFrame/);
  assert.doesNotMatch(source, /animation\.playState === "pending"/);
});
