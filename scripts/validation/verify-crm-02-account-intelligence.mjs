import assert from "node:assert/strict";
import fs from "node:fs";

const required = [
  "services/api/src/crm/account-intelligence.js",
  "services/api/src/crm/account-intelligence.d.ts",
  "services/api/tests/crm-account-intelligence-crm02.test.mjs",
  "database/tenant/migrations/029_crm_account_intelligence_privacy.sql",
  "apps/web/src/lib/crm-account-intelligence-route.ts",
  "apps/web/src/app/api/crm/accounts/[id]/hierarchy/route.ts",
  "apps/web/src/app/api/crm/accounts/[id]/customer-360/route.ts",
  "apps/web/src/app/api/crm/accounts/[id]/service-events/route.ts",
  "apps/web/src/app/api/crm/account-intelligence/readiness/route.ts",
  "apps/web/src/app/api/crm/privacy/[id]/preview/route.ts",
  "apps/web/src/app/api/crm/privacy/[id]/execute/route.ts",
  "apps/web/src/app/api/crm/privacy/retention/route.ts",
  "apps/web/src/app/(app)/crm/accounts/[id]/page.tsx",
  "apps/web/src/app/(app)/crm/contacts/[id]/page.tsx",
  "apps/web/src/app/(app)/crm/privacy-requests/[id]/page.tsx",
  "apps/web/src/app/(app)/crm/privacy-retention/page.tsx",
  "apps/web/src/app/(app)/crm/readiness/account-intelligence/page.tsx",
  "apps/web/scripts/process-crm-privacy-retention.mjs",
  "apps/web/scripts/verify-crm-account-intelligence-live.mjs",
  "docs/implementation/stages/CRM_02_ACCOUNT_INTELLIGENCE.md",
];
for (const file of required) {
  assert.ok(fs.existsSync(file), `${file} is missing`);
}

const service = fs.readFileSync(
  "services/api/src/crm/account-intelligence.js",
  "utf8",
);
for (const symbol of [
  "crmAccountIntelligenceHash",
  "getAccountHierarchy",
  "setAccountParent",
  "previewAccountMerge",
  "previewContactMerge",
  "mergeAccountsGoverned",
  "mergeContactsGoverned",
  "resolveMergedEntity",
  "recordCustomerServiceEvent",
  "getCustomer360",
  "previewPrivacyRequest",
  "executePrivacyRequest",
  "getPrivacyRetentionDashboard",
  "updatePrivacyRetentionPolicy",
  "runPrivacyRetention",
  "recordCrmAccountIntelligenceAcceptance",
  "getCrmAccountIntelligenceReadiness",
]) {
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));
}
for (const marker of [
  "CRM-027",
  "CRM-028",
  "CRM-029",
  "CRM-030",
  "CRM-035",
  "CRM_ACCOUNT_HIERARCHY_CYCLE",
  "CRM_ACCOUNT_MERGE_DESCENDANT_CONFLICT",
  "CRM_MERGE_RELATIONSHIP_CONFLICT",
  "CRM_PRIVACY_EXECUTION_BLOCKED",
  "CRM_PRIVACY_ERASURE_MODE_INVALID",
  "governed service-event ingestion",
]) {
  assert.match(service, new RegExp(marker));
}

const declarations = fs.readFileSync(
  "services/api/src/crm/account-intelligence.d.ts",
  "utf8",
);
for (const symbol of [
  "getAccountHierarchy",
  "mergeAccountsGoverned",
  "mergeContactsGoverned",
  "getCustomer360",
  "executePrivacyRequest",
  "runPrivacyRetention",
  "getCrmAccountIntelligenceReadiness",
]) {
  assert.match(declarations, new RegExp(`export function ${symbol}`));
}

const migration = fs.readFileSync(
  "database/tenant/migrations/029_crm_account_intelligence_privacy.sql",
  "utf8",
);
for (const table of [
  "crm_account_hierarchy_events",
  "crm_entity_merge_aliases",
  "crm_customer_service_events",
  "crm_privacy_retention_policies",
  "crm_privacy_execution_runs",
  "crm_account_intelligence_acceptance_runs",
]) {
  assert.match(migration, new RegExp(`tenant\\.${table}`));
}
for (const column of [
  "parent_party_id",
  "privacy_status",
  "anonymized_at",
  "retention_until",
  "legal_hold",
]) {
  assert.match(migration, new RegExp(column));
}
for (const marker of [
  "prevent_business_party_hierarchy_cycle",
  "business_parties_parent_party_organization_fkey",
  "crm_customer_service_events_party_organization_fkey",
  "crm_privacy_execution_runs_request_organization_fkey",
  "crm_account_intelligence_immutable_row",
  "FORCE ROW LEVEL SECURITY",
  "tenant_organization_isolation",
]) {
  assert.match(migration, new RegExp(marker));
}

const rootPackage = fs.readFileSync("package.json", "utf8");
for (const marker of [
  '"verify:crm-02"',
  '"verify:crm-02-complete"',
  '"test:crm-02-live"',
]) {
  assert.match(
    rootPackage,
    new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
}
const webPackage = fs.readFileSync("apps/web/package.json", "utf8");
assert.match(webPackage, /crm:account-intelligence:live/);
assert.match(webPackage, /crm:privacy-retention/);

const readiness = fs.readFileSync(
  "apps/web/src/app/api/readiness/route.ts",
  "utf8",
);
assert.match(readiness, /029_crm_account_intelligence_privacy\.sql/);
const smoke = fs.readFileSync(
  "scripts/deployment/smoke-deployment.mjs",
  "utf8",
);
assert.match(smoke, /029_crm_account_intelligence_privacy\.sql/);
const mobile = fs.readFileSync(
  "apps/mobile/src/core/modules/web-parity.ts",
  "utf8",
);
for (const route of [
  "/crm/accounts/[id]",
  "/crm/contacts/[id]",
  "/crm/readiness/account-intelligence",
]) {
  assert.ok(mobile.includes(route), `Mobile parity is missing ${route}`);
}

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
const targetIds = new Set([
  "CRM-027",
  "CRM-028",
  "CRM-029",
  "CRM-030",
  "CRM-035",
]);
const target = evidence
  .map((proof, index) => ({ proof, row: register[index] }))
  .filter(({ proof }) => targetIds.has(proof.id));
assert.equal(target.length, targetIds.size);
for (const { proof, row } of target) {
  assert.equal(row.Status, "Implemented", `${proof.id} register status`);
  assert.equal(
    proof.registerStatus,
    "Implemented",
    `${proof.id} evidence status`,
  );
  assert.equal(proof.acceptanceStatus, "verified", `${proof.id} acceptance`);
  assert.ok(proof.verifiedAt, `${proof.id} verifiedAt is missing`);
  assert.equal(proof.verifiedBy, "crm-02-live-gate");
  assert.ok(proof.implementationPaths.length > 0);
  assert.ok(proof.testPaths.length > 0);
  for (const path of [...proof.implementationPaths, ...proof.testPaths]) {
    assert.ok(
      fs.existsSync(path),
      `${proof.id} evidence path missing: ${path}`,
    );
  }
}

const crmCounts = register
  .filter((row) => row.Module === "CRM")
  .reduce((summary, row) => {
    summary[row.Status] = (summary[row.Status] || 0) + 1;
    return summary;
  }, {});
assert.deepEqual(crmCounts, {
  Partial: 20,
  Missing: 13,
  Implemented: 49,
  "Needs hardening": 1,
});

console.log(
  "CRM-02 contract verified: five capabilities have tenant-safe implementation, executable evidence, transactional acceptance, hierarchy/merge governance, Customer 360 and privacy execution.",
);
