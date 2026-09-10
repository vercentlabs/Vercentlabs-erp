import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = path.resolve(webRoot, "../..");
const readWeb = (file) => fs.readFileSync(path.join(webRoot, file), "utf8");
const readRepo = (file) => fs.readFileSync(path.join(repoRoot, file), "utf8");
const ids = () => Array.from({ length: 30 }, (_, index) => `F${String(index + 1).padStart(3, "0")}`);

function walk(relative, extensions = /\.(?:ts|tsx|js|jsx)$/) {
  const output = [];
  const absolute = path.join(repoRoot, relative);
  if (!fs.existsSync(absolute)) return output;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    const child = path.join(relative, entry.name);
    if (entry.isDirectory()) output.push(...walk(child, extensions));
    else if (extensions.test(entry.name)) output.push(child);
  }
  return output;
}

test("CRM web and mobile map the complete F001-F030 product contract", () => {
  const web = [...readWeb("src/modules/crm/ui/crm-surface-registry.ts").matchAll(/id: "(F\d{3})"/g)].map((match) => match[1]);
  const mobile = [...readRepo("apps/mobile/src/modules/crm/ui/crm-feature-registry.ts").matchAll(/id: "(F\d{3})"/g)].map((match) => match[1]);
  assert.deepEqual(web, ids());
  assert.deepEqual(mobile, ids());
});

test("one source generates web and native design tokens", () => {
  const source = JSON.parse(readRepo("packages/shared-ui/tokens/theme.json"));
  const web = readWeb("src/shared/design/tokens.css");
  const native = readRepo("apps/mobile/src/shared/theme/tokens.ts");
  assert.equal(source.breakpoint.narrow, 480);
  assert.equal(source.breakpoint.mobile, 768);
  assert.equal(source.breakpoint.tablet, 1024);
  assert.equal(source.breakpoint.compactDesktop, 1280);
  assert.match(web, /GENERATED from packages\/shared-ui\/tokens\/theme\.json/);
  assert.match(native, /GENERATED from packages\/shared-ui\/tokens\/theme\.json/);
  assert.match(web, /--erp-touch-target: 44px/);
  assert.match(native, /minimumTouchTarget = 48/);
});

test("CRM route layout has one canonical stylesheet and no app-root CRM CSS", () => {
  const root = readWeb("src/app/layout.tsx");
  const crm = readWeb("src/app/(app)/crm/layout.tsx");
  const appCss = fs.readdirSync(path.join(webRoot, "src/app")).filter((name) => /^crm-.*\.css$/.test(name));
  assert.deepEqual(appCss, []);
  assert.doesNotMatch(root, /import "\.\/crm-[^"]+\.css"/);
  assert.deepEqual([...crm.matchAll(/import "([^"]+\.css)"/g)].map((match) => match[1]), ["@/modules/crm/ui/crm.css"]);
  assert.match(crm, /data-crm-ui="canonical"/);
  assert.match(crm, /CrmRouteExperience/);
});

test("CRM canonical CSS has one responsive/theme grammar", () => {
  const css = readWeb("src/modules/crm/ui/crm.css");
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b|rgba?\s*\(|hsla?\s*\(/i);
  assert.doesNotMatch(css, /!important\b/);
  assert.doesNotMatch(css, /:root\b/);
  assert.match(css, /var\(--erp-color-surface\)/);
  assert.match(css, /var\(--erp-font-size-md\)/);
  assert.match(css, /var\(--erp-touch-target\)/);
  for (const bp of [1279, 1023, 767, 479]) assert.match(css, new RegExp(`max-width: ${bp}px`));
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /:focus-visible/);
});

test("CRM routes use canonical page archetype wrapper", () => {
  const registry = readWeb("src/modules/crm/ui/crm-route-registry.ts");
  const wrapper = readWeb("src/modules/crm/ui/crm-route-experience.tsx");
  for (const archetype of ["home", "list-work-queue", "record-360", "board", "calendar", "inbox", "analytics", "data-operations", "setup-catalog", "setup-rule", "feature-directory"]) {
    assert.match(registry, new RegExp(`\\"${archetype}\\"`));
  }
  assert.match(wrapper, /Skip to CRM content/);
  assert.match(wrapper, /data-crm-archetype/);
});

test("CRM product workflows use the shared governed overlay system", () => {
  const files = [
    ...walk("apps/web/src/modules/crm"),
    ...walk("apps/web/src/app/(app)/crm"),
  ];
  for (const file of files) {
    const source = readRepo(file);
    assert.doesNotMatch(source, /window\.(?:confirm|prompt|alert)\s*\(/, `${file} must not use browser-native dialogs`);
    assert.doesNotMatch(source, /<dialog(?:\s|>)|\.showModal\s*\(/, `${file} must delegate overlays to shared/design Dialog`);
  }
});

test("CRM exposes calendar, feature discovery and data management as first-class routes", () => {
  const nav = readWeb("src/core/navigation/modules.ts");
  for (const href of ["/crm/calendar", "/crm/features", "/crm/data-management"]) {
    assert.match(nav, new RegExp(`href: \\"${href.replaceAll("/", "\\/")}\\"`));
  }
});
