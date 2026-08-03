import assert from "node:assert/strict";
import fs from "node:fs";

const requiredFiles = [
  "database/tenant/migrations/033_crm_lead_acquisition.sql",
  "services/api/src/crm/lead-acquisition.js",
  "services/api/src/crm/lead-acquisition.d.ts",
  "services/api/tests/crm-lead-acquisition-crm06.test.mjs",
  "apps/web/src/lib/crm-lead-acquisition-route.ts",
  "apps/web/src/app/api/crm/lead-acquisition/dashboard/route.ts",
  "apps/web/src/app/api/crm/lead-acquisition/readiness/route.ts",
  "apps/web/src/app/api/crm/lead-acquisition/imports/route.ts",
  "apps/web/src/app/api/crm/lead-acquisition/forms/route.ts",
  "apps/web/src/app/api/crm/lead-acquisition/connections/route.ts",
  "apps/web/src/app/api/crm/lead-acquisition/enrichment/route.ts",
  "apps/web/src/app/api/crm/lead-acquisition/webhooks/[provider]/route.ts",
  "apps/web/src/app/api/crm/lead-acquisition/public/forms/[key]/route.ts",
  "apps/web/src/app/api/crm/lead-acquisition/public/chat/[token]/route.ts",
  "apps/web/src/app/api/mobile/v1/crm/lead-acquisition/route.ts",
  "apps/web/src/app/(app)/crm/lead-acquisition/page.tsx",
  "apps/web/scripts/verify-crm-lead-acquisition-live.mjs",
  "docs/implementation/stages/CRM_06_LEAD_ACQUISITION.md",
];
for (const file of requiredFiles)
  assert.ok(fs.existsSync(file), `Missing CRM-06 file: ${file}`);

const migration = fs.readFileSync(requiredFiles[0], "utf8");
for (const table of [
  "crm_lead_import_batches",
  "crm_lead_import_rows",
  "crm_lead_acquisition_connections",
  "crm_lead_acquisition_events",
  "crm_chat_sessions",
  "crm_chat_messages",
  "crm_lead_provenance",
  "crm_enrichment_reviews",
  "crm_lead_acquisition_acceptance_runs",
])
  assert.match(
    migration,
    new RegExp(`CREATE TABLE IF NOT EXISTS tenant\\.${table}`),
  );
assert.match(migration, /FORCE ROW LEVEL SECURITY/);
assert.match(migration, /crm_public_acquisition_connection/);
assert.match(migration, /crm_public_capture_form_v2/);
assert.match(migration, /crm_public_chat_session/);
assert.match(migration, /crm_lead_acquisition_evidence_immutable/);

const service = fs.readFileSync(requiredFiles[1], "utf8");
for (const symbol of [
  "normalizeLeadFieldMapping",
  "validateLeadImportRows",
  "verifyLeadAcquisitionWebhookSignature",
  "normalizeLeadAcquisitionEvent",
  "buildLeadFormDefinition",
  "buildEnrichmentReview",
  "previewLeadImport",
  "commitLeadImport",
  "rollbackLeadImport",
  "saveLeadForm",
  "publishLeadForm",
  "submitPublishedLeadForm",
  "createLeadAcquisitionConnection",
  "ingestLeadAcquisitionWebhook",
  "startLeadChatSession",
  "appendLeadChatMessage",
  "queueLeadEnrichment",
  "reviewLeadEnrichment",
  "getLeadAcquisitionDashboard",
  "recordCrmLeadAcquisitionAcceptance",
  "getCrmLeadAcquisitionReadiness",
])
  assert.match(service, new RegExp(`export (async )?function ${symbol}`));
assert.match(service, /timingSafeEqual/);
assert.match(service, /duplicateStrategy/);
assert.match(service, /rolled_back/);
assert.match(service, /acceptedKeys/);

const ids = ["CRM-054", "CRM-056", "CRM-057", "CRM-058", "CRM-059", "CRM-063"];
const evidence = JSON.parse(
  fs.readFileSync(
    "docs/implementation/four-module-feature-evidence.json",
    "utf8",
  ),
);
for (const id of ids) {
  const row = evidence.find((entry) => entry.id === id);
  assert.equal(row?.registerStatus, "Implemented", `${id} is not implemented.`);
  assert.equal(row?.acceptanceStatus, "verified", `${id} is not verified.`);
  assert.ok(row?.implementationPaths?.length >= 5);
  assert.ok(row?.testPaths?.length >= 3);
}

const rootPackage = JSON.parse(fs.readFileSync("package.json", "utf8"));
assert.ok(rootPackage.scripts["verify:crm-06"]);
assert.ok(rootPackage.scripts["verify:crm-06-complete"]);
assert.ok(rootPackage.scripts["test:crm-06-live"]);
const webPackage = JSON.parse(fs.readFileSync("apps/web/package.json", "utf8"));
assert.ok(webPackage.scripts["crm:lead-acquisition:live"]);
assert.match(
  fs.readFileSync("apps/web/src/components/app-shell.tsx", "utf8"),
  /\/crm\/lead-acquisition/,
);
assert.match(
  fs.readFileSync("apps/mobile/src/core/modules/navigation.ts", "utf8"),
  /crm-lead-acquisition/,
);
assert.match(
  fs.readFileSync("apps/mobile/src/core/modules/web-parity.ts", "utf8"),
  /\/crm\/lead-acquisition/,
);

console.log("CRM-06 lead-acquisition contract verified.");
