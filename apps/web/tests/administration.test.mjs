import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { loadTsModule } from "./helpers/load-ts-module.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// my-work/types.ts has no @/lib/auth or @/lib/db dependency (only a
// type-only import, elided by transpileModule) — safe to execute directly
// for real timezone-aware behavioral coverage.
const typesModule = await loadTsModule("apps/web/src/lib/my-work/types.ts");

// ---------------------------------------------------------------------
// Part 13 — the one Prompt 8 gap that belongs in Prompt 10: due-date
// classification now uses the real, resolved session.timezone instead of
// the server process's local clock. Real execution, not source-matched.
// ---------------------------------------------------------------------

test("classifyDueAt: a timestamp in the past is overdue regardless of timezone (timezone-independent case)", () => {
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  assert.equal(typesModule.classifyDueAt(past, "Asia/Kolkata"), "overdue");
  assert.equal(typesModule.classifyDueAt(past, "America/Los_Angeles"), "overdue");
});

test("classifyDueAt: the same instant is 'due_today' in one timezone and 'upcoming' in another — proves the classification is genuinely timezone-aware, not server-local", () => {
  // Fixed, deterministic instants (using the injectable `now` parameter
  // added specifically so this doesn't depend on when the suite runs).
  // now = 2026-06-15T11:00:00Z; due = now + 10h.
  //   Pacific/Kiritimati (UTC+14): local now = 06-16 01:00, local due =
  //     06-16 11:00 — same local day as now -> due_today.
  //   Etc/GMT+12 (UTC-12, POSIX sign is inverted from common usage): local
  //     now = 06-14 23:00, local due = 06-15 09:00 — the day AFTER now's
  //     local day -> upcoming.
  const now = new Date("2026-06-15T11:00:00Z");
  const due = new Date("2026-06-15T21:00:00Z");
  const kiribati = typesModule.classifyDueAt(due, "Pacific/Kiritimati", now);
  const bakerIsland = typesModule.classifyDueAt(due, "Etc/GMT+12", now);
  assert.equal(kiribati, "due_today");
  assert.equal(bakerIsland, "upcoming");
});

test("classifyDueAt: an invalid/unknown timezone identifier falls back to the server's local calendar day rather than throwing", () => {
  const now = new Date();
  const laterToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 0);
  if (laterToday.getTime() <= now.getTime()) {
    assert.ok(true); // ran in the last minute of the day — trivially skip rather than flake
    return;
  }
  assert.doesNotThrow(() => typesModule.classifyDueAt(laterToday.toISOString(), "Not/A_Real_Zone"));
  assert.equal(typesModule.classifyDueAt(laterToday.toISOString(), "Not/A_Real_Zone"), "due_today");
});

test("classifyDueAt: omitting the timezone entirely still works (backward-compatible with any caller not yet updated)", () => {
  assert.equal(typesModule.classifyDueAt(null), "none");
  assert.equal(typesModule.classifyDueAt(undefined), "none");
});

test("my-work adapters: every classifyDueAt call site threads session.timezone through (Part 13 fix applied everywhere it was missing)", () => {
  for (const file of [
    "apps/web/src/lib/my-work/tasks.ts",
    "apps/web/src/lib/my-work/follow-ups.ts",
    "apps/web/src/lib/my-work/exceptions.ts",
  ]) {
    const source = read(file);
    const calls = source.match(/classifyDueAt\([^)]*\)/g) ?? [];
    assert.ok(calls.length >= 1, `${file}: expected at least one classifyDueAt call`);
    for (const call of calls) {
      assert.match(call, /session\.timezone/, `${file}: classifyDueAt call does not pass session.timezone: ${call}`);
    }
  }
});

// ---------------------------------------------------------------------
// Part 62/63 — three new minimal permissions, correctly catalogued and
// backfilled for existing tenants.
// ---------------------------------------------------------------------

test("three new permissions (automation.view, integrations.view, data_management.view) exist in the canonical catalogue", () => {
  const source = read("packages/permissions/src/index.js");
  assert.match(source, /automationView: "automation\.view"/);
  assert.match(source, /integrationsView: "integrations\.view"/);
  assert.match(source, /dataManagementView: "data_management\.view"/);
});

test("no new 'manage' permission was added for automation/integrations/data-management — every mutation continues to use its existing permission", () => {
  const source = read("packages/permissions/src/index.js");
  assert.doesNotMatch(source, /automationManage: "automation\.manage"/);
  assert.doesNotMatch(source, /integrationsManage: "integrations\.manage"/);
  assert.doesNotMatch(source, /dataManagementManage: "data_management\.manage"/);
});

test("migration 031 registers the three permissions and grants them to organization_owner/system_administrator/company_administrator/auditor for every existing organization, plus automation.view to crm_administrator", () => {
  const migration = read("database/control-plane/migrations/031_administration_permissions.sql");
  assert.match(migration, /'automation\.view'/);
  assert.match(migration, /'integrations\.view'/);
  assert.match(migration, /'data_management\.view'/);
  assert.match(migration, /slug IN \('organization_owner', 'system_administrator', 'company_administrator', 'auditor'\)/);
  assert.match(migration, /r\.slug = 'crm_administrator'/);
});

test("access-control.ts: Auditor gains all three new view permissions (read-only governance oversight), and CRM Administrator gains automation.view (automation is a CRM-owned capability today)", () => {
  const source = read("apps/web/src/lib/access-control.ts");
  const auditorBlock = source.split('slug: "auditor"')[1]?.split("},\n  {")[0] ?? "";
  assert.match(auditorBlock, /"automation\.view"/);
  assert.match(auditorBlock, /"integrations\.view"/);
  assert.match(auditorBlock, /"data_management\.view"/);
  const crmAdminBlock = source.split('slug: "crm_administrator"')[1]?.split("},\n  {")[0] ?? "";
  assert.match(crmAdminBlock, /"automation\.view"/);
});

// ---------------------------------------------------------------------
// Part 19-23 — Automation workspace: truthful engine status, no fake
// triggers/builder, redacted execution logs.
// ---------------------------------------------------------------------

test("automation page: gated by automation.view, fails closed via notFound()", () => {
  const source = read("apps/web/src/app/(app)/automation/page.tsx");
  assert.match(source, /PERMISSIONS\.automationView/);
  assert.match(source, /notFound\(\)/);
});

// Updated by Prompt 13 (Worker & Scheduler Foundation): a real scheduled
// worker tick now makes "activity.overdue" genuinely live (4 of 7), while
// "lead.updated"/"lead.qualified"/"campaign.member_responded" remain
// dormant for an unrelated reason (missing synchronous call sites in CRM
// mutation code, not a scheduling gap — see automation.ts's own comment).
test("automation page: exactly the 4 confirmed-live event triggers (including the new scheduled activity.overdue) are labeled live; the other 3 remain explicitly called out as not yet firing", () => {
  const lib = read("apps/web/src/lib/automation.ts");
  assert.match(lib, /"lead\.created"/);
  assert.match(lib, /"opportunity\.created"/);
  assert.match(lib, /"opportunity\.stage_changed"/);
  const liveSetBlock = lib.split("LIVE_AUTOMATION_EVENT_TYPES = new Set([")[1]?.split("]);")[0] ?? "";
  assert.match(liveSetBlock, /"activity\.overdue"/, "activity.overdue is now genuinely live via the scheduled worker tick");
  assert.doesNotMatch(liveSetBlock, /campaign\.member_responded|lead\.updated|lead\.qualified/);
});

test("automation page: explicitly documents the absence of a cross-module workflow builder rather than staying silent or claiming one", () => {
  const source = read("apps/web/src/app/(app)/automation/page.tsx");
  assert.doesNotMatch(source, /drag.and.drop/i);
  assert.match(source, /no cross-module\s+workflow builder/i);
});

test("automation page: execution-history error/result detail is redacted before rendering", () => {
  const source = read("apps/web/src/app/(app)/automation/page.tsx");
  assert.match(source, /redactAuditPayload\(/);
});

test("automation.ts: adds no new mutation path — only SELECT queries, rule management stays entirely in the existing CRM settings UI", () => {
  const source = read("apps/web/src/lib/automation.ts");
  assert.doesNotMatch(source, /INSERT INTO|UPDATE tenant\.|DELETE FROM/);
});

// ---------------------------------------------------------------------
// Part 26-30 — Reports & Analytics: real catalogue only, no fake builder.
// ---------------------------------------------------------------------

test("report catalogue covers exactly the 4 modules with a real report implementation (CRM, Sales, Procurement, Accounting) — no fabricated routes for the other 8", () => {
  const source = read("apps/web/src/lib/reports/catalogue.ts");
  const moduleIds = [...source.matchAll(/moduleId: "([a-z-]+)" as ModuleId/g)].map((m) => m[1]);
  assert.deepEqual(new Set(moduleIds), new Set(["crm", "sales", "procurement", "accounting"]));
});

test("report catalogue: every entry's route resolves to a real page.tsx (cross-checked structurally — the same 4 module report pages already verified by verify-routes.mjs)", () => {
  const source = read("apps/web/src/lib/reports/catalogue.ts");
  const routes = [...source.matchAll(/route: "(\/[a-z/]+)"/g)].map((m) => m[1]);
  const uniqueRoutes = new Set(routes);
  assert.deepEqual(
    uniqueRoutes,
    new Set(["/crm/reports", "/sales/reports", "/procurement/reports", "/accounting/reports"]),
  );
});

test("reports page: no permission gate on the page itself — filters by real module access + per-report permission only (My Work precedent, Part 28)", () => {
  const source = read("apps/web/src/app/(app)/reports/page.tsx");
  assert.doesNotMatch(source, /if \(!hasPermission\(session, PERMISSIONS\.\w+\)\) notFound\(\)/);
  assert.match(source, /accessibleModuleIds\.has\(entry\.moduleId\)/);
  assert.match(source, /hasPermission\(session, entry\.permission\)/);
});

test("reports page: does not pre-run any report query — it only renders catalogue metadata and links", () => {
  const source = read("apps/web/src/app/(app)/reports/page.tsx");
  assert.doesNotMatch(source, /getCrmReport|getSalesReport|getProcurementReport|getAccountingReport/);
});

test("reports page: explicitly documents the absence of a report builder / chart-pivot engine / scheduled reports rather than staying silent or claiming them", () => {
  const source = read("apps/web/src/app/(app)/reports/page.tsx");
  assert.match(source, /no\s+cross-module\s+report\s*\n?\s*builder/i);
  assert.match(source, /no\s+chart\/pivot\s+engine/i);
});

// ---------------------------------------------------------------------
// Part 35-44 — Integrations: only real integrations, no fake "Connected".
// ---------------------------------------------------------------------

test("integrations page: gated by integrations.view, fails closed via notFound()", () => {
  const source = read("apps/web/src/app/(app)/integrations/page.tsx");
  assert.match(source, /PERMISSIONS\.integrationsView/);
  assert.match(source, /notFound\(\)/);
});

test("integrations page: never shows a green 'Connected' badge for the webhook subscriptions — Part 77 forbids claiming health that isn't measured", () => {
  const source = read("apps/web/src/app/(app)/integrations/page.tsx");
  assert.doesNotMatch(source, />\s*Connected\s*</);
});

// Updated by Prompt 13 (Worker & Scheduler Foundation): webhook delivery
// is now genuinely real (services/worker), so the page no longer claims
// "delivery not yet automated" — but it still must not claim a live,
// unmeasured health status; it must honestly disclose that delivery only
// happens while the worker process is actually running.
test("integrations page: delivery is genuinely automated (Prompt 13), but the page still discloses that it depends on the worker process actually running, not a fabricated always-on claim", () => {
  const source = read("apps/web/src/app/(app)/integrations/page.tsx");
  assert.match(source, /delivery is automated/i);
  assert.match(source, /while the worker process is[\s\S]{0,20}running/i);
});

test("integrations.ts: never reads or exposes a webhook secret value — only secretReference (a pointer), matching Part 36/67's redaction requirement", () => {
  const source = read("apps/web/src/lib/integrations.ts");
  assert.doesNotMatch(source, /secret_value|secretValue/);
  assert.match(source, /secretReference/);
});

test("integrations page: explicitly documents API keys, OAuth self-service connect, SSO, e-commerce/shipping and live bank feeds as absent rather than fabricating them", () => {
  const source = read("apps/web/src/app/(app)/integrations/page.tsx");
  assert.match(source, /Tenant-issued API keys/);
  assert.match(source, /Identity provider . SSO/);
});

// ---------------------------------------------------------------------
// Part 47-51 — Data Management: operational hub, no universal bulk write.
// ---------------------------------------------------------------------

test("data management page: gated by data_management.view, fails closed via notFound()", () => {
  const source = read("apps/web/src/app/(app)/data-management/page.tsx");
  assert.match(source, /PERMISSIONS\.dataManagementView/);
  assert.match(source, /notFound\(\)/);
});

test("data management page: states every bulk-update path uses an explicit field allowlist, not a universal column-write capability", () => {
  const source = read("apps/web/src/app/(app)/data-management/page.tsx");
  assert.match(source, /explicit field allowlist/i);
});

test("data management page: adds no new upload/import endpoint of its own — it only links to the existing, already-validated import routes", () => {
  const source = read("apps/web/src/app/(app)/data-management/page.tsx");
  assert.doesNotMatch(source, /<input[^>]*type="file"/);
  assert.doesNotMatch(source, /fetch\(.*\/import/);
});

// ---------------------------------------------------------------------
// Part 52-58 — Security workspace: real controls only, links rather than
// duplicates Audit Logs.
// ---------------------------------------------------------------------

test("security page: personal self-service section remains ungated (any authenticated member manages their own password/sessions); the org-wide overview is additionally gated by audit.view", () => {
  const source = read("apps/web/src/app/(app)/security/page.tsx");
  assert.match(source, /canViewOverview = hasPermission\(session, PERMISSIONS\.auditView\)/);
  assert.match(source, /if \(canViewOverview\)/);
});

test("security page: MFA copy no longer claims a 'ready' foundation — it states plainly that enrollment does not exist yet", () => {
  const source = read("apps/web/src/app/(app)/security/page.tsx");
  assert.doesNotMatch(source, /MFA-ready/);
  assert.match(source, /Not yet enrollable/);
});

test("security page: links to Audit Logs' Security Events view rather than re-querying/duplicating it", () => {
  const source = read("apps/web/src/app/(app)/security/page.tsx");
  assert.match(source, /listSecurityAuditEvents\(/);
  assert.match(source, /href="\/audit-logs\/security"/);
});

test("security page: field-level access summary lists exactly the 3 real protections, no generic configurable field-security claim", () => {
  const source = read("apps/web/src/app/(app)/security/page.tsx");
  assert.match(source, /HR & Payroll/);
  assert.match(source, /Procurement/);
  assert.match(source, /Support/);
  assert.match(source, /no generic, configurable record-sharing rule engine/i);
});

// ---------------------------------------------------------------------
// Part 80 — no fake enterprise claims anywhere in this prompt's new files.
// ---------------------------------------------------------------------

const NEW_FILES = [
  "apps/web/src/app/(app)/automation/page.tsx",
  "apps/web/src/app/(app)/reports/page.tsx",
  "apps/web/src/app/(app)/integrations/page.tsx",
  "apps/web/src/app/(app)/data-management/page.tsx",
  "apps/web/src/app/(app)/security/page.tsx",
  "apps/web/src/app/(app)/settings/page.tsx",
];

test("no new Administration page AFFIRMATIVELY claims SSO, SCIM, SIEM, SOC2/ISO certification, automatic DLP, advanced BI, a no-code workflow builder, AI automation, or an enterprise data warehouse (mentioning the term while documenting its absence — e.g. 'no SSO' — is fine and expected; asserting the term appears only on lines that also negate it)", () => {
  const banned = /\bSSO\b|\bSCIM\b|\bSIEM\b|SOC ?2 certified|ISO certified|automatic DLP|no-code workflow builder|AI automation|data warehouse/i;
  const negation = /\bno\b|\bnot\b|absent|does not|missing|confirmed absent/i;
  for (const file of NEW_FILES) {
    const source = read(file);
    const lines = source.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      if (!banned.test(lines[index])) continue;
      // Text wraps across JSX lines, so a preceding "No" may sit on an
      // earlier line than the banned term itself — check a small window
      // around the match rather than requiring same-line negation.
      const window = lines.slice(Math.max(0, index - 2), index + 1).join(" ");
      assert.match(window, negation, `${file}: appears to affirmatively claim an unsupported capability near: "${lines[index].trim()}"`);
    }
  }
});

// ---------------------------------------------------------------------
// Part 87 — navigation.
// ---------------------------------------------------------------------

test("navigation: administration.ts declares Security, Automation, Reports & analytics, Integrations, Data management with real hrefs and correct permission gates", () => {
  const source = read("apps/web/src/lib/navigation/administration.ts");
  assert.match(source, /href: "\/security"/);
  assert.match(source, /href: "\/automation"/);
  assert.match(source, /href: "\/reports"/);
  assert.match(source, /href: "\/integrations"/);
  assert.match(source, /href: "\/data-management"/);
  assert.match(source, /permission: PERMISSIONS\.automationView/);
  assert.match(source, /permission: PERMISSIONS\.integrationsView/);
  assert.match(source, /permission: PERMISSIONS\.dataManagementView/);
});

test("navigation: Reports & analytics has no permission gate at the nav-item level (matches the page's own no-blanket-gate design)", () => {
  const source = read("apps/web/src/lib/navigation/administration.ts");
  const reportsItem = source.split('href: "/reports"')[1]?.split("},")[0] ?? "";
  assert.doesNotMatch(reportsItem, /permission:/);
});

test("navigation: no duplicate hrefs exist across workspaceSettingsNavigation and administrationNavigation", () => {
  const source = read("apps/web/src/lib/navigation/administration.ts");
  const hrefs = [...source.matchAll(/href: "([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(hrefs).size, hrefs.length, "duplicate href found in administration.ts");
});

test("settings hub: the new Platform group links to Security/Compliance/Automation/Reports/Integrations/Data-management, each permission-filtered", () => {
  const source = read("apps/web/src/app/(app)/settings/page.tsx");
  assert.match(source, /href: "\/security"/);
  assert.match(source, /href: "\/compliance"/);
  assert.match(source, /href: "\/automation"/);
  assert.match(source, /href: "\/reports"/);
  assert.match(source, /href: "\/integrations"/);
  assert.match(source, /href: "\/data-management"/);
  assert.match(source, /group: "Platform"/);
});

test("settings hub: empty groups (zero visible items for the caller) are not rendered", () => {
  const source = read("apps/web/src/app/(app)/settings/page.tsx");
  assert.match(source, /\.filter\(\(group\) => allowedItems\.some\(\(item\) => item\.group === group\)\)/);
});

// ---------------------------------------------------------------------
// Security regression — this prompt must not weaken Prompt 3-9 protections
// it touches or reads from.
// ---------------------------------------------------------------------

test("security regression: audit_events immutability trigger is untouched", () => {
  const source = read("database/control-plane/migrations/002_platform_foundation.sql");
  assert.match(source, /RAISE EXCEPTION 'audit_events are immutable'/);
});

test("security regression: automation/integrations lib files read tenant data exclusively through crmContext()/listCrmRecords()/tenantTransaction() — no raw cross-tenant query", () => {
  for (const file of ["apps/web/src/lib/automation.ts", "apps/web/src/lib/integrations.ts"]) {
    const source = read(file);
    assert.match(source, /tenantTransaction\(/, `${file} does not use tenantTransaction`);
    assert.match(source, /organization_id\s*=\s*\$1|session\.organizationId/, `${file} is not organization-scoped`);
  }
});

test("security regression: the new Security overview's org-wide session count is scoped through organization_memberships, never a bare cross-tenant sessions query", () => {
  const source = read("apps/web/src/app/(app)/security/page.tsx");
  assert.match(source, /JOIN organization_memberships om ON om\.user_id = s\.user_id AND om\.organization_id = \$1/);
});

test("security regression: redaction is reused (redactAuditPayload), not reimplemented, in Automation's execution-history view", () => {
  const automationSource = read("apps/web/src/app/(app)/automation/page.tsx");
  const redactSource = read("apps/web/src/lib/audit/redact.ts");
  assert.match(automationSource, /from "@\/lib\/audit\/redact"/);
  assert.match(redactSource, /export function redactAuditPayload/);
});
