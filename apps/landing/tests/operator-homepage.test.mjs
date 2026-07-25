import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

const page = read("src/app/page.tsx");
const hero = read("src/components/home/hero-section.tsx");
const sections = read("src/components/home/product-marketing-sections.tsx");
const demo = read("src/components/home/operating-system-demo.tsx");
const reveal = read("src/components/ui/reveal-on-scroll.tsx");
const css = read("src/app/globals.css");
const packageJson = read("package.json");

test("homepage uses the operating-system editorial composition", () => {
  assert.match(page, /AnnouncementBar/);
  assert.match(page, /Header/);
  assert.match(page, /HeroSection/);
  assert.match(page, /ProductMarketingSections/);
  assert.match(page, /SiteFooter/);
  assert.match(hero, /Run the work\./);
  assert.match(hero, /Keep the truth\./);
  assert.match(sections, /Software should make operations legible/);
});

test("homepage stays honest about released and roadmap scope", () => {
  assert.match(hero, /Released CRM early access/);
  assert.match(hero, /label: "Roadmap modules", value: "11"/);
  assert.match(
    sections,
    /Twelve modules\. One is released\. Eleven are roadmap\./,
  );
  assert.match(sections, /isReleasedModule/);
  assert.match(sections, /No invented customers\. No fake metrics/);
});

test("product story is interactive and keyboard-readable", () => {
  assert.match(demo, /role="tablist"/);
  assert.match(demo, /role="tab"/);
  assert.match(demo, /role="tabpanel"/);
  assert.match(demo, /aria-selected/);
  assert.match(demo, /Lead inbox/);
  assert.match(demo, /Pipeline/);
  assert.match(demo, /Approval trail/);
});

test("responsive design uses component and viewport breakpoints", () => {
  assert.match(css, /container-type:\s*inline-size/);
  assert.match(css, /@container \(max-width: 760px\)/);
  assert.match(css, /@media \(max-width: 1120px\)/);
  assert.match(css, /@media \(max-width: 720px\)/);
  assert.match(css, /@media \(max-width: 420px\)/);
  assert.match(css, /min-height:\s*44px/);
});

test("motion is purposeful, lightweight and reduced-motion safe", () => {
  assert.match(reveal, /IntersectionObserver/);
  assert.match(reveal, /element\.dataset\.revealed/);
  assert.doesNotMatch(reveal, /setState|setVisible/);
  assert.match(css, /@keyframes os-panel-enter/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /transform/);
  assert.match(css, /opacity/);
  assert.doesNotMatch(packageJson, /framer-motion|gsap|lottie/i);
});

test("visual system avoids generic AI landing-page effects", () => {
  const redesignedSource = [hero, sections, demo, css].join("\n");
  assert.doesNotMatch(
    redesignedSource,
    /blur-\[|backdrop-blur|floating orb|faux-3d/i,
  );
  assert.match(css, /--os-signal:\s*#d9ff43/);
  assert.match(css, /--os-cobalt:\s*#4353ff/);
  assert.match(css, /border-radius:\s*4px/);
});
