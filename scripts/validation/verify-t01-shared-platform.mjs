#!/usr/bin/env node
// T01 "shared platform" (SP010-SP036) verification.
//
// IMPORTANT: as of the clean-slate frontend rebuild, the actual
// implementation of this capability set (apps/web/src/core/shared-platform.ts
// and friends) was deleted along with the rest of the old apps/web tree, and
// has no replacement anywhere in the current codebase. The source was
// recovered verbatim into docs/frontend-rebuild/recovered-platform-code/ for
// preservation (see that directory's README), but it is NOT wired into any
// active build — nothing imports it. This script now verifies the *parked
// snapshot* still contains the expected security-relevant patterns, and the
// database/dossier checks that ARE still real. A pass here is NOT evidence
// the shared-platform system works in production; it currently does not
// exist in production. See the README for what needs to happen before this
// can be un-parked.
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

// Real, current artifacts (unaffected by the frontend deletion).
for (const relative of [
  "database/platform/migrations/035_t01_shared_platform_completion.sql",
  "database/tenant/migrations/075_t01_import_idempotency.sql",
  "services/api/tests/t01-shared-platform-imports.test.mjs",
]) {
  if (!exists(relative)) fail(`required T01 artifact missing: ${relative}`);
}

// Parked snapshot (see docs/frontend-rebuild/recovered-platform-code/README.md)
// — verifies the recovered source hasn't itself gone missing, not that it's live.
for (const relative of [
  `${PARKED}/src/core/shared-platform.ts`,
  `${PARKED}/src/core/attachment-security.ts`,
  `${PARKED}/src/core/security.ts`,
  `${PARKED}/src/app/(app)/settings/platform/page.tsx`,
  `${PARKED}/tests/t01-shared-platform.test.mjs`,
]) {
  if (!exists(relative)) fail(`parked T01 snapshot artifact missing: ${relative} (see recovered-platform-code/README.md)`);
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

const platform = text(`${PARKED}/src/core/shared-platform.ts`);
for (const token of [
  "createTenantApiKeyMaterial","requireTenantApiScope","completeOAuthConnection","verifyInboundMailSignature","PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT",
  "setFeatureFlag","assertPrivacyTransition","requireReportDatasetPermission","AI_POLICY_MISSING","AI_APPROVAL_REQUIRED","executeWorkflowRun",
]) {
  if (!platform.includes(token)) fail(`parked shared-platform snapshot missing ${token} (should not happen — the snapshot shouldn't drift; see recovered-platform-code/README.md)`);
}
if (/new URL\(request\.url\)\.origin/.test(text(`${PARKED}/src/app/api/platform/integrations/oauth/route.ts`))) fail("parked OAuth route snapshot: redirect must not trust request Host/origin");
if (!text(`${PARKED}/src/core/security.ts`).includes("canonicalAppOrigin")) fail("parked security snapshot missing canonical app-origin helper");

if (failures.length) {
  console.error("T01 SHARED-PLATFORM VALIDATION FAILED");
  for (const item of failures) console.error(" -", item);
  process.exit(1);
}
console.log("T01 SHARED-PLATFORM VALIDATION PASSED (parked snapshot + live DB/dossier artifacts)");
console.log(` - shared-platform requirement dossiers present: ${expected.length}/${expected.length}`);
console.log(" - parked snapshot still contains expected API/OAuth/inbound-mail/config/privacy/reporting/AI/workflow security patterns");
console.log(" - platform 035 and tenant 075 migration artifacts present");
console.log(" - REMINDER: this capability is NOT wired into any active build — see docs/frontend-rebuild/recovered-platform-code/README.md");
