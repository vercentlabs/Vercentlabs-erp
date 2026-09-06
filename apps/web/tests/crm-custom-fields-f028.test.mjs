import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("F028 web: the custom field definition admin form exposes the dependent-option field", () => {
  const source = read("src/modules/crm/index.ts");
  assert.match(source, /name: "dependsOnFieldKey"/);
  assert.match(source, /Depends on field key/);
});

test("F028 backend: dependent options and the required-field rollout safety check are enforced server-side", () => {
  const source = read("../../services/api/src/modules/crm/index.js");
  assert.match(source, /assertCustomFieldRequiredRolloutSafe/);
  assert.match(source, /CRM_CUSTOM_FIELD_REQUIRED_ROLLOUT_GAP/);
  assert.match(source, /confirmRequiredRollout/);
  assert.match(source, /dependsOnFieldKey: "depends_on_field_key"/);
  assert.match(source, /depends_on_field_key/);
});
