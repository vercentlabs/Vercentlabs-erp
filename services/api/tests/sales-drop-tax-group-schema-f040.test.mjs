import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const index = readFileSync(
  new URL("../src/modules/sales/index.js", import.meta.url),
  "utf8",
);

test("F040: the Sales module no longer references the unused tax-group schema", () => {
  assert.doesNotMatch(index, /tax_group_id/);
  assert.doesNotMatch(index, /taxGroupId/);
  assert.doesNotMatch(index, /sales_tax_groups/);
  assert.doesNotMatch(index, /sales_tax_group_components/);
});
