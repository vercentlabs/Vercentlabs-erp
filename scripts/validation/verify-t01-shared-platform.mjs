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

function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ""; }
    else if (ch === '\n') { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field.length || row.length) { row.push(field.replace(/\r$/, "")); rows.push(row); }
  const nonempty = rows.filter((item) => item.some((value) => value !== ""));
  if (!nonempty.length) return [];
  const headers = nonempty[0];
  return nonempty.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

const waveRows = parseCsv(text("docs/04-shared-platform/SHARED_PLATFORM_IMPLEMENTATION_WAVE_REGISTER.csv"));
const t01 = waveRows.filter((row) => row.primary_wave === "T01").map((row) => row.sp_id);
if (JSON.stringify(t01) !== JSON.stringify(expected)) fail(`canonical T01 SP set mismatch: ${t01.join(",")}`);

const register = parseCsv(text("docs/04-shared-platform/SHARED_PLATFORM_REGISTER.csv"));
for (const id of expected) {
  const row = register.find((item) => item.sp_id === id);
  if (!row) { fail(`${id}: missing shared-platform register row`); continue; }
  if (row.specification_status !== "SPECIFICATION_READY") fail(`${id}: specification status must remain SPECIFICATION_READY`);
  if (row.implementation_status !== "IMPLEMENTED") fail(`${id}: implementation_status must be IMPLEMENTED for T01 candidate`);
  if (row.product_status !== "NOT_READY") fail(`${id}: product_status must remain NOT_READY until separate product/UAT readiness gates`);
  if (!exists(`docs/${row.spec_path}`)) fail(`${id}: dossier missing at docs/${row.spec_path}`);
}

const e2e = parseCsv(text("docs/04-shared-platform/SHARED_PLATFORM_TEST_PLAN.csv"));
const uat = parseCsv(text("docs/04-shared-platform/SHARED_PLATFORM_UAT_PLAN.csv"));
for (const id of expected) {
  if (e2e.filter((row) => row.sp_id === id).length !== 2) fail(`${id}: expected exactly two registered E2E obligations`);
  if (uat.filter((row) => row.sp_id === id).length !== 2) fail(`${id}: expected exactly two registered UAT obligations`);
}

for (const relative of [
  "database/platform/migrations/035_t01_shared_platform_completion.sql",
  "database/tenant/migrations/075_t01_import_idempotency.sql",
  "apps/web/src/core/shared-platform.ts",
  "apps/web/src/core/attachment-security.ts",
  "apps/web/src/app/(app)/settings/platform/page.tsx",
  "apps/web/tests/t01-shared-platform.test.mjs",
  "services/api/tests/t01-shared-platform-imports.test.mjs",
  "docs/08-implementation-plans/T01_SHARED_PLATFORM_COMPLETION.md",
  "docs/08-implementation-plans/T01_SHARED_PLATFORM_UAT.md",
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

const executionPath = path.join(root, "docs/02-register/IMPLEMENTATION_EXECUTION_REGISTER.csv");
if (fs.existsSync(executionPath)) {
  const execution = parseCsv(fs.readFileSync(executionPath, "utf8"));
  const row = execution.find((item) => item.wave_id === "T01");
  if (!row) fail("T01 execution row missing");
  else if (!new Set(["IN_PROGRESS", "CANDIDATE_COMPLETE", "COMPLETE"]).has(row.execution_status)) fail(`T01 execution status ${row.execution_status} is not compatible with implementation verification`);
}

if (failures.length) {
  console.error("T01 SHARED-PLATFORM CANDIDATE VALIDATION FAILED");
  for (const item of failures) console.error(" -", item);
  process.exit(1);
}
console.log("T01 SHARED-PLATFORM CANDIDATE VALIDATION PASSED");
console.log(` - canonical T01 requirements: ${expected.length}/${expected.length}`);
console.log(" - implementation register: IMPLEMENTED for T01 requirements");
console.log(" - product readiness: intentionally NOT_READY pending separate UAT/product acceptance");
console.log(" - API/OAuth/inbound-mail/config/privacy/reporting/AI/workflow security boundaries present");
console.log(" - platform 035 and tenant 075 migration artifacts present");
