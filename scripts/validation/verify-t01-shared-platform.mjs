#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const expected = [
  "SP010","SP011","SP012","SP013","SP017","SP018","SP019","SP020","SP021","SP022","SP023",
  "SP024","SP025","SP026","SP027","SP028","SP031","SP032","SP033","SP034","SP036",
];
const failures = [];
const fail = (message) => failures.push(message);
const text = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));

for (const id of expected) {
  const dossierMatch = fs.readdirSync(path.join(root, "docs/04-shared-platform/requirements"))
    .find((name) => name.startsWith(`${id}-`) && name.endsWith(".md"));
  if (!dossierMatch) fail(`${id}: missing shared-platform requirement dossier`);
}

for (const relative of [
  "database/platform/migrations/035_t01_shared_platform_completion.sql",
  "database/tenant/migrations/075_t01_import_idempotency.sql",
  "apps/web/src/core/shared-platform.ts",
  "apps/web/src/core/attachment-security.ts",
  "apps/web/src/app/(app)/settings/platform/page.tsx",
  "apps/web/tests/t01-shared-platform.test.mjs",
  "services/api/tests/t01-shared-platform-imports.test.mjs",
]) {
  if (!exists(relative)) fail(`required T01 artifact missing: ${relative}`);
}

const platformMigration = text("database/platform/migrations/035_t01_shared_platform_completion.sql");
for (const token of [
  "billing_usage_events","workflow_runs","notification_preferences","inbound_mail_events","tag_definitions","api_keys",
  "oauth_states","oauth_connections","configuration_versions","feature_flags","privacy_retention_policies","privacy_requests",
  "report_definitions","report_runs","ai_policies","ai_requests","ai_evaluations",
]) {
  if (!platformMigration.includes(token)) fail(`platform migration missing ${token}`);
}
if (!/role\.slug IN \('organization_owner','system_administrator'\)/.test(platformMigration)) fail("new platform permissions must be granted to both owner and system administrator");

const platform = text("apps/web/src/core/shared-platform.ts");
for (const token of [
  "createTenantApiKeyMaterial","requireTenantApiScope","completeOAuthConnection","verifyInboundMailSignature","PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT",
  "setFeatureFlag","assertPrivacyTransition","requireReportDatasetPermission","AI_POLICY_MISSING","AI_APPROVAL_REQUIRED","executeWorkflowRun",
]) {
  if (!platform.includes(token)) fail(`shared-platform core missing ${token}`);
}
if (/new URL\(request\.url\)\.origin/.test(text("apps/web/src/app/api/platform/integrations/oauth/route.ts"))) fail("OAuth redirect must not trust request Host/origin");
if (!text("apps/web/src/core/security.ts").includes("canonicalAppOrigin")) fail("canonical app-origin helper missing");

if (failures.length) {
  console.error("T01 SHARED-PLATFORM VALIDATION FAILED");
  for (const item of failures) console.error(" -", item);
  process.exit(1);
}
console.log("T01 SHARED-PLATFORM VALIDATION PASSED");
console.log(` - shared-platform requirement dossiers present: ${expected.length}/${expected.length}`);
console.log(" - API/OAuth/inbound-mail/config/privacy/reporting/AI/workflow security boundaries present");
console.log(" - platform 035 and tenant 075 migration artifacts present");
