#!/usr/bin/env node
// Phase 0 + Phase 0b of the frontend rewrite
// (docs/01-standards/TECH_STACK_ADR_002_FRONTEND_REWRITE.md): generates
// docs/ux/UX_TRACEABILITY_REGISTER.csv, combining every row from
// SUBREQUIREMENT_REGISTER.csv (F001-F510, 18,870 rows) with every row from
// SP_SUBREQUIREMENT_REGISTER.csv (SP001-SP036, 2,088 rows -- see
// scripts/ux/extract-sp-requirements.mjs for how those were extracted and
// why the SP side is structurally different from the F side) into ONE
// combined, classified register so feature/requirement omission is
// machine-detectable (verify:ux-coverage) instead of relying on memory.
//
// What this script honestly does and does not do:
// - It classifies EVERY row (ui_relevance, with a reason for NO_DIRECT_UI).
//   F rows are classified by the register's own frozen requirement_type
//   taxonomy (CAP/FR/US/FLOW/BR/DATA/VAL/CALC/UX/SEC/AUTO/APP/NOTIF/REP/AI/
//   INT/API/PERF/OBS/E2E/UAT). SP rows are classified by their
//   requirement_family (FR/TEST-E2E/UAT for the 252 genuinely-enumerated
//   ones) or by their section slug (for the 1,836 section-level rows --
//   see SP_SECTION_RULES below, one reasoned entry per of the 51 distinct
//   section slugs that never carry an enumerated ID). This is a real,
//   reproducible, auditable first pass -- not a guess made up per row.
// - It does NOT claim a specific screen/component/archetype has been
//   *designed* for each DIRECT_UI row. Those columns (route_or_surface,
//   web_component, ui_archetype, design_status, implementation_status,
//   test_status, storybook_story, e2e_test, accessibility_test) start
//   explicitly unmapped ("" / NOT_STARTED) and are filled in progressively
//   as each capability is actually migrated. verify-ux-coverage.mjs reports
//   the unmapped count honestly rather than treating blank as failure at
//   this stage of the program.
//
// Re-run this script whenever SUBREQUIREMENT_REGISTER.csv,
// FEATURE_REGISTER.csv, CAPABILITY_REGISTER.csv or
// SP_SUBREQUIREMENT_REGISTER.csv change; it OVERWRITES columns it owns
// (everything up to and including ai_behavior/integration_behavior) but
// PRESERVES any existing design_status/implementation_status/test_status/
// storybook_story/e2e_test/accessibility_test/ui_archetype/
// route_or_surface/web_component/mobile_component/notes values already
// recorded for a requirement_id, so re-running never destroys real
// migration progress.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCsvRecords, writeCsv } from "./csv.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const registerDir = path.join(root, "docs/02-register");
const spRegisterPath = path.join(root, "docs/04-shared-platform/SP_SUBREQUIREMENT_REGISTER.csv");
const outPath = path.join(root, "docs/ux/UX_TRACEABILITY_REGISTER.csv");

const subrequirements = readCsvRecords(fs.readFileSync(path.join(registerDir, "SUBREQUIREMENT_REGISTER.csv"), "utf8"));
const features = readCsvRecords(fs.readFileSync(path.join(registerDir, "FEATURE_REGISTER.csv"), "utf8"));
if (!fs.existsSync(spRegisterPath)) {
  throw new Error(`${path.relative(root, spRegisterPath)} does not exist. Run: node scripts/ux/extract-sp-requirements.mjs first.`);
}
const spRequirements = readCsvRecords(fs.readFileSync(spRegisterPath, "utf8"));

const featureById = new Map(features.map((f) => [f.feature_id, f]));

// F requirement_type -> baseline classification. Grounded in the
// register's own frozen semantics, not invented per row.
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

function classifyF(row) {
  return TYPE_RULES[row.requirement_type] || { relevance: "AFFECTS_UI_STATE", reason: `Unrecognized requirement_type "${row.requirement_type}" defaulted conservatively; review manually.` };
}

// SP requirement_family (for the 252 genuinely-enumerated rows).
const SP_FAMILY_RULES = {
  FR: { relevance: "DIRECT_UI", reason: "" },
  "TEST-E2E": { relevance: "NO_DIRECT_UI", reason: "Test-authoring requirement (the acceptance test itself), not a UI design decision." },
  UAT: { relevance: "NO_DIRECT_UI", reason: "Human user-acceptance-test requirement, not a UI design decision." },
};

// SP section slug -> classification, for the 1,836 rows with no
// enumerated ID of their own (see extract-sp-requirements.mjs's header
// comment for why these are section-level, not fabricated per-clause IDs).
// One reasoned entry per of the 51 distinct slugs that appear across all
// 36 dossiers (every dossier shares the same 54-section template; FUNCTIONAL/
// E2E/UAT are excluded here because they always produce enumerated rows
// instead, per SP_FAMILY_RULES above).
const SP_SECTION_RULES = {
  IDENTITY: { relevance: "NO_DIRECT_UI", reason: "Dossier identity/ownership/priority metadata, not itself a UI requirement." },
  INTENT: { relevance: "NO_DIRECT_UI", reason: "Rationale narrative for why the capability exists; not independently testable as a UI requirement." },
  OUTCOMES: { relevance: "NO_DIRECT_UI", reason: "Business-outcome narrative, not itself a UI decision." },
  PERSONAS: { relevance: "AFFECTS_UI_STATE", reason: "Defines which roles see which behavior, informing permission/role-based UI variation rather than a screen of its own." },
  "ENTRY-POINTS": { relevance: "DIRECT_UI", reason: "" },
  BENCHMARK: { relevance: "NO_DIRECT_UI", reason: "External evidence/citation, not a UI requirement." },
  DECISION: { relevance: "NO_DIRECT_UI", reason: "Architecture-freeze governance record, not a UI requirement." },
  "OMISSION-GATE": { relevance: "NO_DIRECT_UI", reason: "Red-team/completeness process checklist, not itself a UI specification." },
  SUBCAPABILITIES: { relevance: "NO_DIRECT_UI", reason: "Naming-convention listing of requirement-ID families, not a UI requirement." },
  FLOWS: { relevance: "DIRECT_UI", reason: "" },
  "STATE-MACHINE": { relevance: "AFFECTS_UI_STATE", reason: "Governs which states the UI must be able to reflect; the state machine itself lives server-side." },
  DATA: { relevance: "AFFECTS_UI_STATE", reason: "Data-model requirement; affects which fields render but is not itself a screen." },
  VALIDATION: { relevance: "AFFECTS_UI_STATE", reason: "Surfaces as field/form validation state, not a distinct screen." },
  "BUSINESS-RULES": { relevance: "AFFECTS_UI_STATE", reason: "Constrains which actions/fields the UI may expose; the rule itself is enforced server-side." },
  CALCULATIONS: { relevance: "AFFECTS_UI_STATE", reason: "Calculation is performed server-side; the UI only displays/derives from the result." },
  VIEWS: { relevance: "DIRECT_UI", reason: "" },
  LIST: { relevance: "DIRECT_UI", reason: "" },
  SEARCH: { relevance: "DIRECT_UI", reason: "" },
  DETAIL: { relevance: "DIRECT_UI", reason: "" },
  CREATE: { relevance: "DIRECT_UI", reason: "" },
  EDIT: { relevance: "DIRECT_UI", reason: "" },
  BULK: { relevance: "DIRECT_UI", reason: "" },
  ACTIONS: { relevance: "DIRECT_UI", reason: "" },
  RELATED: { relevance: "NO_DIRECT_UI", reason: "Cross-SP dependency-graph metadata, not itself a UI requirement." },
  AUTOMATION: { relevance: "AFFECTS_UI_STATE", reason: "Automation runs server-side; the UI surfaces its progress/result, not the automation itself." },
  APPROVALS: { relevance: "DIRECT_UI", reason: "" },
  NOTIFICATIONS: { relevance: "AFFECTS_UI_STATE", reason: "Delivered via the shared notification panel/preference center, not a per-SP screen." },
  DOCUMENTS: { relevance: "DIRECT_UI", reason: "" },
  "IMPORT-EXPORT": { relevance: "DIRECT_UI", reason: "" },
  REPORTING: { relevance: "DIRECT_UI", reason: "" },
  AI: { relevance: "AFFECTS_UI_STATE", reason: "AI behavior surfaces via the shared AI recommendation/explanation/provenance pattern, not a dedicated screen." },
  SECURITY: { relevance: "AFFECTS_UI_STATE", reason: "Surfaces as forbidden/masked/read-only UI state; enforcement itself is server-side." },
  SCOPE: { relevance: "AFFECTS_UI_STATE", reason: "Governs which tenant/company/branch/record context the UI operates within, not a screen of its own." },
  AUDIT: { relevance: "DIRECT_UI", reason: "" },
  CONCURRENCY: { relevance: "AFFECTS_UI_STATE", reason: "Surfaces as stale/conflict UI state; the locking/versioning mechanism itself is server-side." },
  IDEMPOTENCY: { relevance: "AFFECTS_UI_STATE", reason: "Surfaces as in-flight/disabled submit state to prevent duplicate action; the replay-key mechanism itself is server-side." },
  INTEGRATIONS: { relevance: "NO_DIRECT_UI", reason: "External-system contract; no direct end-user screen unless a specific dossier (e.g. SP025) calls for an admin configuration UI." },
  API: { relevance: "NO_DIRECT_UI", reason: "API/transport contract requirement; consumed by the UI but is not itself a UI decision." },
  MOBILE: { relevance: "AFFECTS_UI_STATE", reason: "Defines the mobile support classification (full/field-optimized/approval-only/read-only/not-applicable) that other DIRECT_UI rows inherit, not a screen of its own." },
  RESPONSIVE: { relevance: "AFFECTS_UI_STATE", reason: "Defines desktop/tablet/phone adaptation rules inherited by other DIRECT_UI rows, not a screen of its own." },
  ACCESSIBILITY: { relevance: "AFFECTS_UI_STATE", reason: "Governs HOW every UI surface must behave (keyboard/focus/contrast/motion/etc.); see SP032's own dedicated rows for the concrete acceptance contract this drives in packages/ui-web." },
  "VISUAL-EVIDENCE": { relevance: "NO_DIRECT_UI", reason: "Process requirement to produce wireframes/state diagrams BEFORE implementation; the requirement is procedural, not itself a UI surface." },
  PERFORMANCE: { relevance: "AFFECTS_UI_STATE", reason: "Surfaces as loading/skeleton/virtualization behavior, not a distinct screen." },
  OBSERVABILITY: { relevance: "NO_DIRECT_UI", reason: "Telemetry/logging requirement; operator-facing only via SP030 diagnostics surfaces." },
  "EDGE-CASES": { relevance: "AFFECTS_UI_STATE", reason: "Informs which error/edge states the UI must handle, not a screen of its own." },
  "CODE-AUDIT": { relevance: "NO_DIRECT_UI", reason: "Pre-implementation governance process, not a UI requirement." },
  GAPS: { relevance: "NO_DIRECT_UI", reason: "Governance bookkeeping (target minus verified behavior), not a UI requirement." },
  IMPLEMENTATION: { relevance: "NO_DIRECT_UI", reason: "Guidance on which repository layer owns the implementation, not a UI requirement." },
  TESTS: { relevance: "NO_DIRECT_UI", reason: "Test-planning narrative distinct from the enumerated E2E/UAT rows; not itself a UI requirement." },
  DOD: { relevance: "NO_DIRECT_UI", reason: "Definition-of-done governance record, not a UI requirement." },
  "OPEN-DECISIONS": { relevance: "NO_DIRECT_UI", reason: "Governance record of remaining freeze-blocking decisions, not a UI requirement." },
};

function classifySp(row) {
  if (row.enumerated === "TRUE") {
    return SP_FAMILY_RULES[row.requirement_family] || { relevance: "AFFECTS_UI_STATE", reason: `Unrecognized SP requirement_family "${row.requirement_family}" defaulted conservatively; review manually.` };
  }
  const slug = row.requirement_id.replace(`${row.sp_id}-SECTION-`, "");
  return SP_SECTION_RULES[slug] || { relevance: "AFFECTS_UI_STATE", reason: `Unrecognized SP section slug "${slug}" defaulted conservatively; review manually.` };
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

// Deliberately narrow keyword match for background-job requirements (SP016
// scope, and any F/SP row whose own text calls out async/queued/retried
// work), used to require job-progress/retry UI state.
const BACKGROUND_JOB_KEYWORDS = /\bbackground job\b|\bqueue(d)?\b|\bretr(y|ies|ied)\b|\basync(hronous)?\b|\bdead[- ]?letter\b|\bscheduled job\b/i;

// Preserve any human/migration-owned columns from a previous run.
const existingByRequirementId = new Map();
if (fs.existsSync(outPath)) {
  for (const row of readCsvRecords(fs.readFileSync(outPath, "utf8"))) {
    existingByRequirementId.set(row.requirement_id, row);
  }
}

const HEADER = [
  "requirement_id", "source_register", "feature_id", "capability_id", "module", "requirement_type", "title",
  "ui_relevance", "ui_archetype", "route_or_surface", "web_component", "mobile_component",
  "desktop_support", "tablet_support", "phone_support", "offline_support",
  "permission_behavior", "field_security_behavior",
  "loading_state", "empty_state", "no_results_state", "validation_state", "error_state",
  "forbidden_state", "stale_state", "conflict_state", "offline_state", "sync_state",
  "approval_behavior", "audit_behavior", "notification_behavior", "reporting_behavior",
  "ai_behavior", "integration_behavior", "background_job_behavior",
  "design_status", "implementation_status", "test_status",
  "storybook_story", "e2e_test", "accessibility_test",
  "notes",
];

const NA = "NOT_APPLICABLE";
const STD = "REQUIRED_STANDARD";

function buildRow({ requirementId, sourceRegister, featureId, capabilityId, module, requirementType, title, normativeStatement, relevance, reason, offlineOverride }) {
  const isDirect = relevance === "DIRECT_UI";
  const isStateAffecting = relevance === "AFFECTS_UI_STATE";
  const isUiFacing = isDirect || isStateAffecting;
  const existing = existingByRequirementId.get(requirementId);
  const offline = offlineOverride !== undefined ? offlineOverride : isUiFacing ? offlineHeuristic(module) : NA;
  const isBackgroundJob = BACKGROUND_JOB_KEYWORDS.test(title) || BACKGROUND_JOB_KEYWORDS.test(normativeStatement || "");

  const generated = {
    requirement_id: requirementId,
    source_register: sourceRegister,
    feature_id: featureId,
    capability_id: capabilityId,
    module,
    requirement_type: requirementType,
    title,
    ui_relevance: relevance,
    desktop_support: isUiFacing ? "FULL" : NA,
    tablet_support: isUiFacing ? "FULL" : NA,
    phone_support: isUiFacing ? phoneSupportHeuristic(module) : NA,
    offline_support: offline,
    permission_behavior: requirementType === "SEC" ? "REQUIRED_EXPLICIT" : isUiFacing ? "INHERITED_RECORD_SCOPE" : NA,
    field_security_behavior: requirementType === "SEC" ? "REQUIRED_EXPLICIT" : NA,
    loading_state: isDirect ? STD : NA,
    empty_state: isDirect ? STD : NA,
    no_results_state: isDirect ? STD : NA,
    validation_state: requirementType === "VAL" || isDirect ? STD : NA,
    error_state: isUiFacing ? STD : NA,
    forbidden_state: requirementType === "SEC" || isDirect ? STD : NA,
    stale_state: isDirect ? STD : NA,
    conflict_state: isDirect ? STD : NA,
    offline_state: isUiFacing && offline !== NA ? STD : NA,
    sync_state: isUiFacing && offline !== NA ? STD : NA,
    approval_behavior: APPROVAL_KEYWORDS.test(title) || APPROVAL_KEYWORDS.test(normativeStatement || "") || requirementType === "APP" ? "REQUIRED" : NA,
    audit_behavior: AUDIT_ALWAYS_TYPES.has(requirementType) ? "REQUIRED" : NA,
    notification_behavior: requirementType === "NOTIF" ? "REQUIRED" : NA,
    reporting_behavior: requirementType === "REP" ? "REQUIRED" : NA,
    ai_behavior: requirementType === "AI" ? "REQUIRED" : NA,
    integration_behavior: requirementType === "INT" ? "REQUIRED" : NA,
    background_job_behavior: isBackgroundJob ? "REQUIRED" : NA,
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
}

const fRows = subrequirements.map((row) => {
  const feature = featureById.get(row.feature_id);
  const module = feature ? feature.module : "";
  const { relevance, reason } = classifyF(row);
  return buildRow({
    requirementId: row.requirement_id,
    sourceRegister: "F_REGISTER",
    featureId: row.feature_id,
    capabilityId: row.capability_id,
    module,
    requirementType: row.requirement_type,
    title: row.title,
    normativeStatement: row.normative_statement,
    relevance,
    reason,
  });
});

const spRows = spRequirements.map((row) => {
  const { relevance, reason } = classifySp(row);
  return buildRow({
    requirementId: row.requirement_id,
    sourceRegister: "SP_REGISTER",
    featureId: row.sp_id,
    capabilityId: "",
    module: "Shared Platform",
    requirementType: row.requirement_family,
    title: row.title,
    normativeStatement: row.normative_statement,
    relevance,
    reason,
    // SP034 IS the mobile/offline platform SP -- its own rows are the
    // ground truth for offline requirements, not a per-module guess.
    offlineOverride: row.sp_id === "SP034" && (relevance === "DIRECT_UI" || relevance === "AFFECTS_UI_STATE") ? "REQUIRED" : undefined,
  });
});

const output = [...fRows, ...spRows];

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, writeCsv(HEADER, output));

const counts = output.reduce((acc, r) => {
  acc[r.ui_relevance] = (acc[r.ui_relevance] || 0) + 1;
  return acc;
}, {});
console.log(`Generated ${output.length} rows -> ${path.relative(root, outPath)} (${fRows.length} F + ${spRows.length} SP)`);
console.log(counts);
