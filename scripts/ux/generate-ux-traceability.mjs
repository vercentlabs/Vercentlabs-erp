#!/usr/bin/env node
// Phase 0 of the frontend rewrite (docs/01-standards/TECH_STACK_ADR_002_FRONTEND_REWRITE.md):
// generates docs/ux/UX_TRACEABILITY_REGISTER.csv, mapping every one of the
// 18,870 rows in SUBREQUIREMENT_REGISTER.csv to an explicit UI-relevance
// classification, so feature/requirement omission during the rewrite is
// machine-detectable (verify:ux-coverage) instead of relying on memory.
//
// What this script honestly does and does not do:
// - It classifies EVERY row (ui_relevance, with a reason for NO_DIRECT_UI),
//   using the requirement_type taxonomy already frozen in the register
//   (CAP/FR/US/FLOW/BR/DATA/VAL/CALC/UX/SEC/AUTO/APP/NOTIF/REP/AI/INT/API/
//   PERF/OBS/E2E/UAT) plus a small set of keyword heuristics. This is a
//   real, reproducible, auditable first pass -- not a guess made up per row.
// - It does NOT claim a specific screen/component/archetype has been
//   *designed* for each DIRECT_UI row. Those columns (route_or_surface,
//   web_component, ui_archetype, design_status, implementation_status,
//   test_status, storybook_story, e2e_test, accessibility_test) start
//   explicitly unmapped ("" / NOT_STARTED) and are filled in progressively
//   as each capability is actually migrated. verify-ux-coverage.mjs reports
//   the unmapped count honestly rather than treating blank as failure at
//   this stage of the program -- see that script's own comments for which
//   checks are hard-fail vs. coverage-report-only today.
//
// Re-run this script whenever SUBREQUIREMENT_REGISTER.csv,
// FEATURE_REGISTER.csv or CAPABILITY_REGISTER.csv change; it OVERWRITES
// columns it owns (everything up to and including ai_behavior/
// integration_behavior) but PRESERVES any existing design_status/
// implementation_status/test_status/storybook_story/e2e_test/
// accessibility_test/ui_archetype/route_or_surface/web_component/
// mobile_component/notes values already recorded for a requirement_id, so
// re-running never destroys real migration progress.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCsvRecords, writeCsv } from "./csv.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const registerDir = path.join(root, "docs/02-register");
const outPath = path.join(root, "docs/ux/UX_TRACEABILITY_REGISTER.csv");

const subrequirements = readCsvRecords(fs.readFileSync(path.join(registerDir, "SUBREQUIREMENT_REGISTER.csv"), "utf8"));
const features = readCsvRecords(fs.readFileSync(path.join(registerDir, "FEATURE_REGISTER.csv"), "utf8"));

const featureById = new Map(features.map((f) => [f.feature_id, f]));

// requirement_type -> baseline classification. Grounded in the register's
// own frozen semantics (docs/01-standards/FEATURE_SPEC_STANDARD.md /
// SUBREQUIREMENT_REGISTER.csv's own type taxonomy), not invented per row.
const TYPE_RULES = {
  CAP: { relevance: "DIRECT_UI", reason: "" },
  FR: { relevance: "DIRECT_UI", reason: "" },
  US: { relevance: "DIRECT_UI", reason: "" },
  FLOW: { relevance: "DIRECT_UI", reason: "" },
  UX: { relevance: "DIRECT_UI", reason: "" },
  APP: { relevance: "DIRECT_UI", reason: "" },
  REP: { relevance: "DIRECT_UI", reason: "" },
  BR: { relevance: "AFFECTS_UI_STATE", reason: "Business rule constrains which actions/fields the UI may expose or validate; the rule itself lives server-side." },
  DATA: { relevance: "AFFECTS_UI_STATE", reason: "Data-model requirement; affects which fields/columns render but is not itself a screen." },
  VAL: { relevance: "AFFECTS_UI_STATE", reason: "Validation requirement surfaces as a field/form error state, not a distinct screen." },
  CALC: { relevance: "AFFECTS_UI_STATE", reason: "Calculation is performed server-side; the UI only displays/derives from the result." },
  SEC: { relevance: "AFFECTS_UI_STATE", reason: "Security/permission requirement surfaces as forbidden/masked/read-only UI state, enforced authoritatively server-side." },
  AUTO: { relevance: "AFFECTS_UI_STATE", reason: "Automation runs server-side; the UI surfaces its progress/result, not the automation itself." },
  NOTIF: { relevance: "AFFECTS_UI_STATE", reason: "Notification delivery is a platform (SP017) concern surfaced via the shared notification panel, not a per-feature screen." },
  AI: { relevance: "AFFECTS_UI_STATE", reason: "AI behavior is surfaced via the shared AI recommendation/explanation/provenance pattern (SP036), not a dedicated per-feature screen." },
  INT: { relevance: "NO_DIRECT_UI", reason: "Integration/external-system contract; no direct end-user screen unless a dossier explicitly calls for an admin configuration UI (tracked separately under SP025)." },
  API: { relevance: "NO_DIRECT_UI", reason: "API/transport contract requirement; consumed by the UI but is not itself a UI decision." },
  PERF: { relevance: "AFFECTS_UI_STATE", reason: "Performance budget; surfaces as loading/skeleton/virtualization behavior rather than a distinct screen." },
  OBS: { relevance: "NO_DIRECT_UI", reason: "Observability/telemetry requirement; operator-facing only via SP030 diagnostics surfaces, not this feature's own UI." },
  E2E: { relevance: "NO_DIRECT_UI", reason: "Test-authoring requirement (the acceptance test itself), not a UI design decision." },
  UAT: { relevance: "NO_DIRECT_UI", reason: "Human user-acceptance-test requirement, not a UI design decision." },
};

function classify(row) {
  return TYPE_RULES[row.requirement_type] || { relevance: "AFFECTS_UI_STATE", reason: `Unrecognized requirement_type "${row.requirement_type}" defaulted conservatively; review manually.` };
}

function offlineHeuristic(module) {
  // SP034 mobile/offline scope: POS explicitly requires offline continuity
  // (F294-F298 / POS-CAP-006); Stock/Quality/Assets have scanner-driven
  // field workflows that dossiers call out as offline-capable in places.
  // Everything else defaults to NOT_APPLICABLE until its own dossier says
  // otherwise -- this is a coarse starting default, not a final answer.
  if (module === "Point of Sale") return "REQUIRED";
  if (["Stock / Inventory", "Quality", "Assets"].includes(module)) return "PARTIAL_REVIEW_NEEDED";
  return "NOT_APPLICABLE";
}

function phoneSupportHeuristic(module) {
  if (["Point of Sale", "Stock / Inventory", "Quality", "Assets", "HR & Payroll", "Support / Customer Service", "CRM"].includes(module)) return "FIELD_OPTIMIZED";
  if (["Manufacturing", "Projects"].includes(module)) return "APPROVAL_ONLY";
  return "READ_ONLY";
}

// Deliberately narrow: "authoriz(e/ed/ation)" is ubiquitous boilerplate in
// this register's normative_statement text ("MUST let authorized users...")
// and would false-positive almost every row if included. Only match actual
// approval-workflow language.
const APPROVAL_KEYWORDS = /\bapprov(e|al|als|ed|ing)\b|segregation of duties|\bsign-?off\b/i;
const AUDIT_ALWAYS_TYPES = new Set(["FR", "US", "FLOW", "BR", "SEC", "APP", "CAP"]);

// Preserve any human/migration-owned columns from a previous run.
const existingByRequirementId = new Map();
if (fs.existsSync(outPath)) {
  for (const row of readCsvRecords(fs.readFileSync(outPath, "utf8"))) {
    existingByRequirementId.set(row.requirement_id, row);
  }
}

const HEADER = [
  "requirement_id", "feature_id", "capability_id", "module", "requirement_type", "title",
  "ui_relevance", "ui_archetype", "route_or_surface", "web_component", "mobile_component",
  "desktop_support", "tablet_support", "phone_support", "offline_support",
  "permission_behavior", "field_security_behavior",
  "loading_state", "empty_state", "no_results_state", "validation_state", "error_state",
  "forbidden_state", "stale_state", "conflict_state", "offline_state", "sync_state",
  "approval_behavior", "audit_behavior", "notification_behavior", "reporting_behavior",
  "ai_behavior", "integration_behavior",
  "design_status", "implementation_status", "test_status",
  "storybook_story", "e2e_test", "accessibility_test",
  "notes",
];

const NA = "NOT_APPLICABLE";
const STD = "REQUIRED_STANDARD";

const output = subrequirements.map((row) => {
  const feature = featureById.get(row.feature_id);
  const module = feature ? feature.module : "";
  const { relevance, reason } = classify(row);
  const isDirect = relevance === "DIRECT_UI";
  const isStateAffecting = relevance === "AFFECTS_UI_STATE";
  const isUiFacing = isDirect || isStateAffecting;
  const existing = existingByRequirementId.get(row.requirement_id);

  const generated = {
    requirement_id: row.requirement_id,
    feature_id: row.feature_id,
    capability_id: row.capability_id,
    module,
    requirement_type: row.requirement_type,
    title: row.title,
    ui_relevance: relevance,
    desktop_support: isUiFacing ? "FULL" : NA,
    tablet_support: isUiFacing ? "FULL" : NA,
    phone_support: isUiFacing ? phoneSupportHeuristic(module) : NA,
    offline_support: isUiFacing ? offlineHeuristic(module) : NA,
    permission_behavior: row.requirement_type === "SEC" ? "REQUIRED_EXPLICIT" : isUiFacing ? "INHERITED_RECORD_SCOPE" : NA,
    field_security_behavior: row.requirement_type === "SEC" ? "REQUIRED_EXPLICIT" : NA,
    loading_state: isDirect ? STD : NA,
    empty_state: isDirect ? STD : NA,
    no_results_state: isDirect ? STD : NA,
    validation_state: row.requirement_type === "VAL" || isDirect ? STD : NA,
    error_state: isUiFacing ? STD : NA,
    forbidden_state: row.requirement_type === "SEC" || isDirect ? STD : NA,
    stale_state: isDirect ? STD : NA,
    conflict_state: isDirect ? STD : NA,
    offline_state: isUiFacing && offlineHeuristic(module) !== NA ? STD : NA,
    sync_state: isUiFacing && offlineHeuristic(module) !== NA ? STD : NA,
    approval_behavior: APPROVAL_KEYWORDS.test(row.title) || APPROVAL_KEYWORDS.test(row.normative_statement || "") || row.requirement_type === "APP" ? "REQUIRED" : NA,
    audit_behavior: AUDIT_ALWAYS_TYPES.has(row.requirement_type) ? "REQUIRED" : NA,
    notification_behavior: row.requirement_type === "NOTIF" ? "REQUIRED" : NA,
    reporting_behavior: row.requirement_type === "REP" ? "REQUIRED" : NA,
    ai_behavior: row.requirement_type === "AI" ? "REQUIRED" : NA,
    integration_behavior: row.requirement_type === "INT" ? "REQUIRED" : NA,
    notes: reason,
  };

  // Columns this script never overwrites once a human/migration pass has
  // set them -- default to explicit "NOT_STARTED"/blank on first
  // generation only.
  const preserved = {
    ui_archetype: existing?.ui_archetype || "",
    route_or_surface: existing?.route_or_surface || "",
    web_component: existing?.web_component || "",
    mobile_component: existing?.mobile_component || "",
    design_status: existing?.design_status || (isUiFacing ? "NOT_STARTED" : NA),
    implementation_status: existing?.implementation_status || (isUiFacing ? "NOT_STARTED" : NA),
    test_status: existing?.test_status || (isUiFacing ? "NOT_STARTED" : NA),
    storybook_story: existing?.storybook_story || "",
    e2e_test: existing?.e2e_test || "",
    accessibility_test: existing?.accessibility_test || "",
  };

  return { ...generated, ...preserved };
});

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, writeCsv(HEADER, output));

const counts = output.reduce((acc, r) => {
  acc[r.ui_relevance] = (acc[r.ui_relevance] || 0) + 1;
  return acc;
}, {});
console.log(`Generated ${output.length} rows -> ${path.relative(root, outPath)}`);
console.log(counts);
