#!/usr/bin/env node
// T01 "shared platform" (SP010-SP036) verification.
//
// UPDATED (Prompt 2 of 15 — platform reactivation): the capability set
// recovered into docs/frontend-rebuild/recovered-platform-code/ has now
// been ported into services/api/src/core/*.js as framework-agnostic,
// client-injected modules, re-reviewed against current security
// standards, and wired into @vercentlabs/api's barrel export. See
// docs/frontend-rebuild/PLATFORM_PORT_REGISTER.csv for the full per-
// capability source mapping and classification.
//
// Two slices remain intentionally NOT ported yet, pending a dedicated
// overlap audit against packages/reporting-engine and packages/workflows
// (porting them without that check risked creating a duplicate,
// possibly-diverging implementation): shared reporting dataset
// permissions (requireReportDatasetPermission) and the generic
// workflow-run engine (executeWorkflowRun). This script still checks
// those two against the parked snapshot only, and says so explicitly.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const PARKED = "docs/frontend-rebuild/recovered-platform-code/apps/web";
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

// Real, current artifacts.
for (const relative of [
  "database/platform/migrations/035_t01_shared_platform_completion.sql",
  "database/tenant/migrations/075_t01_import_idempotency.sql",
  "services/api/tests/t01-shared-platform-imports.test.mjs",
  "docs/frontend-rebuild/PLATFORM_PORT_REGISTER.csv",
  // The port: live, client-injected services/api modules.
  "services/api/src/core/access-control-runtime.js",
  "services/api/src/core/session.js",
  "services/api/src/core/access-administration.js",
  "services/api/src/core/billing/entitlements.js",
  "services/api/src/core/module-entitlements.js",
  "services/api/src/core/security.js",
  "services/api/src/core/audit-redaction.js",
  "services/api/src/core/attachment-security.js",
  "services/api/src/core/password-policy.js",
  "services/api/src/core/auth-mailer.js",
  "services/api/src/core/api-keys.js",
  "services/api/src/core/oauth.js",
  "services/api/src/core/notification-preferences.js",
  "services/api/src/core/inbound-mail.js",
  "services/api/src/core/tags.js",
  "services/api/src/core/configuration.js",
  "services/api/src/core/privacy.js",
  "services/api/src/core/ai-governance.js",
  "packages/permissions/src/roles.js",
  // Dedicated tests for the ported modules.
  "services/api/tests/platform-access-control-runtime.test.mjs",
  "services/api/tests/platform-session.test.mjs",
  "services/api/tests/platform-access-administration.test.mjs",
  "services/api/tests/platform-module-entitlements.test.mjs",
  "services/api/tests/platform-entitlements.test.mjs",
  "services/api/tests/platform-oauth.test.mjs",
  "services/api/tests/platform-api-keys.test.mjs",
  "services/api/tests/platform-inbound-mail.test.mjs",
  "services/api/tests/platform-security.test.mjs",
  "services/api/tests/platform-attachment-security.test.mjs",
  "services/api/tests/platform-ai-governance.test.mjs",
  "services/api/tests/platform-privacy.test.mjs",
  "services/api/tests/platform-configuration.test.mjs",
  "services/api/tests/platform-tags-notifications.test.mjs",
  "services/api/tests/platform-password-policy-mailer.test.mjs",
  "packages/permissions/tests/roles.test.mjs",
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

// Live ported modules must retain the expected security-relevant symbols
// (this replaces the old "does the parked snapshot still contain X" check
// — the question now is whether the ACTIVE code contains it).
const liveChecks = [
  ["services/api/src/core/api-keys.js", ["createTenantApiKeyMaterial", "requireTenantApiScope"]],
  ["services/api/src/core/oauth.js", ["completeOAuthConnection", "encryptIntegrationCredentials"]],
  ["services/api/src/core/inbound-mail.js", ["verifyInboundMailSignature", "PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT"]],
  ["services/api/src/core/configuration.js", ["setFeatureFlag", "isFeatureFlagEnabled"]],
  ["services/api/src/core/privacy.js", ["assertPrivacyTransition"]],
  ["services/api/src/core/ai-governance.js", ["AI_POLICY_MISSING", "AI_APPROVAL_REQUIRED"]],
  ["services/api/src/core/security.js", ["canonicalAppOrigin", "assertSameOriginOrMobile"]],
];
for (const [relative, tokens] of liveChecks) {
  const source = text(relative);
  for (const token of tokens) {
    if (!source.includes(token)) fail(`live module ${relative} missing expected symbol ${token}`);
  }
}

// Deliberately still-deferred slices (see header comment) — checked
// against the parked snapshot only, and explicitly reported as such.
const deferred = text(`${PARKED}/src/core/shared-platform.ts`);
for (const token of ["requireReportDatasetPermission", "executeWorkflowRun"]) {
  if (!deferred.includes(token)) fail(`parked shared-platform snapshot missing deferred symbol ${token}`);
}

if (failures.length) {
  console.error("T01 SHARED-PLATFORM VALIDATION FAILED");
  for (const item of failures) console.error(" -", item);
  process.exit(1);
}
console.log("T01 SHARED-PLATFORM VALIDATION PASSED (live ported modules + DB/dossier artifacts)");
console.log(` - shared-platform requirement dossiers present: ${expected.length}/${expected.length}`);
console.log(" - platform/access/session/API-key/OAuth/inbound-mail/config/privacy/AI-governance modules are LIVE in services/api/src/core/*.js, each with dedicated tests");
console.log(" - platform 035 and tenant 075 migration artifacts present");
console.log(" - STILL DEFERRED (parked only, pending a reporting-engine/workflows overlap audit): shared report-dataset permissions, generic workflow-run engine — see PLATFORM_PORT_REGISTER.csv");
