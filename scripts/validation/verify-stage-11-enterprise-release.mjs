import assert from "node:assert/strict";
import fs from "node:fs";

const required = [
  "services/api/src/release/governance.js",
  "services/api/src/release/governance.d.ts",
  "services/api/tests/release-governance-stage11.test.mjs",
  "database/tenant/migrations/027_enterprise_release_governance.sql",
  "apps/web/src/app/api/release/governance/route.ts",
  "apps/web/src/app/api/release/governance/timeline/route.ts",
  "apps/web/src/app/(app)/settings/release-readiness/page.tsx",
  "apps/web/scripts/verify-enterprise-release-governance-live.mjs",
  "scripts/database/rehearse-restore.sh",
  "scripts/validation/report-enterprise-release-readiness.mjs",
  "docs/implementation/stages/STAGE_11_ENTERPRISE_RELEASE_READINESS.md",
  "docs/deployment/enterprise-production-runbook.md",
  "docs/checklists/enterprise-release-checklist.md",
];
for (const file of required)
  assert.ok(fs.existsSync(file), `${file} is missing`);

const service = fs.readFileSync(
  "services/api/src/release/governance.js",
  "utf8",
);
for (const symbol of [
  "releaseContentHash",
  "evaluateReleaseReadiness",
  "buildReleaseGovernanceSummary",
  "releaseContext",
  "getReleaseGovernanceDashboard",
  "recordReleaseCheckRun",
  "captureReleaseReadinessSnapshot",
  "upsertReleaseIncidentCase",
  "getReleaseGovernanceTimeline",
]) {
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));
}
assert.match(
  service,
  /Stage 11 release governance does not mark unsupported benchmark capabilities as complete/,
);
assert.match(service, /maximumOpenCriticalIncidents/);
assert.match(service, /backupMaximumAgeHours/);

const migration = fs.readFileSync(
  "database/tenant/migrations/027_enterprise_release_governance.sql",
  "utf8",
);
for (const table of [
  "release_governance_policies",
  "release_governance_check_runs",
  "release_governance_incident_cases",
  "release_governance_snapshots",
]) {
  assert.match(migration, new RegExp(`tenant\\.${table}`));
}
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
assert.match(migration, /tenant_organization_isolation/);

const packageSource = fs.readFileSync("package.json", "utf8");
for (const marker of [
  '"verify:stage-11"',
  '"test:enterprise-release-live"',
  '"release:benchmark-gate"',
  '"release:production:gate"',
  "verify:419-complete",
]) {
  assert.match(
    packageSource,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
}

const readiness = fs.readFileSync(
  "apps/web/src/app/api/readiness/route.ts",
  "utf8",
);
assert.match(readiness, /029_crm_account_intelligence_privacy\.sql/);
assert.ok(
  fs.existsSync(
    "database/tenant/migrations/027_enterprise_release_governance.sql",
  ),
);
assert.match(readiness, /017_billing_state_machine_and_recovery\.sql/);
assert.match(readiness, /VERCENTLABS_RELEASE_SHA/);

const backup = fs.readFileSync("scripts/database/backup-postgres.sh", "utf8");
assert.match(backup, /manifest\.json/);
assert.match(backup, /sha256sum/);
assert.match(backup, /pg_restore --list/);
const restore = fs.readFileSync("scripts/database/restore-postgres.sh", "utf8");
assert.match(restore, /sha256sum -c/);
assert.match(restore, /--single-transaction/);
assert.match(restore, /CONFIRM_RESTORE/);

const smoke = fs.readFileSync(
  "scripts/deployment/smoke-deployment.mjs",
  "utf8",
);
assert.match(smoke, /029_crm_account_intelligence_privacy\.sql/);
assert.match(smoke, /security header missing/);

const workflow = fs.readFileSync(
  ".github/workflows/release-readiness.yml",
  "utf8",
);
assert.match(workflow, /pnpm test:enterprise-release-live/);
assert.match(workflow, /pnpm report:release-readiness/);

const page = fs.readFileSync(
  "apps/web/src/app/(app)/settings/release-readiness/page.tsx",
  "utf8",
);
assert.match(page, /Production readiness control tower/);
assert.match(page, /419-capability evidence remains separate/);
assert.match(page, /PERMISSIONS\.auditView/);

const mobile = fs.readFileSync(
  "apps/mobile/src/core/modules/web-parity.ts",
  "utf8",
);
assert.match(mobile, /web: "\/settings\/release-readiness"/);

const register = JSON.parse(
  fs.readFileSync(
    "docs/implementation/four-module-feature-register.json",
    "utf8",
  ),
);
const evidence = JSON.parse(
  fs.readFileSync(
    "docs/implementation/four-module-feature-evidence.json",
    "utf8",
  ),
);
assert.equal(register.length, 419);
assert.equal(evidence.length, 419);
for (let index = 0; index < register.length; index += 1) {
  assert.equal(evidence[index].module, register[index].Module);
  assert.equal(evidence[index].capability, register[index].Capability);
}

console.log(
  "Stage 11 enterprise release-readiness contract verified. This verifies governance wiring and truthful gates; production promotion still requires external environment, restore and deployment evidence.",
);
