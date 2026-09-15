#!/usr/bin/env node
// Generates docs/frontend-rebuild/CRM_REQUIREMENT_TRACEABILITY.csv from the
// canonical docs/02-register/SUBREQUIREMENT_REGISTER.csv (CRM F001-F030
// rows only). Default status is NOT_STARTED for every row; a hand-curated
// overrides file supplies real evidence for requirements this rebuild has
// actually verified. Re-run whenever overrides change — this script is the
// only thing that may write the traceability CSV, so the two never drift.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const sourcePath = path.join(root, "docs/02-register/SUBREQUIREMENT_REGISTER.csv");
const overridesPath = path.join(root, "docs/frontend-rebuild/CRM_TRACEABILITY_OVERRIDES.json");
const outputPath = path.join(root, "docs/frontend-rebuild/CRM_REQUIREMENT_TRACEABILITY.csv");

function parseCsv(text) {
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

// Default DIRECT_UI / AFFECTS_UI_STATE / NO_DIRECT_UI classification by
// requirement_type. This is a documented heuristic, not a per-row manual
// read of all 1,110 normative statements — see CRM_CLEAN_REBUILD_REGISTER.md
// "Traceability methodology" for the rationale and the explicit list of
// features where classification HAS been hand-verified against the actual
// dossier text (currently F001 only).
const TYPE_CLASSIFICATION = {
  UX: "DIRECT_UI",
  US: "DIRECT_UI",
  APP: "DIRECT_UI",
  FR: "AFFECTS_UI_STATE",
  FLOW: "AFFECTS_UI_STATE",
  E2E: "AFFECTS_UI_STATE",
  UAT: "AFFECTS_UI_STATE",
  NOTIF: "AFFECTS_UI_STATE",
  REP: "AFFECTS_UI_STATE",
  BR: "NO_DIRECT_UI",
  VAL: "NO_DIRECT_UI",
  CALC: "NO_DIRECT_UI",
  AUTO: "NO_DIRECT_UI",
  SEC: "NO_DIRECT_UI",
  DATA: "NO_DIRECT_UI",
  API: "NO_DIRECT_UI",
  INT: "NO_DIRECT_UI",
  OBS: "NO_DIRECT_UI",
  PERF: "NO_DIRECT_UI",
  AI: "NO_DIRECT_UI",
  CAP: "NO_DIRECT_UI",
};

const HEADER = [
  "requirement_id", "feature_id", "capability_id", "requirement_type",
  "requirement_classification", "backend_evidence", "api_evidence",
  "ui_route", "ui_screen", "ui_component", "permission_behavior",
  "responsive_behavior", "test_evidence", "implementation_status", "notes",
];

const csvText = readFileSync(sourcePath, "utf8");
const rows = parseCsv(csvText);
const header = rows[0];
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const crmRows = rows.slice(1).filter((r) => /^F0[0-2]\d$|^F030$/.test(r[idx.feature_id]));

let overrides = {};
try {
  overrides = JSON.parse(readFileSync(overridesPath, "utf8"));
} catch {
  overrides = {};
}

const out = [HEADER.join(",")];
for (const r of crmRows) {
  const requirementId = r[idx.requirement_id];
  const featureId = r[idx.feature_id];
  const capabilityId = r[idx.capability_id];
  const requirementType = r[idx.requirement_type];
  const override = overrides[requirementId] || {};
  const classification = override.requirement_classification || TYPE_CLASSIFICATION[requirementType] || "NO_DIRECT_UI";
  const record = {
    requirement_id: requirementId,
    feature_id: featureId,
    capability_id: capabilityId,
    requirement_type: requirementType,
    requirement_classification: classification,
    backend_evidence: override.backend_evidence || "",
    api_evidence: override.api_evidence || "",
    ui_route: override.ui_route || "",
    ui_screen: override.ui_screen || "",
    ui_component: override.ui_component || "",
    permission_behavior: override.permission_behavior || "",
    responsive_behavior: override.responsive_behavior || "",
    test_evidence: override.test_evidence || "",
    implementation_status: override.implementation_status || "NOT_STARTED",
    notes: override.notes || "Clean rebuild has not yet reached this feature; see CRM_CLEAN_REBUILD_REGISTER.md tranche plan.",
  };
  out.push(HEADER.map((key) => csvField(record[key])).join(","));
}

writeFileSync(outputPath, out.join("\n") + "\n", "utf8");
console.log(`Wrote ${crmRows.length} CRM requirement rows to ${path.relative(root, outputPath)}`);

const counts = {};
for (const r of crmRows) {
  const override = overrides[r[idx.requirement_id]] || {};
  const status = override.implementation_status || "NOT_STARTED";
  counts[status] = (counts[status] || 0) + 1;
}
console.log("Status counts:", counts);
