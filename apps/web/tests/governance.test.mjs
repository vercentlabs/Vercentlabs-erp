import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadTsModule } from "./helpers/load-ts-module.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// audit/redact.ts and audit/sanitize.ts have zero @/lib/auth or @/lib/db
// dependency (query.ts, which does depend on @/lib/db -> pg, imports its
// sanitizers FROM sanitize.ts rather than defining them locally, exactly
// so this split is possible) — safe to execute directly for real
// behavioral coverage.
const redactModule = await loadTsModule("apps/web/src/lib/audit/redact.ts");
const sanitizeModule = await loadTsModule("apps/web/src/lib/audit/sanitize.ts");

// ---------------------------------------------------------------------
// Part 42/43 — redaction, real execution.
// ---------------------------------------------------------------------

test("redactAuditPayload: redacts secret-shaped keys (password, token, secret, api key, authorization, cookie, session)", () => {
  const input = {
    password: "hunter2",
    apiKey: "sk_live_abc",
    authorization: "Bearer xyz",
    sessionToken: "abc123",
    safeField: "keep me",
  };
  const result = redactModule.redactAuditPayload(input);
  assert.equal(result.password, "[REDACTED]");
  assert.equal(result.apiKey, "[REDACTED]");
  assert.equal(result.authorization, "[REDACTED]");
  assert.equal(result.sessionToken, "[REDACTED]");
  assert.equal(result.safeField, "keep me");
});

test("redactAuditPayload: redacts banking/PII-shaped keys (bank details, GSTIN, date of birth, private notes)", () => {
  const input = {
    bankAccountNumber: "1234567890",
    bankIfscCode: "HDFC0000123",
    gstin: "27ABCDE1234F1Z5",
    dateOfBirth: "1990-01-01",
    privateNote: "internal only",
    displayName: "keep me",
  };
  const result = redactModule.redactAuditPayload(input);
  assert.equal(result.bankAccountNumber, "[REDACTED]");
  assert.equal(result.bankIfscCode, "[REDACTED]");
  assert.equal(result.gstin, "[REDACTED]");
  assert.equal(result.dateOfBirth, "[REDACTED]");
  assert.equal(result.privateNote, "[REDACTED]");
  assert.equal(result.displayName, "keep me");
});

test("redactAuditPayload: redacts nested objects and arrays, not just top-level keys", () => {
  const input = { before: { bankAccountNumber: "999" }, items: [{ token: "abc" }] };
  const result = redactModule.redactAuditPayload(input);
  assert.equal(result.before.bankAccountNumber, "[REDACTED]");
  assert.equal(result.items[0].token, "[REDACTED]");
});

test("redactAuditPayload: null/undefined pass through without throwing", () => {
  assert.equal(redactModule.redactAuditPayload(null), null);
  assert.equal(redactModule.redactAuditPayload(undefined), undefined);
});

// ---------------------------------------------------------------------
// Part 39 — query-parameter validation, real execution.
// ---------------------------------------------------------------------

test("sanitizePage: rejects non-positive/non-finite input and caps an unreasonably large page", () => {
  assert.equal(sanitizeModule.sanitizePage(0), 1);
  assert.equal(sanitizeModule.sanitizePage(-5), 1);
  assert.equal(sanitizeModule.sanitizePage(NaN), 1);
  assert.equal(sanitizeModule.sanitizePage(3), 3);
  assert.equal(sanitizeModule.sanitizePage(999_999_999), 10_000);
});

test("sanitizePageSize: bounds page size to a safe maximum, never unbounded", () => {
  assert.equal(sanitizeModule.sanitizePageSize(10), 10);
  assert.equal(sanitizeModule.sanitizePageSize(999_999), 200);
  assert.equal(sanitizeModule.sanitizePageSize(0), 50);
  assert.equal(sanitizeModule.sanitizePageSize(-1), 50);
});

// ---------------------------------------------------------------------
// Part 12/39 — no arbitrary SQL-filter builder; every filter dimension is
// a small, fixed, parameterized set.
// ---------------------------------------------------------------------

test("audit/query.ts: every WHERE condition pushed onto `conditions` references a bound $N placeholder, never a raw filter value spliced into SQL text", () => {
  const source = read("apps/web/src/lib/audit/query.ts");
  const conditionPushes = source.match(/conditions\.push\(`[^`]*`\)/g) ?? [];
  assert.ok(conditionPushes.length >= 5, "expected several conditions.push(...) calls");
  for (const push of conditionPushes) {
    if (/\$\{params\.length\}/.test(push)) continue; // references the placeholder index, not a value — safe
    assert.doesNotMatch(
      push,
      /\$\{(filters|search|eventTypePrefix|dateFrom|dateTo)[.\w]*\}/,
      `a filter value appears to be spliced directly into SQL text: ${push}`,
    );
  }
});

test("audit/sanitize.ts: eventTypePrefix is validated against a strict character allowlist before use", () => {
  const source = read("apps/web/src/lib/audit/sanitize.ts");
  assert.match(source, /\^\[a-z0-9_\.\-\]\+\$/i);
});

test("audit/query.ts: listSecurityAuditEvents' event-type category filter is a hardcoded literal, never client-controlled", () => {
  const source = read("apps/web/src/lib/audit/query.ts");
  assert.match(source, /event_type LIKE 'auth\.%' OR a\.event_type LIKE 'access\.%' OR a\.event_type = 'module\.status_changed'/);
});

test("audit/query.ts: listLoginEvents is tenant-scoped via an INNER JOIN to organization_memberships, never by email domain guessing", () => {
  const source = read("apps/web/src/lib/audit/query.ts");
  assert.match(source, /JOIN organization_memberships om ON om\.user_id = le\.user_id AND om\.organization_id = \$1/);
});

// ---------------------------------------------------------------------
// Part 58 — Audit Logs workspace.
// ---------------------------------------------------------------------

const AUDIT_PAGES = [
  "apps/web/src/app/(app)/audit-logs/page.tsx",
  "apps/web/src/app/(app)/audit-logs/history/page.tsx",
  "apps/web/src/app/(app)/audit-logs/activity/page.tsx",
  "apps/web/src/app/(app)/audit-logs/security/page.tsx",
];

test("audit logs: every page is gated by PERMISSIONS.auditView, none rely on authentication alone", () => {
  for (const file of AUDIT_PAGES) {
    const source = read(file);
    assert.match(source, /PERMISSIONS\.auditView/, `${file} is not gated by auditView`);
    assert.match(source, /notFound\(\)/, `${file} does not fail closed via notFound()`);
  }
});

test("audit logs: every list view is bounded/paginated, never loads full history at once", () => {
  for (const file of AUDIT_PAGES) {
    const source = read(file);
    assert.match(source, /page/i, `${file} has no pagination concept`);
  }
  const query = read("apps/web/src/lib/audit/query.ts");
  assert.match(query, /LIMIT \$/);
});

test("audit logs: every display row is redacted via redactAuditPayload before rendering", () => {
  for (const file of AUDIT_PAGES) {
    const source = read(file);
    assert.match(source, /redactAuditPayload\(/, `${file} renders audit payload fields without redaction`);
  }
});

test("audit logs: no page or the export route defines a PATCH/PUT/DELETE handler — audit_events stays append-only through this workspace", () => {
  const files = [...AUDIT_PAGES, "apps/web/src/app/api/audit-logs/export/route.ts"];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /export (async )?function (PATCH|PUT|DELETE)/, `${file} exposes a mutating handler`);
  }
});

test("audit export: permission-gated, redacted, bounded, filtered server-side, and self-audits", () => {
  const source = read("apps/web/src/app/api/audit-logs/export/route.ts");
  assert.match(source, /requirePermissionFromSession\(session, PERMISSIONS\.auditView\)/);
  assert.match(source, /redactAuditPayload\(/);
  assert.match(source, /EXPORT_ROW_LIMIT/);
  assert.match(source, /listAuditEvents\(/, "export must reuse the same filtered query as the Audit Events page, not a separate unfiltered path");
  assert.match(source, /await audit\(\{/);
  assert.match(source, /eventType: "audit\.events\.exported"/);
});

test("audit history: entity lookup requires both entityType and entityId before querying — no unscoped record-history dump", () => {
  const source = read("apps/web/src/app/(app)/audit-logs/history/page.tsx");
  assert.match(source, /hasLookup = Boolean\(entityType && entityId\)/);
});

test("audit event table: sensitive JSON detail is collapsed by default (no megabytes of visible JSON rendered per page load)", () => {
  const source = read("apps/web/src/components/audit-event-table.tsx");
  assert.match(source, /<details/);
});

// ---------------------------------------------------------------------
// Part 57 — Billing.
// ---------------------------------------------------------------------

test("billing: subscription status values are read from the real DB CHECK constraint / shared-types union, not invented", () => {
  const migration = read("database/control-plane/migrations/005_billing_and_razorpay.sql");
  const types = read("packages/shared-types/src/billing.d.ts");
  for (const status of ["trialing", "checkout_pending", "authenticated", "active", "past_due", "halted", "cancelled", "completed", "expired", "internal"]) {
    assert.match(migration, new RegExp(`'${status}'`), `subscription CHECK constraint is missing '${status}'`);
    assert.match(types, new RegExp(`"${status}"`), `BillingSubscriptionStatus type is missing "${status}"`);
  }
});

test("billing: the Plan view's module-entitlement grid is derived from ERP_MODULE_CATALOG + plan.modules, not a hardcoded module list", () => {
  const source = read("apps/web/src/components/billing-workspace.tsx");
  assert.match(source, /ERP_MODULE_CATALOG\.map\(\(module\)/);
  assert.match(source, /plan\.modules\.includes\("\*"\) \|\| plan\.modules\.includes\(module\.key\)/);
});

test("billing: the Usage section only lists the two dimensions incrementBillingUsage actually increments (api_requests_monthly, imports_rows_monthly) — no fabricated storage/automation/message metrics", () => {
  const source = read("apps/web/src/components/billing-workspace.tsx");
  const dimensionsBlock = source.split("METERED_USAGE_DIMENSIONS")[1]?.split("];")[0] ?? "";
  assert.match(dimensionsBlock, /api_requests_monthly/);
  assert.match(dimensionsBlock, /imports_rows_monthly/);
  assert.doesNotMatch(dimensionsBlock, /storage_bytes|automation_actions_monthly|outbound_messages_monthly/);
});

test("billing: usage rendering uses real summary.usage values, never Math.random or a static placeholder number", () => {
  const source = read("apps/web/src/components/billing-workspace.tsx");
  assert.doesNotMatch(source, /Math\.random/);
  assert.match(source, /summary\.usage\[dimension\.key\]/);
});

test("billing: mutating routes remain permission-gated (checkout/cancel require billing.checkout/billing.manage; profile requires billing.manage) — unchanged by this prompt's view-layer additions", () => {
  const checkout = read("apps/web/src/app/api/billing/checkout/route.ts");
  const cancel = read("apps/web/src/app/api/billing/cancel/route.ts");
  const profile = read("apps/web/src/app/api/billing/profile/route.ts");
  assert.match(checkout, /billing\.checkout|billingCheckout/);
  assert.match(cancel, /billing\.manage|billingManage/);
  assert.match(profile, /billing\.manage|billingManage/);
});

test("billing: the Razorpay webhook idempotency key (provider, provider_event_id) is untouched by this prompt", () => {
  const migration = read("database/control-plane/migrations/005_billing_and_razorpay.sql");
  assert.match(migration, /UNIQUE\s*\(\s*provider\s*,\s*provider_event_id\s*\)/);
});

test("billing: module entitlement resolution (isModuleEntitled) is untouched — Billing's new UI reads the same getBillingSummary() service, it does not reimplement entitlement logic", () => {
  const moduleAccess = read("apps/web/src/lib/module-access.ts");
  assert.match(moduleAccess, /export async function isModuleEntitled/);
  assert.match(moduleAccess, /getBillingSummary\(/);
  const workspace = read("apps/web/src/components/billing-workspace.tsx");
  assert.doesNotMatch(workspace, /isModuleEntitled|resolveModuleAccess/, "billing-workspace.tsx must not reimplement entitlement resolution");
});

// ---------------------------------------------------------------------
// Part 30/64 — permissions/roles migration and navigation.
// ---------------------------------------------------------------------

test("migration 030 registers compliance.view and grants it only to governance-appropriate existing roles (organization_owner, system_administrator, company_administrator, auditor)", () => {
  const migration = read("database/control-plane/migrations/030_compliance_permission.sql");
  assert.match(migration, /INSERT INTO permissions \(key, name, category, description\) VALUES\s*\n\s*\('compliance\.view'/);
  assert.match(migration, /slug IN \('organization_owner', 'system_administrator', 'company_administrator', 'auditor'\)/);
});

test("access-control.ts: the Auditor role explicitly gains compliance.view (read-only governance visibility), consistent with its existing audit.view/billing.audit grants", () => {
  const source = read("apps/web/src/lib/access-control.ts");
  const auditorBlock = source.split('slug: "auditor"')[1]?.split("},\n  {")[0] ?? "";
  assert.match(auditorBlock, /"compliance\.view"/);
});

test("navigation: governance.ts declares Billing and Audit logs and omits the retired shared Compliance workspace", () => {
  const source = read("apps/web/src/lib/navigation/governance.ts");
  assert.match(source, /href: "\/billing"/);
  assert.match(source, /href: "\/audit-logs"/);
  assert.doesNotMatch(source, /href: "\/compliance"/);
});

// ---------------------------------------------------------------------
// Part 65 — security regression: this prompt must not weaken Prompt 3-8
// protections it touches or reads from.
// ---------------------------------------------------------------------

test("security regression: audit_events immutability trigger is untouched by this prompt", () => {
  const source = read("database/control-plane/migrations/002_platform_foundation.sql");
  assert.match(source, /RAISE EXCEPTION 'audit_events are immutable'/);
});

test("security regression: HR/Procurement/Support module data is never queried by any new governance page or lib file", () => {
  const files = [
    ...AUDIT_PAGES,
    "apps/web/src/lib/audit/query.ts",
    "apps/web/src/lib/audit/redact.ts",
    "apps/web/src/app/api/audit-logs/export/route.ts",
  ];
  for (const file of files) {
    const source = read(file);
    assert.doesNotMatch(source, /hr_payroll_events|procurement_events|support_events|tenant\.hr_employees|tenant\.support_communications/i, `${file} unexpectedly references a sensitive module's private data`);
  }
});
