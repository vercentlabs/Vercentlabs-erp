import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  COLOR_TOKENS,
  SEMANTIC_BACKGROUND,
  SEMANTIC_TEXT,
  SEMANTIC_BORDER,
  SEMANTIC_STATE,
  SEMANTIC_PRODUCT,
  LANDING_MODULES,
} from "@vercentlabs/landing-content";

const here = path.dirname(fileURLToPath(import.meta.url));
const globalsCss = readFileSync(path.join(here, "..", "app", "globals.css"), "utf8");

/**
 * apps/landing/app/globals.css hand-copies token values from
 * packages/landing-content/src/tokens.js into a Tailwind v4 @theme block (CSS
 * can't `import` a JS module). This test is the guardrail that keeps them from
 * silently drifting — see the comment at the top of globals.css.
 */
test("every base colour token value appears in globals.css", () => {
  for (const [name, value] of Object.entries(COLOR_TOKENS)) {
    assert.ok(globalsCss.includes(value), `COLOR_TOKENS.${name} ("${value}") is missing from globals.css`);
  }
});

test("every semantic token value appears in globals.css", () => {
  for (const group of [SEMANTIC_BACKGROUND, SEMANTIC_TEXT, SEMANTIC_BORDER, SEMANTIC_STATE, SEMANTIC_PRODUCT]) {
    for (const [name, value] of Object.entries(group)) {
      assert.ok(globalsCss.includes(value), `semantic token "${name}" ("${value}") is missing from globals.css`);
    }
  }
});

test("every module accent colour appears in globals.css", () => {
  for (const moduleInfo of LANDING_MODULES) {
    assert.ok(
      globalsCss.includes(moduleInfo.accentColor.hex),
      `module "${moduleInfo.key}" accent colour ("${moduleInfo.accentColor.hex}") is missing from globals.css`,
    );
  }
});
