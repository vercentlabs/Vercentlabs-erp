#!/usr/bin/env node
// Prompt 15: merges the deterministically-parsed feature identity rows
// (scripts/validation/.generated/exact-master-register.json, produced by
// parse-exact-master-register.mjs) with hand-authored classification data
// (status/uat_status/priority/evidence/gaps — real repository research,
// not generated) and an optional prompt-allocation map, to produce
// docs/implementation/ERP_EXACT_FEATURE_MATRIX_015.csv.
//
// Usage: node scripts/validation/build-exact-feature-matrix.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const generatedDir = path.join(root, "scripts/validation/.generated");
const registerPath = path.join(generatedDir, "exact-master-register.json");
const classificationPath = path.join(generatedDir, "classification-merged.json");
const promptAssignmentsPath = path.join(generatedDir, "prompt-assignments.json");
const outPath = path.join(root, "docs/implementation/ERP_EXACT_FEATURE_MATRIX_015.csv");

const COLUMNS = [
  "feature_id",
  "historical_index",
  "scope",
  "module",
  "category",
  "feature_number",
  "feature_name",
  "source_section",
  "status",
  "uat_status",
  "priority",
  "ui_evidence",
  "service_evidence",
  "database_evidence",
  "permission_evidence",
  "test_evidence",
  "cross_module_evidence",
  "primary_gap",
  "secondary_gap",
  "blocker_type",
  "recommended_prompt",
  "notes",
];

function csvEscape(value) {
  const s = value === undefined || value === null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function main() {
  const register = JSON.parse(fs.readFileSync(registerPath, "utf8"));
  const classifications = JSON.parse(fs.readFileSync(classificationPath, "utf8"));
  const promptAssignments = fs.existsSync(promptAssignmentsPath)
    ? JSON.parse(fs.readFileSync(promptAssignmentsPath, "utf8"))
    : {};

  const classificationById = new Map(classifications.map((c) => [c.feature_id, c]));

  const missing = register.filter((r) => !classificationById.has(r.feature_id));
  if (missing.length) {
    throw new Error(`${missing.length} feature_id(s) have no classification: ${missing.slice(0, 10).map((r) => r.feature_id).join(", ")}${missing.length > 10 ? "..." : ""}`);
  }
  const extra = classifications.filter((c) => !register.some((r) => r.feature_id === c.feature_id));
  if (extra.length) {
    throw new Error(`${extra.length} classification(s) reference an unknown feature_id: ${extra.slice(0, 10).map((c) => c.feature_id).join(", ")}`);
  }

  const rows = register.map((r) => {
    const c = classificationById.get(r.feature_id);
    const isComplete = c.status === "COMPLETE";
    const recommended_prompt = isComplete ? "" : (promptAssignments[r.feature_id] ?? "");
    return {
      ...r,
      status: c.status,
      uat_status: c.uat_status,
      priority: c.priority,
      ui_evidence: c.ui_evidence || "",
      service_evidence: c.service_evidence || "",
      database_evidence: c.database_evidence || "",
      permission_evidence: c.permission_evidence || "",
      test_evidence: c.test_evidence || "",
      cross_module_evidence: c.cross_module_evidence || "",
      primary_gap: c.primary_gap || "",
      secondary_gap: c.secondary_gap || "",
      blocker_type: c.blocker_type || "",
      recommended_prompt,
      notes: c.notes || "",
    };
  });

  const lines = [COLUMNS.join(",")];
  for (const row of rows) {
    lines.push(COLUMNS.map((col) => csvEscape(row[col])).join(","));
  }
  fs.writeFileSync(outPath, lines.join("\n") + "\n");
  console.log(`Wrote ${rows.length} rows to ${outPath}`);

  // Quick status distribution for a sanity check on stdout.
  const statusCounts = {};
  const uatCounts = {};
  for (const row of rows) {
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;
    uatCounts[row.uat_status] = (uatCounts[row.uat_status] || 0) + 1;
  }
  console.log("Status distribution:", statusCounts);
  console.log("UAT distribution:", uatCounts);
  const missingPromptForIncomplete = rows.filter((r) => r.status !== "COMPLETE" && !r.recommended_prompt);
  if (missingPromptForIncomplete.length) {
    console.log(`NOTE: ${missingPromptForIncomplete.length} incomplete row(s) have no recommended_prompt yet (expected until prompt-assignments.json is authored).`);
  }
}

main();
