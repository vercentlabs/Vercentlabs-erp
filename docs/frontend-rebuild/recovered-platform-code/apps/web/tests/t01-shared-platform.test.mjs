import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(ROOT, relative));

const migration = read("database/platform/migrations/035_t01_shared_platform_completion.sql");
const billing = read("apps/web/src/core/billing.ts");
const platform = read("apps/web/src/core/shared-platform.ts");
const searchRoute = read("apps/web/src/app/api/search/route.ts");
const integrationsPage = read("apps/web/src/app/(app)/integrations/page.tsx");
const attachmentSecurity = read("apps/web/src/core/attachment-security.ts");
const attachmentUpload = read("apps/web/src/app/api/crm/leads/[id]/attachments/route.ts");
// F017 attachment-generalization pass: the scan-status gate moved from this
// route into the canonical attachment domain module (attachments-
// operations.js) that Account/Contact/Opportunity's routes now also call.
const attachmentDomain = read("services/api/src/modules/crm/seller-activity-and-follow-up-workspace/attachments/attachments-operations.js");

const evidence = {
  SP010: () => {
    assert.match(read("apps/web/src/core/module-access.ts"), /assertModuleAccessible/);
    assert.match(billing, /assertModuleEntitlement/);
  },
  SP011: () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS billing_usage_events/);
    assert.match(billing, /ON CONFLICT \(organization_id, metric, idempotency_key\) DO NOTHING/);
    assert.match(billing, /BILLING_IDEMPOTENCY_CONFLICT/);
  },
  SP012: () => {
    assert.match(read("packages/workflows/src/index.js"), /assertSeparationOfDuties/);
    assert.match(read("apps/web/src/app/api/approvals/route.ts"), /requirePermissionFromSession/);
  },
  SP013: () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS workflow_runs/);
    assert.match(platform, /executeWorkflowRun/);
    assert.match(platform, /ON CONFLICT \(organization_id,idempotency_key\) DO NOTHING/);
    assert.match(platform, /requires_normal_approval_command/);
  },
  SP017: () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS notification_preferences/);
    assert.match(platform, /setNotificationPreference/);
    assert.ok(exists("apps/web/src/core/components/notification-preferences.tsx"));
  },
  SP018: () => {
    assert.match(read("apps/web/src/core/mailer.ts"), /SMTP|email/i);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS inbound_mail_events/);
    assert.match(platform, /verifyInboundMailSignature/);
    assert.ok(exists("apps/web/src/app/api/platform/mail/inbound/route.ts"));
  },
  SP019: () => {
    assert.match(read("packages/document-engine/src/index.js"), /validateAttachment/);
    assert.match(attachmentSecurity, /ATTACHMENT_SCAN_MODE/);
    assert.match(attachmentUpload, /scanAttachmentForUpload/);
    assert.match(attachmentDomain, /scan_status IN \('clean','not_applicable'\)/);
  },
  SP020: () => {
    assert.match(searchRoute, /requireApiWorkspace/);
    assert.match(searchRoute, /TOTAL_RESULT_LIMIT = 20/);
    assert.doesNotMatch(searchRoute, /SELECT \* FROM/i);
  },
  SP021: () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS tag_definitions/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS entity_tags/);
    assert.match(read("database/platform/migrations/002_platform_foundation.sql"), /custom_field_definitions/);
  },
  SP022: () => {
    assert.match(read("services/api/src/core/document-numbering.js"), /document_sequences|number/i);
    assert.match(read("database/platform/migrations/002_platform_foundation.sql"), /numbering_series/);
  },
  SP023: () => {
    const importRoute = read("apps/web/src/app/api/business-data/[resource]/import/route.ts");
    assert.match(importRoute, /Idempotency-Key|idempotency-key/);
    assert.match(importRoute, /imports_rows_monthly/);
    assert.match(read("apps/web/src/modules/crm/prospect-and-relationship-master-data/leads-workspace.tsx"), /idempotency/i);
  },
  SP024: () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS api_keys/);
    assert.match(platform, /requireTenantApiScope/);
    assert.ok(exists("apps/web/src/app/api/v1/platform/context/route.ts"));
    assert.match(read("apps/web/src/core/http.ts"), /class HttpError/);
  },
  SP025: () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS oauth_states/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS oauth_connections/);
    assert.match(platform, /aes-256-gcm/);
    assert.match(platform, /consumed_at=now\(\)/);
    assert.match(read("services/worker/src/index.js"), /webhook|outbound/i);
  },
  SP026: () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS configuration_versions/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS feature_flags/);
    const configFn = platform.slice(platform.indexOf("export async function writeConfigurationVersion"), platform.indexOf("export async function setFeatureFlag"));
    assert.match(configFn, /pg_advisory_xact_lock/);
    assert.match(configFn, /max\(version\)/);
    assert.doesNotMatch(configFn, /FOR UPDATE/);
  },
  SP027: () => {
    const localization = read("packages/localization/src/index.js");
    assert.match(localization, /assertTimeZone/);
    assert.match(localization, /formatMoney/);
    assert.match(localization, /fiscalYearFor/);
  },
  SP028: () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS privacy_retention_policies/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS privacy_requests/);
    assert.match(platform, /assertPrivacyTransition/);
    assert.match(platform, /writeRetentionPolicy/);
  },
  SP031: () => {
    assert.match(read("packages/reporting-engine/src/index.js"), /createReportRegistry/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS report_definitions/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS report_runs/);
    assert.match(platform, /PLATFORM_REPORT_DATASETS/);
  },
  SP032: () => {
    assert.ok(exists("packages/shared-ui"));
    const shell = read("apps/web/src/app/(app)/layout.tsx");
    assert.match(shell, /AppShell|app-shell/i);
    assert.ok(exists("apps/web/tests/search-security.test.mjs"));
  },
  SP033: () => {
    assert.ok(exists("apps/web/src/shared/components"));
    assert.ok(exists("apps/web/src/core/components"));
    assert.match(read("docs/01-standards/EXPERIENCE_KERNEL_STANDARD.md"), /Experience Kernel/i);
  },
  SP034: () => {
    assert.match(read("database/platform/migrations/011_mobile_sessions.sql"), /idempotency/i);
    assert.ok(exists("apps/mobile/src"));
    assert.match(read("apps/mobile/ARCHITECTURE.md"), /offline|sync/i);
  },
  SP036: () => {
    assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_policies/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_requests/);
    assert.match(migration, /CREATE TABLE IF NOT EXISTS ai_evaluations/);
    assert.match(platform, /AI_POLICY_MISSING/);
    assert.match(platform, /AI_APPROVAL_REQUIRED/);
  },
};

for (const [spId, verify] of Object.entries(evidence)) {
  test(`T01 ${spId}: implementation evidence is materialized`, verify);
}

test("T01 security: API-key secrets are one-way hashed and raw tokens are returned only on creation", () => {
  assert.match(platform, /key_hash/);
  assert.match(platform, /createHash\("sha256"\)/);
  assert.doesNotMatch(migration, /raw_token|plaintext_token|api_key_secret/i);
  assert.match(integrationsPage, /API-key secrets are stored only as SHA-256 hashes/);
});

test("T01 security: OAuth provider calls do not execute inside the state-consumption database transaction", () => {
  const fn = platform.slice(platform.indexOf("export async function completeOAuthConnection"), platform.indexOf("export async function listOAuthConnections"));
  const fetchIndex = fn.indexOf("await fetch");
  const claimIndex = fn.indexOf("const current = await transaction");
  const upsertIndex = fn.indexOf("const result = await query");
  assert.ok(claimIndex >= 0 && fetchIndex > claimIndex && upsertIndex > fetchIndex);
  const transactionSegment = fn.slice(claimIndex, fetchIndex);
  assert.doesNotMatch(transactionSegment, /fetch\(/);
});

test("T01 security: AI execution remains fail-closed without explicit policy and approval", () => {
  assert.match(platform, /AI_POLICY_MISSING/);
  assert.match(platform, /allowExecute/);
  assert.match(platform, /AI_APPROVAL_REQUIRED/);
  assert.doesNotMatch(platform, /allow_execute:\s*true/);
});

test("T01 security: generic workflow engine cannot invoke arbitrary business commands", () => {
  const fn = platform.slice(platform.indexOf("export async function executeWorkflowRun"));
  assert.match(fn, /type === "notify"/);
  assert.match(fn, /type === "approval"/);
  assert.match(fn, /is not allowed by the shared-platform engine/);
  assert.doesNotMatch(fn, /UPDATE tenant\.|INSERT INTO tenant\./i);
});

test("T01 UX truth: integrations page no longer claims tenant API keys or OAuth exchange are absent", () => {
  assert.doesNotMatch(integrationsPage, /Tenant-issued API keys \/ developer apps/);
  assert.doesNotMatch(integrationsPage, /token exchange step is missing/);
  assert.match(integrationsPage, /API keys &amp; OAuth/);
});

test("T01 SP021: controlled tags have tenant-scoped definition/assignment commands and no arbitrary code surface", () => {
  const tagsRoute = read("apps/web/src/app/api/platform/tags/route.ts");
  assert.match(platform, /createTagDefinition/);
  assert.match(platform, /assignEntityTag/);
  assert.match(platform, /organization_id=\$1/);
  assert.match(tagsRoute, /platform\.extensibility\.manage/);
  assert.doesNotMatch(tagsRoute, /eval\(|new Function|rawSql/i);
});

test("T01 SP023: master-data imports require a stable idempotency key and replay a durable job result", () => {
  const route = read("apps/web/src/app/api/business-data/[resource]/import/route.ts");
  const service = read("services/api/src/core/master-data.js");
  const tenantMigration = read("database/tenant/migrations/075_t01_import_idempotency.sql");
  assert.match(route, /BUSINESS_DATA_IMPORT_IDEMPOTENCY_REQUIRED/);
  assert.match(route, /beginImportJob/);
  assert.match(route, /resultPayload/);
  assert.match(service, /ON CONFLICT \(organization_id, resource, idempotency_key\)/);
  assert.match(service, /BUSINESS_DATA_IMPORT_IDEMPOTENCY_CONFLICT/);
  assert.match(tenantMigration, /master_data_import_jobs_idempotency_uidx/);
});

test("T01 SP023 replay payload is runtime-validated and returns one complete typed outcome", () => {
  const route = read("apps/web/src/app/api/business-data/[resource]/import/route.ts");
  assert.match(route, /type ImportOutcome =/);
  assert.match(route, /parseStoredImportOutcome/);
  assert.match(route, /tenantTransaction<ImportOutcome>/);
  assert.match(route, /BUSINESS_DATA_IMPORT_REPLAY_INVALID/);
  assert.match(route, /processedRows !== stored\.succeededRows \+ stored\.failedRows/);
  assert.doesNotMatch(route, /\.\.\.\(replay as Record<string, unknown>\)/);
});

test("T01 SP026: feature flags serialize writers and reject ambiguous effective windows", () => {
  const fn = platform.slice(platform.indexOf("export async function setFeatureFlag"), platform.indexOf("export async function isFeatureFlagEnabled"));
  assert.match(fn, /pg_advisory_xact_lock/);
  assert.match(fn, /effective_from >= \$3/);
  assert.match(fn, /UPDATE feature_flags SET effective_to=\$3/);
});

test("T01 SP028: retention policy versions serialize writers and close prior effective windows", () => {
  const fn = platform.slice(platform.indexOf("export async function writeRetentionPolicy"), platform.indexOf("export async function listRetentionPolicies"));
  assert.match(fn, /pg_advisory_xact_lock/);
  assert.match(fn, /effective_from >= \$3/);
  assert.match(fn, /UPDATE privacy_retention_policies SET effective_to=\$3/);
});

test("T01 SP031: shared report launches cannot bypass the underlying module report permission", () => {
  assert.match(platform, /requireReportDatasetPermission/);
  assert.match(platform, /crm\.reports\.view/);
  assert.match(platform, /accounting\.reports\.view/);
  assert.match(platform, /PLATFORM_REPORT_SCHEDULE_UNAVAILABLE/);
  assert.doesNotMatch(platform, /SELECT \* FROM .*report/i);
});

test("T01 SP036: AI tool keys are bounded by the active organization policy", () => {
  assert.match(platform, /allowed_tools/);
  assert.match(platform, /AI_TOOL_DENIED/);
  assert.match(platform, /allowedTools\.includes\(actionKey\)/);
});

test("T01 UX: platform governance is a real settings surface with permission-gated operator controls", () => {
  const settings = read("apps/web/src/app/(app)/settings/page.tsx");
  const page = read("apps/web/src/app/(app)/settings/platform/page.tsx");
  const consoleUi = read("apps/web/src/core/components/platform-governance-console.tsx");
  assert.match(settings, /\/settings\/platform/);
  assert.match(page, /PlatformGovernanceConsole/);
  for (const label of ["Effective-dated configuration", "Controlled extensibility", "Privacy, retention", "Governed shared report", "AI governance policy"]) {
    assert.match(consoleUi, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
});


test("T01 security: OAuth redirects are pinned to configured APP_URL, never the request Host", () => {
  const security = read("apps/web/src/core/security.ts");
  const beginRoute = read("apps/web/src/app/api/platform/integrations/oauth/route.ts");
  const callbackRoute = read("apps/web/src/app/api/platform/integrations/oauth/callback/[provider]/route.ts");
  assert.match(security, /export function canonicalAppOrigin/);
  assert.match(security, /process\.env\.APP_URL/);
  assert.match(beginRoute, /canonicalAppOrigin\(\)/);
  assert.doesNotMatch(beginRoute, /new URL\(request\.url\)\.origin/);
  assert.match(callbackRoute, /new URL\("\/integrations", canonicalAppOrigin\(\)\)/);
  assert.doesNotMatch(callbackRoute, /new URL\("\/integrations", request\.url\)/);
});

test("T01 security: inbound mail idempotency binds provider message id to the original payload digest", () => {
  const fn = platform.slice(platform.indexOf("export async function recordInboundMailEvent"), platform.indexOf("export async function createTagDefinition"));
  assert.match(fn, /SELECT id,payload_digest FROM inbound_mail_events/);
  assert.match(fn, /PLATFORM_INBOUND_MAIL_IDEMPOTENCY_CONFLICT/);
  assert.match(fn, /payload_digest/);
});

test("T01 security: organization owners receive the new shared-platform management permissions", () => {
  assert.match(migration, /role\.slug IN \('organization_owner','system_administrator'\)/);
  assert.doesNotMatch(migration, /role\.is_system=true\s+AND role\.slug IN \('organization_owner','system_administrator'\)/);
});

test("T01 security: credential revocation and privacy rights are not blocked by commercial write state", () => {
  const keyDelete = read("apps/web/src/app/api/platform/integrations/api-keys/[id]/route.ts");
  const oauthDelete = read("apps/web/src/app/api/platform/integrations/oauth/[id]/route.ts");
  const privacyRoute = read("apps/web/src/app/api/platform/privacy/route.ts");
  assert.doesNotMatch(keyDelete, /requireBillingWriteAccess/);
  assert.doesNotMatch(oauthDelete, /requireBillingWriteAccess/);
  assert.doesNotMatch(privacyRoute, /requireBillingWriteAccess/);
  assert.match(keyDelete, /requireApiPermission\("integrations\.manage"\)/);
  assert.match(privacyRoute, /requireApiPermission\("platform\.privacy\.manage"\)/);
});

test("T01 AI policy writes require an explicit complete boolean policy boundary", () => {
  const route = read("apps/web/src/app/api/platform/ai/route.ts");
  for (const field of ["enabled", "allowRead", "allowPropose", "allowExecute", "requiresApproval"]) {
    assert.match(route, new RegExp(`${field}: z\\.boolean\\(\\)(?!\\.optional)`));
  }
});

test("T01 security: company administrators do not inherit organization-level platform governance permissions", () => {
  const accessControl = read("apps/web/src/core/access-control.ts");
  for (const permission of [
    "integrations.manage",
    "platform.configuration.manage",
    "platform.extensibility.manage",
    "platform.privacy.manage",
    "platform.reports.manage",
    "platform.ai.manage",
    "platform.workflows.manage",
  ]) {
    assert.match(accessControl, new RegExp(`\\"${permission.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\"`));
  }
  const companyAdminStart = accessControl.indexOf('slug: "company_administrator"');
  const employeeStart = accessControl.indexOf('slug: "employee"', companyAdminStart);
  assert.ok(companyAdminStart >= 0 && employeeStart > companyAdminStart);
  const companyAdmin = accessControl.slice(companyAdminStart, employeeStart);
  assert.match(companyAdmin, /platform\.configuration\.manage/);
  assert.match(companyAdmin, /platform\.workflows\.manage/);
  assert.match(companyAdmin, /!\[/);
});

test("T01 security: platform-governance privilege boundary stays consistent for existing and newly provisioned organizations", () => {
  const accessControl = read("apps/web/src/core/access-control.ts");
  const migration = read("database/platform/migrations/035_t01_shared_platform_completion.sql");
  const companyAdminStart = accessControl.indexOf('slug: "company_administrator"');
  const employeeStart = accessControl.indexOf('slug: "employee"', companyAdminStart);
  assert.ok(companyAdminStart >= 0 && employeeStart > companyAdminStart);
  const companyAdmin = accessControl.slice(companyAdminStart, employeeStart);
  for (const permission of [
    "integrations.manage",
    "platform.configuration.manage",
    "platform.extensibility.manage",
    "platform.privacy.manage",
    "platform.reports.manage",
    "platform.ai.manage",
    "platform.workflows.manage",
  ]) {
    assert.match(companyAdmin, new RegExp(permission.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(migration, new RegExp(permission.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(migration, /role\.slug='company_administrator'/);
  assert.match(migration, /DELETE FROM role_permissions/);
});
