import assert from "node:assert/strict";
import test from "node:test";
import { normalizePage, rowsToCsv } from "../src/index.js";

test("CSV export neutralizes formulas and preserves multiline values", () => {
  const csv = rowsToCsv([{ key: "name", label: "Name" }, { key: "note", label: "Note" }], [{ name: "=2+2", note: "one\ntwo" }]);
  assert.match(csv, /'=2\+2/);
  assert.match(csv, /"one\ntwo"/);
});

test("report pagination is bounded", () => {
  assert.deepEqual(normalizePage({ limit: 9999, offset: -2 }), { limit: 250, offset: 0 });
});
