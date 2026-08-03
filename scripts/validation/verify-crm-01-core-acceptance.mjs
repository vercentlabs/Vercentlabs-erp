import assert from "node:assert/strict";
import fs from "node:fs";

const required = [
  "services/api/src/crm/core-acceptance.js",
  "services/api/src/crm/core-acceptance.d.ts",
  "services/api/tests/crm-core-acceptance-crm01.test.mjs",
  "database/tenant/migrations/028_crm_core_acceptance.sql",
  "apps/web/src/app/api/crm/core-acceptance/route.ts",
  "apps/web/src/app/api/crm/core-acceptance/timeline/route.ts",
  "apps/web/src/app/(app)/crm/readiness/page.tsx",
  "apps/web/scripts/verify-crm-core-acceptance-live.mjs",
  "docs/implementation/stages/CRM_01_CORE_ACCEPTANCE.md",
];
for (const file of required)
  assert.ok(fs.existsSync(file), `${file} is missing`);

const service = fs.readFileSync(
  "services/api/src/crm/core-acceptance.js",
  "utf8",
);
for (const symbol of [
  "crmCoreContentHash",
  "evaluateCrmCoreAcceptance",
  "buildCrmCoreAcceptanceSummary",
  "crmCoreAcceptanceContext",
  "getCrmCoreAcceptanceDashboard",
  "recordCrmCoreAcceptanceRun",
  "captureCrmCoreAcceptanceSnapshot",
  "getCrmCoreAcceptanceTimeline",
]) {
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));
}
assert.match(service, /CRM-010/);
assert.match(service, /CRM-026/);
assert.match(service, /surface:tenant-isolation/);
assert.match(
  service,
  /provider-dependent CRM capabilities remain in later stages/,
);

const migration = fs.readFileSync(
  "database/tenant/migrations/028_crm_core_acceptance.sql",
  "utf8",
);
for (const table of [
  "crm_core_acceptance_runs",
  "crm_core_acceptance_snapshots",
]) {
  assert.match(migration, new RegExp(`tenant\\.${table}`));
}
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
assert.match(migration, /tenant_organization_isolation/);

const rootPackage = fs.readFileSync("package.json", "utf8");
for (const marker of [
  '"verify:crm-01"',
  '"verify:crm-01-complete"',
  '"test:crm-01-live"',
]) {
  assert.match(
    rootPackage,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
}
const webPackage = fs.readFileSync("apps/web/package.json", "utf8");
assert.match(webPackage, /crm:core-acceptance:live/);

const readiness = fs.readFileSync(
  "apps/web/src/app/api/readiness/route.ts",
  "utf8",
);
assert.match(readiness, /028_crm_core_acceptance\.sql/);
const smoke = fs.readFileSync(
  "scripts/deployment/smoke-deployment.mjs",
  "utf8",
);
assert.match(smoke, /028_crm_core_acceptance\.sql/);
const dashboard = fs.readFileSync(
  "apps/web/src/app/(app)/crm/page.tsx",
  "utf8",
);
assert.match(dashboard, /\/crm\/readiness/);
const mobile = fs.readFileSync(
  "apps/mobile/src/core/modules/web-parity.ts",
  "utf8",
);
assert.match(mobile, /web: "\/crm\/readiness"/);

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
const targetIds = Array.from(
  { length: 17 },
  (_, index) => `CRM-${String(index + 10).padStart(3, "0")}`,
);
const target = evidence.filter((row) => targetIds.includes(row.id));
assert.equal(target.length, 17);
for (const proof of target) {
  const row = register[evidence.indexOf(proof)];
  assert.equal(
    row.Status,
    "Implemented",
    `${proof.id} register status must remain Implemented`,
  );
  assert.equal(
    proof.acceptanceStatus,
    "verified",
    `${proof.id} acceptance must be verified`,
  );
  assert.ok(proof.verifiedAt, `${proof.id} verifiedAt is missing`);
  assert.ok(proof.verifiedBy, `${proof.id} verifiedBy is missing`);
  assert.ok(
    proof.implementationPaths.length > 0,
    `${proof.id} implementation paths are missing`,
  );
  assert.ok(proof.testPaths.length > 0, `${proof.id} test paths are missing`);
  for (const path of [...proof.implementationPaths, ...proof.testPaths]) {
    assert.ok(
      fs.existsSync(path),
      `${proof.id} evidence path is missing: ${path}`,
    );
  }
}

console.log(
  "CRM-01 contract verified: CRM-010 through CRM-026 retain truthful Implemented status and now have source, executable-test and local transactional acceptance evidence.",
);
