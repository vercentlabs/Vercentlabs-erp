import { test } from "node:test";
import assert from "node:assert/strict";
import { theme } from "./theme.ts";
import { lightTheme } from "./themes/light.ts";
import { density } from "./semantic/densityTokens.ts";
import { controlHeight, touchTarget } from "./semantic/controlTokens.ts";

test("theme.json parses and has every top-level section the generators depend on", () => {
  for (const key of ["color", "alpha", "spacing", "radius", "control", "layout", "breakpoint", "z", "motion", "webType", "nativeType"]) {
    assert.ok(key in theme, `theme.json is missing "${key}"`);
  }
});

test("breakpoints match the values RESPONSIVE_STANDARD.md-driven behavior assumes", () => {
  assert.equal(theme.breakpoint.narrow, 480);
  assert.equal(theme.breakpoint.mobile, 768);
  assert.equal(theme.breakpoint.tablet, 1024);
  assert.equal(theme.breakpoint.compactDesktop, 1280);
});

test("touch targets meet the accessibility minimums (44px web / 48px native)", () => {
  assert.ok(touchTarget.web >= 44);
  assert.ok(touchTarget.native >= 48);
});

test("density modes are distinct and both reference a real control height", () => {
  assert.notEqual(density.compact.controlHeight, density.comfortable.controlHeight);
  assert.equal(density.compact.controlHeight, controlHeight.compact);
  assert.equal(density.comfortable.controlHeight, controlHeight.comfortable);
});

test("lightTheme exposes every semantic group a component can import", () => {
  for (const key of ["surface", "text", "border", "action", "status", "focus", "typography", "spacing", "density"]) {
    assert.ok(key in lightTheme, `lightTheme is missing "${key}"`);
  }
});

test("status tones each have bg/fg/border", () => {
  for (const tone of Object.values(lightTheme.status)) {
    assert.ok(tone.bg && tone.fg && tone.border);
  }
});
