import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const layout = fs.readFileSync("src/app/layout.tsx", "utf8");
const theme = fs.readFileSync("src/app/operator-workbench.css", "utf8");
const shell = fs.readFileSync("src/components/app-shell.tsx", "utf8");
const section = fs.readFileSync(
  "src/components/navigation-section.tsx",
  "utf8",
);
const navigation = fs.readFileSync(
  "src/components/navigation-link.tsx",
  "utf8",
);
const search = fs.readFileSync("src/components/workspace-search.tsx", "utf8");

function indexOfImport(file) {
  return layout.indexOf(`import "./${file}";`);
}

test("operator workbench is the final web visual layer", () => {
  assert.ok(indexOfImport("operator-workbench.css") > indexOfImport("billing-extension.css"));
  assert.match(theme, /--sidebar-width:\s*252px/);
  assert.match(theme, /--control-height:\s*44px/);
  assert.match(theme, /--content-max:\s*1680px/);
});

test("navigation is grouped by ERP workflow instead of one continuous link list", () => {
  for (const label of ["CRM", "Sales", "Procurement", "Accounting"]) {
    assert.match(shell, new RegExp(`label: "${label}"`));
  }
  assert.match(shell, /<NavigationSection/);
  assert.match(section, /<details/);
  assert.match(section, /open=\{active\}/);
  assert.match(navigation, /exact = false/);
  assert.match(navigation, /nested = false/);
});

test("workspace search has a real keyboard interaction", () => {
  assert.match(search, /event\.ctrlKey \|\| event\.metaKey/);
  assert.match(search, /event\.key\.toLowerCase\(\) === "k"/);
  assert.match(search, /inputRef\.current\?\.focus\(\)/);
});

test("visual system avoids decorative ERP chrome and preserves accessibility", () => {
  assert.match(theme, /\.dashboard-hero::before\s*\{[\s\S]*display:\s*none/);
  assert.match(theme, /prefers-reduced-motion/);
  assert.match(shell, /Skip to main content/);
  assert.match(shell, /aria-label="Primary workspace navigation"/);
});
