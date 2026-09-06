import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const page = "apps/web/src/app/(app)/crm/[resource]/page.tsx";
const manager = "apps/web/src/modules/crm/components/resource-manager.tsx";
const workspace = "apps/web/src/modules/crm/components/leads-workspace.tsx";
const detail = "apps/web/src/modules/crm/components/lead-detail-workspace.tsx";
const followUpRoute = "apps/web/src/app/api/crm/leads/[id]/follow-up/route.ts";

test("F001 UI actions: lead drawer deep links synchronize without remounting the queue", () => {
  const pageSource = read(page);
  const managerSource = read(manager);

  assert.match(pageSource, /edit\?: string/);
  assert.match(pageSource, /view\?: string/);
  assert.match(pageSource, /getCrmRecord\(client, context, resource, editId\)/);
  assert.match(
    pageSource,
    /startEditing=\{JSON\.parse\(JSON\.stringify\(result\.editingRecord\)\)\}/,
  );
  assert.doesNotMatch(
    pageSource,
    /dedicatedLeadCreate \? "create" : editId \|\| viewId \|\| "list"/,
  );
  assert.match(pageSource, /followup,/);

  assert.match(managerSource, /startCreating = false/);
  assert.match(managerSource, /startEditing = null/);
  assert.match(managerSource, /startEditing\?\.id/);
  assert.match(managerSource, /syncedLeadRouteMode !== leadRouteMode/);
  assert.match(
    managerSource,
    /router\.replace\(leadModeUrl\(\), \{ scroll: false \}\)/,
  );
  assert.match(
    managerSource,
    /leadModeUrl\(mode\?: "create" \| "edit" \| "view"/,
  );
});

test("F001 UI actions: lead search is submitted explicitly and searches generated full names", () => {
  const workspaceSource = read(workspace);
  const apiSource = read("services/api/src/modules/crm/index.js");

  assert.match(workspaceSource, /className="crm-suite-search"/);
  assert.match(workspaceSource, /type="submit"[\s\S]*?Search/);
  assert.match(workspaceSource, /query\.set\("search", nextSearch\.trim\(\)\)/);
  assert.match(
    apiSource,
    /"first_name",[\s\S]*?"last_name",[\s\S]*?"full_name"/,
  );
  assert.match(apiSource, /ILIKE/);
});

test("F001 UI actions: lifecycle filters synchronize with server state and terminal statuses cannot disappear in Kanban", () => {
  const source = read(workspace);
  const pageSource = read(page);

  assert.match(source, /useState\(initialStatus\)/);
  assert.match(source, /useState\(initialSearch\)/);
  assert.match(
    pageSource,
    /key=\{\[[\s\S]*?search,[\s\S]*?status,[\s\S]*?followup,/,
  );
  assert.match(source, /leadFilters\.followup/);
  assert.match(source, /status === "converted" \|\| status === "archived"/);
  assert.match(source, /terminalStatus \? "table" : preferredView/);
  assert.match(source, /navigate\(1, item\)/);
});

test("F001 UI actions: lead detail exposes a working edit deep link", () => {
  const source = read(detail);
  assert.match(
    source,
    /href=\{`\/crm\/leads\?edit=\$\{encodeURIComponent\(id\)\}`\}/,
  );
  assert.match(source, />\s*Edit lead\s*</);
});

test("F001 UI actions: conversion navigates to the opportunity that was actually created", () => {
  const source = read(detail);
  assert.match(source, /Convert to opportunity/);
  assert.match(source, /conversion\?\.opportunityId/);
  assert.match(
    source,
    /router\.push\(`\/crm\/opportunities\/\$\{opportunityId\}`\)/,
  );
  assert.match(source, /busy=\{pending === "convert"\}/);
});

test("F001 UI actions: Add follow-up uses one dedicated workflow and requires a due time", () => {
  const source = read(detail);
  assert.match(source, /scheduleFollowUp/);
  assert.match(source, /`\/api\/crm\/leads\/\$\{id\}\/follow-up`/);
  assert.match(source, /name="dueAt" type="datetime-local" required/);
  assert.match(source, /pending === "followup"/);
  assert.match(source, /Add follow-up/);
});

test("F001 UI actions: follow-up endpoint is scoped, permissioned, atomic, audited, and updates both records", () => {
  const source = read(followUpRoute);

  assert.match(source, /assertSameOriginOrMobile\(request\)/);
  assert.match(source, /PERMISSIONS\.crmLeadsManage/);
  assert.match(source, /PERMISSIONS\.crmActivitiesManage/);
  assert.match(source, /requireBillingWriteAccess/);
  assert.match(source, /crmApiContext\(session\)/);
  assert.match(source, /tenantTransaction/);
  assert.match(source, /getCrmRecord\(client, context, "leads", id\)/);
  assert.match(source, /createCrmRecord\(client, context, "activities"/);
  assert.match(source, /status: "planned"/);
  assert.match(source, /updateCrmRecord\(client, context, "leads", id/);
  assert.match(source, /nextFollowUpAt: input\.dueAt/);
  assert.match(source, /crm\.lead\.followup\.scheduled/);
  assert.match(source, /crmErrorResponse\(error\)/);
});
