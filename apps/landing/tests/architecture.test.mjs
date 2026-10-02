import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Structural guardrails for the landing app: where homepage markup lives,
// how content is imported, and which conversion components are canonical.
const appRoot = fileURLToPath(new URL("../", import.meta.url));
const read = (relative) => readFileSync(path.join(appRoot, relative), "utf8");

function tsxFiles(relativeDir) {
  const dir = path.join(appRoot, relativeDir);
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(path.join(relativeDir, name));
    return /\.(tsx?|mjs)$/.test(name) ? [path.join(relativeDir, name)] : [];
  });
}

const HOME_SECTION_ORDER = [
  "HomeHero",
  "HomeConnectedErp",
  "HomeProblem",
  "HomeWorkflow",
  "HomeModules",
  "HomePlatform",
  "HomeRoleValue",
  "HomeBreadth",
  "HomeEvaluation",
  "HomeImplementation",
  "HomeSecurity",
  "HomeFaq",
  "HomeFinalCta",
];

test("the homepage composes every home section, in narrative order", () => {
  const page = read("app/page.tsx");
  const barrel = read("components/home/index.ts");
  const exported = [...barrel.matchAll(/export \{ (\w+) \}/g)].map((match) => match[1]);
  assert.deepEqual([...exported].sort(), [...HOME_SECTION_ORDER].sort(), "components/home/index.ts exports exactly the home sections");
  const rendered = [...page.matchAll(/<(Home[A-Z]\w*) \/>/g)].map((match) => match[1]);
  assert.deepEqual(rendered, HOME_SECTION_ORDER);
});

test("app/page.tsx is composition only: no section markup or copy", () => {
  const page = read("app/page.tsx");
  assert.doesNotMatch(page, /<(Section|Container|TrackView|TrackedCtaLink|h[1-6]|p|div)[\s>]/, "section markup belongs in components/home");
  const jsxText = [...page.matchAll(/>([^<>{}]*[A-Za-z][^<>{}]*)</g)].map((match) => match[1].trim()).filter(Boolean);
  assert.deepEqual(jsxText, [], "homepage copy belongs in @vercentlabs/landing-content");
});

test("home sections and conversion components stay Server Components", () => {
  for (const file of [...tsxFiles("components/home"), ...tsxFiles("components/conversion")]) {
    assert.doesNotMatch(read(file), /^["']use client["']/m, `${file} must not be a Client Component`);
  }
});

test("landing content is imported only through the package root", () => {
  for (const file of [...tsxFiles("app"), ...tsxFiles("components"), ...tsxFiles("lib")]) {
    assert.doesNotMatch(read(file), /from ["']@vercentlabs\/landing-content\/[^"']+["']/, `${file} imports a landing-content subpath`);
  }
});

test("conversion CTAs have one implementation each", () => {
  assert.ok(existsSync(path.join(appRoot, "components/conversion/contextual-cta.tsx")));
  assert.ok(existsSync(path.join(appRoot, "components/conversion/cta-pair.tsx")));
  const definitions = [...tsxFiles("components"), ...tsxFiles("app")].filter((file) => /export function (ContextualCta|CtaPair)\b/.test(read(file)));
  assert.deepEqual(definitions.map((file) => file.replaceAll("\\", "/")).sort(), [
    "components/conversion/contextual-cta.tsx",
    "components/conversion/cta-pair.tsx",
  ]);
});
