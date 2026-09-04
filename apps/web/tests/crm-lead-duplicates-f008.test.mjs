import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("F008 pre-check route uses the canonical duplicate engine and safe result shape", () => {
  const source = read("src/app/api/crm/leads/duplicates/route.ts");
  assert.match(source, /evaluateLeadDuplicateRisk/);
  assert.match(source, /publicDuplicateResult\(evaluation\)/);
  assert.match(source, /classification,\s*matches,/);
  assert.match(source, /restrictedMatch:/);
  assert.match(source, /canOverride: evaluation\.canOverride/);
  assert.doesNotMatch(source, /classification: evaluation\.classification/);
  assert.doesNotMatch(source, /findCrmDuplicates\(client/);
});

test("F008 create and PATCH keep override reason outside generic field mapping", () => {
  for (const relative of [
    "src/app/api/crm/[resource]/route.ts",
    "src/app/api/crm/[resource]/[id]/route.ts",
  ]) {
    const source = read(relative);
    assert.match(source, /duplicateOverrideReason/);
    assert.match(source, /1,000 characters/);
  }
});

test("F008 public capture never discloses Lead membership or duplicate state", () => {
  const source = read("src/app/api/crm/public/capture/[key]/route.ts");
  assert.match(source, /accepted: true/);
  assert.doesNotMatch(source, /leadId: result\.leadId/);
  assert.doesNotMatch(source, /duplicateWarning: result/);
});

test("F008 published acquisition form also returns a non-disclosing public shape", () => {
  const source = read(
    "src/app/api/crm/lead-acquisition/public/forms/[key]/route.ts",
  );
  assert.match(source, /accepted: true/);
  assert.match(source, /result\.successMessage/);
  assert.doesNotMatch(source, /return ok\(\{ result \}/);
});

test("F008 create UX includes exact/probable language, restricted disclosure and audited override reason", () => {
  const source = read("src/modules/crm/components/lead-create-workspace.tsx");
  assert.match(source, /Matching Lead found/);
  assert.match(source, /Possible duplicate/);
  assert.match(source, /Existing Lead \(restricted\)/);
  assert.match(source, /duplicateOverrideReason/);
  assert.match(source, /immutable audit evidence/);
  assert.match(source, /query\.set\("firstName"/);
});

test("F008 edit UX pre-checks with self-exclusion and blocks unauthorized exact save", () => {
  const source = read("src/modules/crm/components/leads-workspace.tsx");
  assert.match(source, /excludeId: String\(row\.id/);
  assert.match(source, /duplicateBlocked/);
  assert.match(source, /duplicateOverrideReason/);
  assert.match(source, /outside your current record access/);
});

test("F008 Lead Detail does not render links or merge actions for restricted matches", () => {
  const source = read("src/modules/crm/components/lead-detail-workspace.tsx");
  assert.match(source, /const restricted = Boolean\(row\.restricted\)/);
  assert.match(source, /restricted \? "" : String\(row\.id/);
  assert.match(source, /canManage && id/);
});

test("F008 import delegates duplicate decisions to canonical createCrmRecord", () => {
  const source = read("src/app/api/crm/[resource]/import/route.ts");
  assert.match(source, /CRM_LEAD_DUPLICATE_EXACT/);
  assert.doesNotMatch(source, /normalized_email=tenant\.crm_normalize_email/);
});

test("F008 responsive and focus styling covers create and edit override surfaces", () => {
  const createCss = read("src/app/crm-lead-create.css");
  const suiteCss = read("src/app/crm-lead-suite-enterprise.css");
  assert.match(createCss, /crm-lead-duplicate-override/);
  assert.match(createCss, /focus-visible/);
  assert.match(suiteCss, /crm-f008-edit-warning/);
  assert.match(suiteCss, /@media \(max-width: 430px\)/);
});
