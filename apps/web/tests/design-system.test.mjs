import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const css = fs.readFileSync("src/app/globals.css", "utf8");
const shell = fs.readFileSync("src/components/app-shell.tsx", "utf8");
const navigation = fs.readFileSync(
  "src/components/navigation-link.tsx",
  "utf8",
);
const onboarding = fs.readFileSync(
  "src/components/onboarding-form.tsx",
  "utf8",
);
const loading = fs.readFileSync("src/app/loading.tsx", "utf8");

test("web experience defines a coherent token system", () => {
  for (const token of [
    "--color-canvas",
    "--color-surface",
    "--color-primary",
    "--shadow-panel",
    "--radius-panel",
    "--sidebar-width",
  ]) {
    assert.match(css, new RegExp(token.replace("--", "\\-\\-")));
  }
});

test("interactive controls meet the product target-size policy", () => {
  assert.match(css, /--control-height:\s*44px/);
  assert.match(css, /min-height:\s*var\(--control-height\)/);
});

test("workspace navigation exposes current location and a skip link", () => {
  assert.match(navigation, /aria-current=/);
  assert.match(shell, /Skip to main content/);
  assert.match(shell, /id="workspace-content"/);
});

test("forms and asynchronous states remain programmatically announced", () => {
  assert.match(onboarding, /role="status"/);
  assert.match(onboarding, /aria-live="polite"/);
  assert.match(loading, /aria-busy="true"/);
  assert.match(loading, /role="status"/);
});

test("responsive and reduced-motion behavior are included", () => {
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
