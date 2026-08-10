#!/usr/bin/env node
// Validates the Prompt 11 reconciliation artifacts.
//
// IMPORTANT CONTEXT: this repository does not contain a row-level, named
// 1,039-feature master register (see docs/implementation/
// ERP_FEATURE_RECONCILIATION_011.md, Section 2-4). Per that document's
// CRITICAL SOURCE CHECK fallback, ERP_FEATURE_MATRIX_011.csv therefore
// contains a real, evidence-based functional-area inventory (not 1,039
// fabricated named rows), and this script does NOT assert an exact 1,039
// row count. It validates structural integrity instead: valid statuses,
// valid UAT statuses, every incomplete row has a recommended prompt
// mapping, and every referenced prompt number falls inside 12-102.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");

const STATUSES = new Set([
  "COMPLETE",
  "PARTIAL",
  "FOUNDATION_ONLY",
  "UI_ONLY",
  "MISSING",
  "UNVERIFIED",
]);

const UAT_STATUSES = new Set(["READY", "LIMITED", "NOT_READY", "BLOCKED"]);

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      if (text[i - 1] !== "\r") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      }
    } else if (c === "\r") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
}

function loadCsv(relPath) {
  const text = readFileSync(path.join(root, relPath), "utf8");
  const rows = parseCsv(text);
  const header = rows[0];
  return rows.slice(1).map((r) => {
    const record = {};
    header.forEach((key, idx) => {
      record[key] = r[idx] ?? "";
    });
    return record;
  });
}

function inPromptRange(token) {
  if (token === "" || token === "n/a") return true;
  const parts = token.split("-").map((s) => Number(s.trim()));
  if (parts.some((n) => Number.isNaN(n))) return false;
  return parts.every((n) => n >= 12 && n <= 102);
}

let failures = 0;
function fail(message) {
  failures += 1;
  console.error(`FAIL: ${message}`);
}
function info(message) {
  console.log(message);
}

// --- ERP_FEATURE_MATRIX_011.csv ---
const matrix = loadCsv("docs/implementation/ERP_FEATURE_MATRIX_011.csv");
info(`ERP_FEATURE_MATRIX_011.csv: ${matrix.length} rows loaded`);

const moduleCounts = new Map();
for (const row of matrix) {
  if (row.status && !STATUSES.has(row.status)) {
    fail(`${row.feature_id}: invalid status "${row.status}"`);
  }
  if (row.uat_status && !UAT_STATUSES.has(row.uat_status)) {
    fail(`${row.feature_id}: invalid uat_status "${row.uat_status}"`);
  }
  if (row.recommended_prompt_cluster && !inPromptRange(row.recommended_prompt_cluster)) {
    fail(
      `${row.feature_id}: recommended_prompt_cluster "${row.recommended_prompt_cluster}" is not within 12-102 or "n/a"`,
    );
  }
  const incomplete = ["PARTIAL", "FOUNDATION_ONLY", "UI_ONLY", "MISSING"].includes(row.status);
  if (incomplete && row.scope === "module" && (!row.recommended_prompt_cluster || row.recommended_prompt_cluster === "n/a")) {
    fail(`${row.feature_id}: incomplete module row has no recommended_prompt_cluster`);
  }
  if (row.module) {
    moduleCounts.set(row.module, (moduleCounts.get(row.module) ?? 0) + 1);
  }
}

info("Real functional-area rows found per module (NOT the 1,039 baseline count — see header note):");
for (const [mod, count] of [...moduleCounts.entries()].sort()) {
  info(`  ${mod}: ${count}`);
}

// --- ERP_ACCOUNTING_MATRIX_011.csv ---
const accounting = loadCsv("docs/implementation/ERP_ACCOUNTING_MATRIX_011.csv");
info(`\nERP_ACCOUNTING_MATRIX_011.csv: ${accounting.length} rows loaded`);
if (accounting.length !== 43) {
  fail(`Accounting matrix expected 43 rows (per agent's exact inventory), found ${accounting.length}`);
}
for (const row of accounting) {
  if (row.status && !STATUSES.has(row.status)) {
    fail(`${row.feature_id}: invalid status "${row.status}"`);
  }
  if (row.uat_status && !UAT_STATUSES.has(row.uat_status)) {
    fail(`${row.feature_id}: invalid uat_status "${row.uat_status}"`);
  }
  if (row.recommended_prompt_cluster && !inPromptRange(row.recommended_prompt_cluster)) {
    fail(`${row.feature_id}: recommended_prompt_cluster "${row.recommended_prompt_cluster}" out of range`);
  }
}

// --- ERP_EXECUTION_PLAN_012_102.md — every prompt 12-102 exactly once ---
const planPath = path.join(root, "docs/implementation/ERP_EXECUTION_PLAN_012_102.md");
const planText = readFileSync(planPath, "utf8");
const headingMatches = [...planText.matchAll(/^### Prompt (\d+)/gm)].map((m) => Number(m[1]));
info(`\nERP_EXECUTION_PLAN_012_102.md: ${headingMatches.length} prompt headings found`);
const expected = [];
for (let n = 12; n <= 102; n += 1) expected.push(n);
const missing = expected.filter((n) => !headingMatches.includes(n));
const seen = new Set();
const duplicated = [];
for (const n of headingMatches) {
  if (seen.has(n)) duplicated.push(n);
  seen.add(n);
}
if (missing.length > 0) fail(`Execution plan missing prompt numbers: ${missing.join(", ")}`);
if (duplicated.length > 0) fail(`Execution plan has duplicated prompt numbers: ${duplicated.join(", ")}`);
if (missing.length === 0 && duplicated.length === 0) {
  info("Execution plan covers 12-102 exactly once each: PASS");
}

info(`\n${failures === 0 ? "PASS" : "FAIL"}: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
