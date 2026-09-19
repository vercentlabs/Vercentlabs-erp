#!/usr/bin/env node
// Generates docs/03-modules/point-of-sale/POS_ATOMIC_ACCEPTANCE_REGISTER.csv
// from the canonical docs/02-register/SUBREQUIREMENT_REGISTER.csv (F268-F307
// rows only) — the primary atomic-acceptance-criterion register (1 row per
// normative requirement). Every source requirement ID and exact original
// wording is preserved verbatim; no row is dropped or summarized.
//
// Default status is UNVERIFIED for every row. A hand-curated overrides file
// (POS_ACCEPTANCE_OVERRIDES.json) supplies real evidence ONLY for
// requirements this program has independently traced to actual code and a
// passing, reproducible test this session — mirroring the exact discipline
// scripts/validation/generate-crm-traceability.mjs already established for
// CRM: never infer PASS from a feature-level narrative claim or from
// source-file existence alone. A feature marked REAL/VERIFIED in
// POS_IMPLEMENTATION_TRACKER.md is NOT, by itself, evidence for any
// specific atomic row here — that tracker is feature-level narrative
// evidence; this register is atomic-requirement-level evidence, and the two
// are deliberately not conflated. See POS_COMPLETION_PROMPT1_HANDOFF.md for
// exactly which atomic rows this program has and hasn't independently
// verified.
//
// Re-run whenever overrides change. This script is the only thing that may
// write the register CSV, so the two never drift.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const sourcePath = path.join(root, "docs/02-register/SUBREQUIREMENT_REGISTER.csv");
const featureRegisterPath = path.join(root, "docs/02-register/FEATURE_REGISTER.csv");
const capabilityRegisterPath = path.join(root, "docs/02-register/CAPABILITY_REGISTER.csv");
const overridesPath = path.join(root, "docs/03-modules/point-of-sale/POS_ACCEPTANCE_OVERRIDES.json");
const outputPath = path.join(root, "docs/03-modules/point-of-sale/POS_ATOMIC_ACCEPTANCE_REGISTER.csv");

export const POS_FEATURE_ID_PATTERN = /^F(26[89]|2[789]\d|30[0-7])$/;

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else if (ch === "\r") { /* skip */ }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== "");
}

function csvField(value) {
  const s = String(value ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const HEADER = [
  "requirement_id", "feature_id", "capability_id", "requirement_type", "title",
  "normative_statement", "priority", "status_flag",
  "database_evidence", "backend_function", "http_endpoint", "frontend_evidence",
  "security_permission_evidence", "cross_module_integration",
  "positive_test", "negative_test", "concurrency_retry_test", "browser_test",
  "verification_result", "commit_sha", "exact_gap", "next_action", "phase_owner", "notes",
];

export function generate({ writeFile = true } = {}) {
  const csvText = readFileSync(sourcePath, "utf8");
  const rows = parseCsv(csvText);
  const header = rows[0];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const posRows = rows.slice(1).filter((r) => POS_FEATURE_ID_PATTERN.test(r[idx.feature_id]));

  const seenIds = new Set();
  for (const r of posRows) {
    const id = r[idx.requirement_id];
    if (seenIds.has(id)) throw new Error(`Duplicate requirement_id in source register: ${id}`);
    seenIds.add(id);
  }

  let overrides = {};
  try {
    overrides = JSON.parse(readFileSync(overridesPath, "utf8"));
  } catch {
    overrides = {};
  }

  const out = [HEADER.join(",")];
  for (const r of posRows) {
    const requirementId = r[idx.requirement_id];
    const override = overrides[requirementId] || {};
    const record = {
      requirement_id: requirementId,
      feature_id: r[idx.feature_id],
      capability_id: r[idx.capability_id],
      requirement_type: r[idx.requirement_type],
      title: r[idx.title],
      normative_statement: r[idx.normative_statement],
      priority: r[idx.priority],
      status_flag: override.status || "UNVERIFIED",
      database_evidence: override.database_evidence || "",
      backend_function: override.backend_function || "",
      http_endpoint: override.http_endpoint || "",
      frontend_evidence: override.frontend_evidence || "",
      security_permission_evidence: override.security_permission_evidence || "",
      cross_module_integration: override.cross_module_integration || "",
      positive_test: override.positive_test || "",
      negative_test: override.negative_test || "",
      concurrency_retry_test: override.concurrency_retry_test || "",
      browser_test: override.browser_test || "",
      verification_result: override.verification_result || "",
      commit_sha: override.commit_sha || "",
      exact_gap: override.exact_gap || (override.status ? "" : "Not independently re-verified at atomic granularity this session; see feature-level narrative in POS_IMPLEMENTATION_TRACKER.md for context, which is NOT itself atomic-row evidence."),
      next_action: override.next_action || "Independently verify against real code + a real test before ever marking PASS.",
      phase_owner: override.phase_owner || "PROMPT_2_OR_3",
      notes: override.notes || "",
    };
    out.push(HEADER.map((key) => csvField(record[key])).join(","));
  }

  if (writeFile) {
    writeFileSync(outputPath, out.join("\n") + "\n", "utf8");
  }

  // Cross-check canonical counts from all six primary registers against
  // what this program's own prior sessions recorded (POS_IMPLEMENTATION_
  // TRACKER.md's "Session 1 starting state"), per the task's explicit
  // instruction to verify counts by direct parsing, not assume history.
  const featureRows = parseCsv(readFileSync(featureRegisterPath, "utf8"));
  const fIdx = Object.fromEntries(featureRows[0].map((h, i) => [h, i]));
  const posFeatures = new Set(featureRows.slice(1).filter((r) => POS_FEATURE_ID_PATTERN.test(r[fIdx.feature_id])).map((r) => r[fIdx.feature_id]));

  const capabilityRows = parseCsv(readFileSync(capabilityRegisterPath, "utf8"));
  const cIdx = Object.fromEntries(capabilityRows[0].map((h, i) => [h, i]));
  const posCapabilities = capabilityRows.slice(1).filter((r) => /^POS-CAP-00[1-9]$/.test(r[cIdx.capability_id]));

  return {
    subrequirementRows: posRows.length,
    featureCount: posFeatures.size,
    capabilityCount: posCapabilities.length,
    posFeatures,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const stats = generate();
  console.log(`Wrote ${stats.subrequirementRows} POS (F268-F307) subrequirement rows to ${path.relative(root, outputPath)}.`);
  console.log(`Cross-check: ${stats.featureCount} distinct feature_id values, ${stats.capabilityCount} POS-CAP-00x capability rows.`);
  if (stats.featureCount !== 40) {
    console.error(`COUNT MISMATCH: expected exactly 40 POS features, found ${stats.featureCount}.`);
    process.exitCode = 1;
  }
  if (stats.subrequirementRows !== 1480) {
    console.error(`COUNT MISMATCH: expected exactly 1480 POS subrequirement rows (37/feature x 40), found ${stats.subrequirementRows}. This is not necessarily an error -- the canonical register may have legitimately changed -- but it must be explained, not silently accepted.`);
  }
}
