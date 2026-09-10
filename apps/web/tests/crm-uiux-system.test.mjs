import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const repoRoot = path.resolve(webRoot, "../..");
const read = (file) => fs.readFileSync(path.join(webRoot, file), "utf8");

test("CRM UI registry maps the complete F001-F030 product contract", () => {
  const source = read("src/modules/crm/ui/crm-surface-registry.ts");
  const ids = [...source.matchAll(/id: \"(F\d{3})\"/g)].map((match) => match[1]);
  assert.deepEqual(ids, Array.from({ length: 30 }, (_, index) => `F${String(index + 1).padStart(3, "0")}`));
});

test("CRM route layout owns feature CSS and the ERP root does not", () => {
  const root = read("src/app/layout.tsx");
  const crm = read("src/app/(app)/crm/layout.tsx");
  assert.doesNotMatch(root, /import \"\.\/crm-[^\"]+\.css\"/);
  assert.match(crm, /crm-ui-system\.css/);
  assert.match(crm, /data-crm-ui=\"canonical\"/);
});

test("CRM exposes calendar, feature discovery and data management as first-class routes", () => {
  const nav = read("src/core/navigation/modules.ts");
  for (const href of ["/crm/calendar", "/crm/features", "/crm/data-management"]) {
    assert.match(nav, new RegExp(`href: \\\"${href.replaceAll("/", "\\/")}\\\"`));
  }
});

test("CRM UI layer includes responsive, focus and reduced-motion contracts", () => {
  const css = read("src/modules/crm/ui/crm-ui-system.css");
  assert.match(css, /--crm-touch-target: 44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /max-width: 1279px/);
  assert.match(css, /max-width: 1023px/);
  assert.match(css, /max-width: 767px/);
  assert.match(css, /max-width: 479px/);
  assert.match(css, /prefers-reduced-motion/);
});


test("CRM UI/UX: product workflows do not use browser-native confirm/prompt/alert", () => {
  const roots = [
    "apps/web/src/modules/crm",
    "apps/web/src/app/(app)/crm",
  ];
  const files = [];
  const walk = (relative) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, relative), { withFileTypes: true })) {
      const child = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(child);
      else if (/\.(?:ts|tsx|js|jsx)$/.test(entry.name)) files.push(child);
    }
  };
  for (const directory of roots) walk(directory);
  for (const file of files) {
    const source = fs.readFileSync(path.join(repoRoot, file), "utf8");
    assert.doesNotMatch(source, /window\.(?:confirm|prompt|alert)\s*\(/, `${file} must use the CRM command dialog system`);
  }
});
