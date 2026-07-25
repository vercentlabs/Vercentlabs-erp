import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("homepage uses the Controlled Horizon product-led composition", () => {
  const hero = read("src/components/home/hero-section.tsx");
  const sections = read("src/components/home/product-marketing-sections.tsx");
  const canvas = read("src/components/home/landing-product-canvas.tsx");

  assert.match(hero, /Released CRM early access/);
  assert.match(hero, /Roadmap modules/);
  assert.match(hero, /value: "11"/);
  assert.match(canvas, /Pipeline command view/);
  assert.match(canvas, /Control signal/);
  assert.match(sections, /Governance is product behaviour/);
  assert.match(sections, /Eleven modules are planned next/);
  assert.doesNotMatch(sections, /customer logos|trusted by thousands/i);
});

test("homepage motion is browser-native and reduced-motion safe", () => {
  const reveal = read("src/components/ui/reveal-on-scroll.tsx");
  const css = read("src/app/globals.css");

  assert.match(reveal, /IntersectionObserver/);
  assert.match(reveal, /prefers-reduced-motion: reduce/);
  assert.match(css, /CONTROLLED_HORIZON_HOME_START/);
  assert.match(css, /\[data-reveal\]\[data-visible="true"\]/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("premium redesign does not add a heavy animation dependency", () => {
  const packageJson = read("package.json");
  assert.doesNotMatch(packageJson, /framer-motion|gsap|lottie/i);
});
