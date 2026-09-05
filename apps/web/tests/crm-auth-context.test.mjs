import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

// Prompt 14 — CRM authorization context integrity. crmContext() (in
// apps/web/src/modules/crm/index.ts) transitively imports @/core/module-access ->
// @/core/auth -> next/headers, so — same precedent as
// search-security.test.mjs and every other DB/session-touching file in
// this suite — it cannot be runtime-imported outside a real Next.js
// request. The pure, permission-driven scoping logic these source-pattern
// checks depend on (canViewAllCrmRecords(), recordScope()) already has
// real runtime coverage in services/api/tests/crm-record-scope.test.mjs;
// the REAL end-to-end chain (session -> context -> live query) is proven
// against a real database in
// services/worker/tests/crm-auth-context-live.manual.mjs. These tests
// exist to catch a regression of the exact fix itself — someone silently
// reverting the two propagated fields, or reintroducing a hardcoded
// role-name check in place of the permission-driven one.
const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const crmSource = () => read("apps/web/src/modules/crm/index.ts");
const crmContextTypeSource = () => read("packages/shared-types/src/crm.d.ts");
const followUpsSource = () => read("apps/web/src/orchestration/work/follow-ups.ts");
const leadIntelligenceSource = () => read("services/api/src/modules/crm/lead-intelligence.js");
const tasksSource = () => read("apps/web/src/orchestration/work/tasks.ts");
const systemContextSource = () => read("services/worker/src/system-context.js");

test("crmContext(): propagates the real session's permissions and roleSlugs into the CRM context", () => {
  const source = crmSource();
  assert.match(
    source,
    /permissions:\s*session\.permissions,/,
    "crmContext() must copy session.permissions verbatim — this was the Prompt 13-discovered defect (previously omitted entirely)",
  );
  assert.match(
    source,
    /roleSlugs:\s*session\.roleSlugs,/,
    "crmContext() must copy session.roleSlugs verbatim",
  );
});

test("crmContext(): does not synthesize crm.records.view_all from a hardcoded role-name check (permission truth stays permission-driven)", () => {
  const source = crmSource();
  // The pre-existing allowAllCompanies computation legitimately checks
  // roleSlugs for company/branch SCOPE (a separate concern, Part 29) — but
  // nothing in this file may hardcode a role-name check standing in for
  // the crm.records.view_all permission itself.
  assert.doesNotMatch(
    source,
    /crm\.records\.view_all["'\s]*[:=]\s*(true|roleSlugs)/,
    "must never synthesize crm.records.view_all from role names — permission truth comes from the resolved session only",
  );
});

test("CrmContext type: permissions and roleSlugs are required (non-optional) fields, not silently-undefined-able", () => {
  const source = crmContextTypeSource();
  assert.match(source, /permissions:\s*readonly string\[\];/);
  assert.match(source, /roleSlugs:\s*readonly string\[\];/);
  // Required means no `?` on either field.
  assert.doesNotMatch(source, /permissions\?:\s*readonly string\[\]/);
  assert.doesNotMatch(source, /roleSlugs\?:\s*readonly string\[\]/);
});

test("My Work — Follow-ups: delegates to the nurture-queue reader, which strips roleSlugs and narrows permissions to just the sensitivity gate, so crm.records.view_all can never broaden 'my follow-ups' to the whole team", () => {
  // Follow-ups & Reminders (F016) was rewired 2026-09-05 to read the lead
  // nurture queue instead of a bare next_follow_up_at field (see
  // follow-ups.ts's header comment); the "mine, full stop" scoping guarantee
  // moved with it into listMyNurtureQueueItems, which needs
  // crm.leads.view_sensitive to pass its own sensitivity gate and so cannot
  // strip permissions to a literal empty array the way Tasks does.
  assert.match(followUpsSource(), /listMyNurtureQueueItems/);
  const source = leadIntelligenceSource();
  assert.match(
    source,
    /permissions:\s*\["crm\.leads\.view_sensitive"\],\s*roleSlugs:\s*\[\]\s*\}/,
    "listMyNurtureQueueItems must override roleSlugs to an empty array and permissions to just the sensitivity permission before scoping the nurture queue",
  );
});

test("My Work — Tasks: strips permissions/roleSlugs before querying CRM activities, for the same reason as Follow-ups", () => {
  const source = tasksSource();
  assert.match(
    source,
    /crmApiContext\(session\)\),\s*permissions:\s*\[\],\s*roleSlugs:\s*\[\]\s*\}/,
    "crmActivityTasks must override permissions/roleSlugs to empty arrays before calling listCrmRecords",
  );
});

test("services/worker's system actor context remains least-privilege (unaffected by the Prompt 14 session-propagation fix)", () => {
  const source = systemContextSource();
  assert.match(source, /permissions:\s*\[\],/);
  assert.match(source, /roleSlugs:\s*\["system_worker"\],/);
});

test("public CRM lead capture never touches CrmContext — it uses a wholly separate function", () => {
  const captureRouteSource = read("apps/web/src/app/api/crm/public/capture/[key]/route.ts");
  assert.match(captureRouteSource, /captureCrmLead/);
  assert.doesNotMatch(captureRouteSource, /crmContext|crmApiContext|CrmContext/);
});

test("crmApiContext(): still asserts CRM module accessibility before returning a context (Prompt 5 module gate preserved)", () => {
  const source = crmSource();
  assert.match(source, /export async function crmApiContext\(/);
  assert.match(
    source,
    /await assertModuleAccessible\(session as WorkspaceSessionContext, "crm"\)/,
  );
  assert.match(source, /return crmContext\(session\)/);
});
