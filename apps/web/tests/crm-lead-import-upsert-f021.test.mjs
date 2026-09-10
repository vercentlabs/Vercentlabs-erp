import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// F021 (Lead import and export) — LAST PROMPT 1/3 closeout: import
// previously only ever created records; a row that exactly matched an
// existing Lead was silently skipped, so a re-uploaded list could never
// update the records it had already imported (CRM-VNEXT-060, "no upsert
// policy"). Source-assertion for the same reason crm-lead-import-dry-run-
// f021.test.mjs is: no behavioral test harness for Next.js route.ts
// handlers exists in this codebase yet.

test("F021: upsert mode reuses the governed F008 exact-match classification, not a bespoke check", () => {
  const source = read("src/modules/crm/crm-data-operations-and-customization/route-handlers/lead-import.ts");
  assert.match(source, /import \{ createCrmRecord, evaluateLeadDuplicateRisk, updateCrmRecord \} from "@vercentlabs\/api";/);
  assert.match(source, /evaluateLeadDuplicateRisk\(client, context, input\)/);
  assert.match(source, /\.internalMatches\.find\(\(match\) => match\.classification === "exact"\)/);
});

test("F021: an exact match is updated in place; only a non-exact (or no) match still creates a new record", () => {
  const source = read("src/modules/crm/crm-data-operations-and-customization/route-handlers/lead-import.ts");
  const exactMatchIdx = source.indexOf("if (exactMatch) {");
  const updateIdx = source.indexOf("updateCrmRecord(client, context, resource, exactMatch.row.id, input)");
  const createIdx = source.indexOf("createCrmRecord(client, context, resource, input)");
  assert.ok(exactMatchIdx > 0 && updateIdx > exactMatchIdx, "update must be the exact-match branch");
  assert.ok(createIdx > updateIdx, "create must be the else branch, after the update branch");
});

test("F021: a matched Lead that is already converted (read-only) is skipped, not a hard failure", () => {
  const source = read("src/modules/crm/crm-data-operations-and-customization/route-handlers/lead-import.ts");
  assert.match(source, /error\.code === "CRM_LEAD_DUPLICATE_EXACT" \|\|\s*\n\s*error\.code === "CRM_LEAD_CONVERTED_READ_ONLY"/);
});

test("F021: upsert only activates on the explicit ?mode=upsert query param — default behavior (create-only) is unchanged", () => {
  const source = read("src/modules/crm/crm-data-operations-and-customization/route-handlers/lead-import.ts");
  assert.match(source, /const modeParam = new URL\(request\.url\)\.searchParams\.get\("mode"\);/);
  assert.match(source, /const upsert = modeParam === "upsert";/);
});

test("F021: created vs updated counts are surfaced separately in the live response, folded together only for receipt-replay storage", () => {
  const source = read("src/modules/crm/crm-data-operations-and-customization/route-handlers/lead-import.ts");
  assert.match(source, /let updated = 0;/);
  assert.match(source, /updated,\s*\n\s*skipped,/);
  assert.match(source, /succeeded \+ updated,/);
});
