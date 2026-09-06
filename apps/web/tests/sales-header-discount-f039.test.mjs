import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const editor = readFileSync(
  new URL("../src/modules/sales/components/document-editor.tsx", import.meta.url),
  "utf8",
);

test("F039: the document editor exposes a header discount input wired to form state", () => {
  assert.match(editor, /headerDiscountPercent: "0"/);
  assert.match(editor, /Header discount %/);
  assert.match(editor, /value=\{form\.headerDiscountPercent\}/);
  assert.match(editor, /setForm\(\{ \.\.\.form, headerDiscountPercent: event\.target\.value \}\)/);
});

test("F039: the pricing preview type includes headerDiscountAmount", () => {
  assert.match(editor, /headerDiscountAmount: unknown;/);
});
