import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("F001 Pass 2A web: saved-view schema repairs audit columns and supports governed visibility", () => {
  const migration = read("../../database/tenant/migrations/073_f001_lead_governance_recovery.sql");
  assert.match(migration, /ADD COLUMN IF NOT EXISTS visibility/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS created_by/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS updated_by/);
  assert.match(migration, /crm_lead_saved_views_team_fkey/);
  assert.match(migration, /crm_lead_saved_views_company_fkey/);
  assert.match(migration, /crm_lead_saved_views_branch_fkey/);
  assert.match(migration, /is_shared=true AND visibility='private' AND team_id IS NULL/);
});

test("F001 Pass 2A web: saved-view route implements private, team and organization governance", () => {
  const route = read("src/modules/crm/prospect-and-relationship-master-data/route-handlers/lead-saved-views.ts");
  assert.match(route, /crmSavedViewsShare/);
  assert.match(route, /private/);
  assert.match(route, /team/);
  assert.match(route, /organization/);
  assert.match(route, /crm_sales_team_members/);
  assert.match(route, /crmRecordsViewAll/);
  assert.match(route, /Shared Lead views cannot contain free-text search/);
});

test("F001 Pass 2A web: Lead 360 independently restricts sensitive related panels", () => {
  const detail = read("src/modules/crm/prospect-and-relationship-master-data/lead-detail-data.ts");
  assert.match(detail, /canViewSensitiveLeadContent/);
  assert.match(detail, /sensitiveDataRestricted/);
  assert.match(detail, /opportunityScope/);
  assert.match(detail, /activities[\s\S]*communications[\s\S]*notes[\s\S]*scoreHistory/);
});

test("F001 Pass 2A web: conflict UX gives explicit recovery actions", () => {
  const board = read("src/modules/crm/prospect-and-relationship-master-data/leads-workspace.tsx");
  const detail = read("src/modules/crm/prospect-and-relationship-master-data/lead-detail-workspace.tsx");
  assert.match(board, /Lead changed in another session/);
  assert.match(board, />Refresh board</);
  assert.match(detail, /This Lead changed after you opened it/);
  assert.match(detail, />Review latest Lead</);
});

test("F001 Pass 2A web: shared-view UI is explicit and permission-aware", () => {
  const board = read("src/modules/crm/prospect-and-relationship-master-data/leads-workspace.tsx");
  const page = read("src/app/(app)/crm/[resource]/page.tsx");
  assert.doesNotMatch(board, /window\.prompt\("Name this Lead view"/);
  assert.match(board, /savedViewVisibility/);
  assert.match(board, /Sales team/);
  assert.match(board, /Organization/);
  assert.match(page, /crmSavedViewsShare/);
});

test("F001 Pass 2A web: specialized Lead-content and intelligence routes require sensitive permission", () => {
  const paths = [
    "src/app/api/crm/leads/[id]/notes/route.ts",
    "src/app/api/crm/leads/[id]/attachments/route.ts",
    "src/app/api/crm/leads/[id]/qualification/route.ts",
    "src/app/api/crm/leads/[id]/score/route.ts",
    "src/app/api/crm/leads/duplicates/route.ts",
    "src/app/api/crm/leads/validate/route.ts",
    "src/app/api/crm/lead-intelligence/dashboard/route.ts",
    // F027 Prompt 4: the duplicate lead-intelligence/scores/[leadId] route
    // (functionally identical to leads/[id]/score, never referenced by any
    // UI) was removed — "duplicate implementations are not acceptable".
  ];
  for (const path of paths) assert.match(read(path), /crmLeadsViewSensitive/, path);
});

test("F001 Pass 2A web: security page truthfully lists CRM Lead field/content protection", () => {
  const page = read("src/app/(app)/security/page.tsx");
  assert.match(page, /CRM — Lead contact, consent, communications, notes, files, scoring evidence and duplicate signals/);
  assert.doesNotMatch(page, /exactly these three/);
});
