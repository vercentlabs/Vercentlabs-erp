#!/usr/bin/env node
// Machine-checkable gate for the frontend rewrite program
// (docs/01-standards/TECH_STACK_ADR_002_FRONTEND_REWRITE.md,
// docs/ux/UI_REWRITE_TRACKER.md). Wired as `pnpm verify:ux-coverage`.
//
// HONESTY NOTE (read before "fixing" this script to pass): at the start of
// the rewrite program, most DIRECT_UI requirements genuinely have no
// migrated screen/component yet -- that is real, current, unfinished
// state, not a bug in this script. Section A checks are STRUCTURAL
// completeness of the traceability register itself (every row classified,
// every feature/SP present, every NO_DIRECT_UI reasoned) and always hard-
// fail on a real gap. Section B checks are MIGRATION coverage (does a
// DIRECT_UI row have an actual mapped screen) and are reported with exact
// counts but do not hard-fail the process exit code today, because failing
// today would be true of the whole program, not a regression -- this
// script is deliberately NOT wired into the aggregate `pnpm verify` chain
// for that reason. Once a phase of docs/ux/UI_REWRITE_TRACKER.md commits to
// "no DIRECT_UI regressions in module X", promote that module's Section B
// checks to hard-fail here (see TODO markers below) rather than loosening
// Section A.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readCsvRecords } from "./csv.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const registerDir = path.join(root, "docs/02-register");
const uxPath = path.join(root, "docs/ux/UX_TRACEABILITY_REGISTER.csv");
const spRegisterPath = path.join(root, "docs/04-shared-platform/SP_SUBREQUIREMENT_REGISTER.csv");

if (!fs.existsSync(uxPath)) {
  console.error(`FAIL: ${path.relative(root, uxPath)} does not exist. Run: node scripts/ux/generate-ux-traceability.mjs`);
  process.exit(1);
}

const rows = readCsvRecords(fs.readFileSync(uxPath, "utf8"));
const fRows = rows.filter((r) => r.source_register === "F_REGISTER");
const spRows = rows.filter((r) => r.source_register === "SP_REGISTER");
const features = readCsvRecords(fs.readFileSync(path.join(registerDir, "FEATURE_REGISTER.csv"), "utf8"));

let hardFailures = 0;
const report = (label, count, sample) => {
  console.log(`${count === 0 ? "OK  " : "FAIL"} ${label}: ${count}${sample ? ` (e.g. ${sample.slice(0, 5).join(", ")})` : ""}`);
  return count;
};

// ---------------------------------------------------------------------
// Section A: structural completeness of the traceability register itself.
// Every failure here is a real defect in the register, always hard-fails.
// ---------------------------------------------------------------------

const VALID_RELEVANCE = new Set(["DIRECT_UI", "AFFECTS_UI_STATE", "NO_DIRECT_UI"]);
const unclassified = rows.filter((r) => !VALID_RELEVANCE.has(r.ui_relevance));
hardFailures += report("requirements with no/invalid ui_relevance classification", unclassified.length, unclassified.map((r) => r.requirement_id));

const unreasonedNoDirect = rows.filter((r) => r.ui_relevance === "NO_DIRECT_UI" && !r.notes.trim());
hardFailures += report("NO_DIRECT_UI rows missing an explicit reason", unreasonedNoDirect.length, unreasonedNoDirect.map((r) => r.requirement_id));

const allFeatureIds = new Set(features.map((f) => f.feature_id));
const coveredFeatureIds = new Set(fRows.map((r) => r.feature_id));
const missingFeatures = [...allFeatureIds].filter((id) => !coveredFeatureIds.has(id));
hardFailures += report("F001-F510 features with zero traceability rows", missingFeatures.length, missingFeatures);

const expectedSpIds = Array.from({ length: 36 }, (_, i) => `SP${String(i + 1).padStart(3, "0")}`);
const coveredSpIds = new Set(spRows.map((r) => r.feature_id));
const missingSpGroups = expectedSpIds.filter((id) => !coveredSpIds.has(id));
hardFailures += report("SP001-SP036 with zero rows in the combined UX traceability register", missingSpGroups.length, missingSpGroups);

// Every SP group should carry the same fixed shape (7 enumerated + 51
// section-level = 58 rows) -- a group with a different count means the
// extractor drifted from the dossier template without anyone noticing.
if (fs.existsSync(spRegisterPath)) {
  const spSource = readCsvRecords(fs.readFileSync(spRegisterPath, "utf8"));
  const countBySp = {};
  for (const row of spSource) countBySp[row.sp_id] = (countBySp[row.sp_id] || 0) + 1;
  const wrongCount = expectedSpIds.filter((id) => countBySp[id] !== 58);
  hardFailures += report("SP groups with an unexpected requirement-row count (expected 58 each: 7 enumerated + 51 section-level)", wrongCount.length, wrongCount.map((id) => `${id}=${countBySp[id] || 0}`));
} else {
  hardFailures += report(`missing ${path.relative(root, spRegisterPath)} (run scripts/ux/extract-sp-requirements.mjs)`, 1);
}

// A destructive-sounding requirement (per its title text) must not be
// classified in a way that skips confirmation/recovery UX -- i.e. it must
// at minimum carry a stale/conflict state, since destructive actions are
// exactly where stale-write races matter most.
const DESTRUCTIVE_KEYWORDS = /\b(delete|cancel|reverse|reversal|void|terminat|disposal|dispose|scrap|write-?off|retir(e|ement))\b/i;
const destructiveWithoutRecovery = rows.filter(
  (r) => r.ui_relevance === "DIRECT_UI" && DESTRUCTIVE_KEYWORDS.test(r.title) && r.conflict_state !== "REQUIRED_STANDARD",
);
hardFailures += report("destructive-sounding DIRECT_UI requirements with no conflict/recovery state", destructiveWithoutRecovery.length, destructiveWithoutRecovery.map((r) => r.requirement_id));

// A permission/security requirement must carry an explicit permission
// behavior, not silently inherit.
const secWithoutExplicitPermission = rows.filter((r) => r.requirement_type === "SEC" && r.permission_behavior !== "REQUIRED_EXPLICIT");
hardFailures += report("SEC requirements without an explicit permission_behavior", secWithoutExplicitPermission.length, secWithoutExplicitPermission.map((r) => r.requirement_id));

// An offline-capable row (offline_support REQUIRED) must define offline
// and sync state.
const offlineWithoutSyncState = rows.filter((r) => r.offline_support === "REQUIRED" && (r.offline_state === "NOT_APPLICABLE" || r.sync_state === "NOT_APPLICABLE"));
hardFailures += report("offline-required rows missing offline_state/sync_state", offlineWithoutSyncState.length, offlineWithoutSyncState.map((r) => r.requirement_id));

// Every UI-facing row must carry a mobile/responsive classification
// (phone_support), not a blank -- SP033/SP034 both require this to be an
// explicit decision, never an omission.
const uiFacingWithoutPhoneSupport = rows.filter((r) => (r.ui_relevance === "DIRECT_UI" || r.ui_relevance === "AFFECTS_UI_STATE") && !r.phone_support.trim());
hardFailures += report("UI-facing rows with no phone_support classification", uiFacingWithoutPhoneSupport.length, uiFacingWithoutPhoneSupport.map((r) => r.requirement_id));

// Every row must have SOME value (REQUIRED or NOT_APPLICABLE) in the
// background-job column -- a blank means the register schema drifted
// (e.g. an old cached CSV row from before this column existed survived a
// re-run via the generator's own column-preservation logic).
const backgroundJobUnflagged = rows.filter((r) => !r.background_job_behavior || !r.background_job_behavior.trim());
hardFailures += report("rows missing a background_job_behavior column value (register schema drift)", backgroundJobUnflagged.length, backgroundJobUnflagged.map((r) => r.requirement_id));

console.log("");
console.log(`Section A (structural completeness): ${hardFailures === 0 ? "PASS" : `${hardFailures} FAILING CHECK(S)`}`);

// ---------------------------------------------------------------------
// Section B: migration coverage. Report-only today (see file header) --
// this is the actual, expected-large, honestly-reported backlog.
// ---------------------------------------------------------------------

const direct = rows.filter((r) => r.ui_relevance === "DIRECT_UI");
const directUnmapped = direct.filter((r) => !r.route_or_surface.trim() && !r.web_component.trim());
const directNotStarted = direct.filter((r) => r.implementation_status === "NOT_STARTED");
const directNoStorybook = direct.filter((r) => !r.storybook_story.trim());
const directNoE2e = direct.filter((r) => !r.e2e_test.trim());

console.log("");
console.log("Section B (migration coverage backlog, report-only, does not fail the process today):");
console.log(`  DIRECT_UI total: ${direct.length}`);
console.log(`  DIRECT_UI with no mapped route/component: ${directUnmapped.length}`);
console.log(`  DIRECT_UI implementation_status NOT_STARTED: ${directNotStarted.length}`);
console.log(`  DIRECT_UI with no storybook_story: ${directNoStorybook.length}`);
console.log(`  DIRECT_UI with no e2e_test: ${directNoE2e.length}`);

const byModule = {};
for (const r of direct) {
  byModule[r.module] = byModule[r.module] || { total: 0, mapped: 0 };
  byModule[r.module].total += 1;
  if (r.route_or_surface.trim() || r.web_component.trim()) byModule[r.module].mapped += 1;
}
console.log("");
console.log("  DIRECT_UI mapping coverage by module:");
for (const [module, { total, mapped }] of Object.entries(byModule).sort()) {
  console.log(`    ${module.padEnd(28)} ${mapped}/${total} mapped (${((mapped / total) * 100).toFixed(1)}%)`);
}

// SP032 (accessibility) is the one SP whose own rows should, once real
// implementation starts, show up as accessibility_test-backed -- report
// this specifically rather than only in the generic module rollup, since
// "Shared Platform" as a module would otherwise bury it among all 36 SPs.
const sp032Rows = rows.filter((r) => r.feature_id === "SP032");
const sp032WithAccessibilityTest = sp032Rows.filter((r) => r.accessibility_test.trim());
console.log("");
console.log(`  SP032 (accessibility) rows: ${sp032Rows.length}, with an accessibility_test recorded: ${sp032WithAccessibilityTest.length}`);

if (hardFailures > 0) {
  console.log("");
  console.error(`verify:ux-coverage FAILED: ${hardFailures} structural check(s) failing.`);
  process.exit(1);
}
console.log("");
console.log("verify:ux-coverage: Section A structural checks pass. Section B migration backlog reported above (expected to be large until the rewrite program completes).");
