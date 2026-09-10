import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("F006 web: qualification-criteria is a real, reachable resource — not orphaned admin config", () => {
  const scope = read("src/modules/crm/crm-data-operations-and-customization/capability-registry.ts");
  assert.match(scope, /"qualification-criteria"/);
  const settings = read("src/app/(app)/crm/settings/page.tsx");
  assert.match(settings, /Qualification criteria/);
  assert.match(settings, /"qualification-criteria"/);
  const definitions = read("src/modules/crm/crm-data-operations-and-customization/resource-definitions/lead-lifecycle.ts");
  assert.match(definitions, /"qualification-criteria": workspace\(/);
  assert.match(definitions, /Lead field key\(s\), comma-separated/);
});

test("F028 correction: custom objects/fields/records are now reachable resources, closing the gap found while wiring F006", () => {
  const scope = read("src/modules/crm/crm-data-operations-and-customization/capability-registry.ts");
  for (const key of ["custom-object-definitions", "custom-field-definitions", "custom-records"]) {
    assert.match(scope, new RegExp(`"${key}"`));
  }
  const settings = read("src/app/(app)/crm/settings/page.tsx");
  assert.match(settings, /"custom-object-definitions"/);
  assert.match(settings, /"custom-field-definitions"/);
  assert.match(settings, /"custom-records"/);
});

test("F006 backend: readiness criteria are loaded from tenant configuration, not hardcoded in JS", () => {
  const source = read("../../services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-qualification.js");
  assert.match(source, /FROM tenant\.crm_lead_qualification_criteria/);
  assert.match(source, /READINESS_FIELD_COLUMNS/);
  assert.doesNotMatch(source, /export function evaluateLeadQualificationReadiness\(lead/);
  const definitions = read("../../services/api/src/modules/crm/crm-data-operations-and-customization/resource-registry.js") + read("../../services/api/src/modules/crm/crm-data-operations-and-customization/resource-validation.js");
  assert.match(definitions, /"qualification-criteria": \{/);
  assert.match(definitions, /assertQualificationCriterionFieldsValid/);
  assert.match(definitions, /CRM_QUALIFICATION_CRITERION_FIELD_INVALID/);
});
