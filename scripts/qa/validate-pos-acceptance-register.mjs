#!/usr/bin/env node
// Deterministic validation gate for the POS atomic acceptance register.
// Re-generates the register from source (never trusts a stale on-disk
// copy) and fails the process (non-zero exit) when any of the following
// hold, per the POS Completion Program's own explicit anti-fraud rules:
//
//   1. A canonical F268-F307 requirement present in the source
//      SUBREQUIREMENT_REGISTER.csv is missing from the generated register.
//   2. A requirement_id is duplicated.
//   3. A row's feature_id falls outside F268-F307.
//   4. A row marked PASS lacks evidence (every evidence-bearing column is
//      empty) -- "PASS" must never rest on source-file existence alone.
//   5. The canonical counts (40 features, 1480 subrequirements) disagree
//      with what this program's own history recorded, without an
//      explained change (this script explains any mismatch it finds
//      rather than silently accepting or silently failing).
//
// This script does NOT (and cannot, on its own) verify that a PASS row's
// cited evidence is actually true -- that verification happened when the
// override was written by hand, against real code and a real test. This
// script's job is structural/anti-fraud integrity of the register itself.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { generate, parseCsv, POS_FEATURE_ID_PATTERN } from "./generate-pos-acceptance-register.mjs";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const outputPath = path.join(root, "docs/03-modules/point-of-sale/POS_ATOMIC_ACCEPTANCE_REGISTER.csv");
const sourcePath = path.join(root, "docs/02-register/SUBREQUIREMENT_REGISTER.csv");

const EXPECTED_FEATURE_COUNT = 40;
const EXPECTED_SUBREQUIREMENT_COUNT = 1480;
const VALID_STATUSES = new Set(["PASS", "FAIL", "PARTIAL", "BLOCKED", "UNVERIFIED", "NOT_APPLICABLE"]);

const failures = [];

// Regenerate first -- the register CSV on disk must always be the direct,
// current output of the generator, never hand-edited.
const stats = generate({ writeFile: true });

const csvText = readFileSync(outputPath, "utf8");
const rows = parseCsv(csvText);
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const dataRows = rows.slice(1);

// Check 1: every source requirement present.
const sourceText = readFileSync(sourcePath, "utf8");
const sourceRows = parseCsv(sourceText);
const sourceIdx = Object.fromEntries(sourceRows[0].map((h, i) => [h, i]));
const sourcePosIds = new Set(
  sourceRows.slice(1).filter((r) => POS_FEATURE_ID_PATTERN.test(r[sourceIdx.feature_id])).map((r) => r[sourceIdx.requirement_id]),
);
const registerIds = new Set(dataRows.map((r) => r[idx.requirement_id]));
for (const id of sourcePosIds) {
  if (!registerIds.has(id)) failures.push(`Missing canonical requirement in register: ${id}`);
}

// Check 2: no duplicate requirement_id.
const seen = new Map();
for (const r of dataRows) {
  const id = r[idx.requirement_id];
  seen.set(id, (seen.get(id) || 0) + 1);
}
for (const [id, count] of seen) {
  if (count > 1) failures.push(`Duplicate requirement_id in register: ${id} (${count} occurrences)`);
}

// Check 3: every feature_id within F268-F307.
for (const r of dataRows) {
  const featureId = r[idx.feature_id];
  if (!POS_FEATURE_ID_PATTERN.test(featureId)) {
    failures.push(`Row ${r[idx.requirement_id]} has out-of-scope feature_id: ${featureId}`);
  }
}

// Check 4: status vocabulary + PASS rows carry evidence.
const evidenceColumns = [
  "database_evidence", "backend_function", "http_endpoint", "frontend_evidence",
  "security_permission_evidence", "cross_module_integration",
  "positive_test", "negative_test", "concurrency_retry_test", "browser_test",
  "verification_result",
];
for (const r of dataRows) {
  const status = r[idx.status_flag];
  if (!VALID_STATUSES.has(status)) {
    failures.push(`Row ${r[idx.requirement_id]} has an invalid status_flag: "${status}"`);
    continue;
  }
  if (status === "PASS") {
    const hasEvidence = evidenceColumns.some((col) => r[idx[col]] && r[idx[col]].trim());
    if (!hasEvidence) {
      failures.push(`Row ${r[idx.requirement_id]} is marked PASS but carries no evidence in any evidence column.`);
    }
    if (!r[idx.commit_sha] || !r[idx.commit_sha].trim()) {
      failures.push(`Row ${r[idx.requirement_id]} is marked PASS but has no commit_sha recorded.`);
    }
  }
  if (status === "NOT_APPLICABLE" && !(r[idx.exact_gap] && r[idx.exact_gap].trim())) {
    failures.push(`Row ${r[idx.requirement_id]} is marked NOT_APPLICABLE but has no justification in exact_gap.`);
  }
}

// Check 5: canonical counts, explained rather than silently accepted.
if (stats.featureCount !== EXPECTED_FEATURE_COUNT) {
  console.warn(
    `NOTE: expected ${EXPECTED_FEATURE_COUNT} POS features, found ${stats.featureCount} in the current canonical FEATURE_REGISTER.csv. ` +
      `This is only a hard failure if unexplained -- if the canonical register genuinely changed, update EXPECTED_FEATURE_COUNT here with a note citing why.`,
  );
  failures.push(`Feature count mismatch: expected ${EXPECTED_FEATURE_COUNT}, found ${stats.featureCount} (see NOTE above).`);
}
if (stats.subrequirementRows !== EXPECTED_SUBREQUIREMENT_COUNT) {
  console.warn(
    `NOTE: expected ${EXPECTED_SUBREQUIREMENT_COUNT} POS subrequirement rows, found ${stats.subrequirementRows}. ` +
      `This is only a hard failure if unexplained -- if the canonical register genuinely changed, update EXPECTED_SUBREQUIREMENT_COUNT here with a note citing why.`,
  );
  failures.push(`Subrequirement count mismatch: expected ${EXPECTED_SUBREQUIREMENT_COUNT}, found ${stats.subrequirementRows} (see NOTE above).`);
}

// Summary of status distribution -- never derive a "feature COMPLETE"
// claim automatically; this is informational only, per the explicit
// instruction that a feature may be marked complete only when every
// applicable mandatory child requirement passes, which requires human
// judgement about "applicable" and "mandatory" this script does not
// attempt to automate.
const statusCounts = {};
for (const r of dataRows) {
  const status = r[idx.status_flag];
  statusCounts[status] = (statusCounts[status] || 0) + 1;
}
console.log(`Register: ${dataRows.length} rows across ${stats.featureCount} features.`);
console.log("Status distribution:", statusCounts);

const featurePassCounts = {};
for (const r of dataRows) {
  const featureId = r[idx.feature_id];
  featurePassCounts[featureId] = featurePassCounts[featureId] || { pass: 0, total: 0 };
  featurePassCounts[featureId].total += 1;
  if (r[idx.status_flag] === "PASS") featurePassCounts[featureId].pass += 1;
}
const anyAtomicPass = Object.values(featurePassCounts).some((c) => c.pass > 0);
if (anyAtomicPass) {
  console.log("Features with at least one atomically-verified (PASS) requirement this program independently confirmed:");
  for (const [featureId, counts] of Object.entries(featurePassCounts)) {
    if (counts.pass > 0) console.log(`  ${featureId}: ${counts.pass}/${counts.total} atomic rows PASS`);
  }
}

if (failures.length) {
  console.error(`\nPOS acceptance register validation FAILED -- ${failures.length} issue(s):`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log("\nPOS acceptance register validation passed -- structural integrity confirmed (this does not itself verify the truth of any cited evidence).");
}
