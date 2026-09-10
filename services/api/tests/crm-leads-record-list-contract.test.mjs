import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  canViewSensitiveLeadContent,
  leadScopeSql,
  projectLeadForContext,
} from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-security.js";
import { publicLeadDuplicateResult } from "../src/modules/crm/prospect-and-relationship-master-data/lead-duplicates.js";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const base = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  activeCompanyId: "33333333-3333-4333-8333-333333333333",
  activeBranchId: "44444444-4444-4444-8444-444444444444",
  allowAllCompanies: false,
  roleSlugs: [],
  permissions: ["crm.view"],
};

test("F001 Pass 2A: restricted Lead projection removes contact/content fields", () => {
  const projected = projectLeadForContext(base, {
    id: "lead-1",
    fullName: "Restricted Person",
    email: "private@example.com",
    phone: "+911234567890",
    mobile: "+919999999999",
    customData: { secret: "x" },
    consentEmail: true,
    qualificationReasonText: "Sensitive reason",
    scoreExplanation: { reasons: ["private"] },
    priority: "high",
  });
  assert.equal(canViewSensitiveLeadContent(base), false);
  assert.equal(projected.email, undefined);
  assert.equal(projected.phone, undefined);
  assert.equal(projected.mobile, undefined);
  assert.equal(projected.customData, undefined);
  assert.equal(projected.consentEmail, undefined);
  assert.equal(projected.qualificationReasonText, undefined);
  assert.equal(projected.scoreExplanation, undefined);
  assert.equal(projected.priority, "high");
  assert.equal(projected.sensitiveDataRestricted, true);
});

test("F001 Pass 2A: sensitive permission preserves Lead content", () => {
  const context = { ...base, permissions: ["crm.view", "crm.leads.view_sensitive"] };
  const row = { id: "lead-1", email: "visible@example.com", customData: { ok: true } };
  assert.equal(canViewSensitiveLeadContent(context), true);
  assert.deepEqual(projectLeadForContext(context, row), row);
});

test("F001 Pass 2A: Lead record scope composes company, branch and owner", () => {
  const values = [base.organizationId];
  const sql = leadScopeSql(base, values, "lead");
  assert.match(sql, /lead\.company_id IS NULL OR lead\.company_id=\$2/);
  assert.match(sql, /lead\.branch_id IS NULL OR lead\.branch_id=\$3/);
  assert.match(sql, /lead\.owner_user_id IS NULL OR lead\.owner_user_id=\$4/);
  assert.deepEqual(values, [base.organizationId, base.activeCompanyId, base.activeBranchId, base.userId]);
});

test("F001 Pass 2A: hidden duplicate matches cannot expose signals or classification", () => {
  const result = publicLeadDuplicateResult({
    classification: "exact",
    matches: [
      { id: "hidden", restricted: true, classification: "exact", signals: [{ field: "email" }] },
    ],
  });
  assert.equal(result.classification, "restricted");
  assert.equal(result.restrictedMatch, true);
  assert.deepEqual(result.matches, []);
  assert.doesNotMatch(JSON.stringify(result), /email|signals/);
});

test("F001 Pass 2A: intelligence and related-feature services enforce sensitive content plus Lead scope", () => {
  const intelligence = read("src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-intelligence.js");
  // F027 Prompt 4: getScopedLead/scopedLeadWhere (the leadScopeSql(context
  // callers) moved to the scoring capability directory's shared.js so the
  // scoring engine and this file's own SLA/nurture functions can both use
  // them without a circular import; lead-intelligence.js still calls
  // getScopedLead(client, context, leadId) throughout, which is the same
  // Lead-scope enforcement, just one hop away from the literal SQL call.
  const scoringShared = read(
    "src/modules/crm/lead-lifecycle-qualification-and-prioritization/scoring/shared.js",
  );
  const call = read("src/modules/crm/seller-activity-and-follow-up-workspace/call-operations.js");
  const meeting = read("src/modules/crm/seller-activity-and-follow-up-workspace/meeting-operations.js");
  const task = read("src/modules/crm/seller-activity-and-follow-up-workspace/task-operations.js");
  const communications = read("src/modules/crm/seller-activity-and-follow-up-workspace/communications.js");
  assert.match(intelligence, /assertSensitiveLeadIntelligenceAccess/);
  assert.match(intelligence, /getScopedLead\(client, context, leadId/);
  assert.match(scoringShared, /leadScopeSql\(context/);
  for (const source of [call, meeting, task]) {
    assert.match(source, /canViewSensitiveLeadContent/);
    assert.match(source, /leadScopeSql\(context/);
  }
  // F018 final closeout: communications.js no longer THROWS a 403 for
  // missing crm.leads.view_sensitive (that hard "hide the whole thing"
  // gate was replaced by the audience/content split — see
  // communication-projection.js) but it still reuses the SAME permission
  // check, now as the CONTENT-projection decision (canSeeContent) rather
  // than a row-visibility throw.
  assert.match(communications, /canViewSensitiveLeadContent/);
  assert.match(communications, /leadScopeSql\(context/);
});

test("F001 Pass 2A: lifecycle responses are projected through the Lead privacy boundary", () => {
  // F007 Prompt 4: implementation moved to the lifecycle/ capability directory.
  const source = read("src/modules/crm/lead-lifecycle-qualification-and-prioritization/lifecycle/transition-engine.js");
  assert.match(source, /projectLeadForContext\(context, dto\(lead\)\)/);
  assert.match(source, /projectLeadForContext\(context, dto\(updated\.rows\[0\]\)\)/);
});

import {
  createCrmRecord,
  listCrmRecords,
} from "../src/modules/crm/index.js";

test("F001 Pass 2A: generic AI/enrichment/data-quality lists cannot bypass Lead privacy", async () => {
  for (const resource of ["ai-predictions", "enrichment-jobs", "data-quality-scores"]) {
    const queries = [];
    const client = {
      async query(sql, values) {
        queries.push({ sql, values });
        if (/count\(\*\)::int AS total/.test(sql)) return { rows: [{ total: 0 }] };
        return { rows: [] };
      },
    };
    await listCrmRecords(client, base, resource, { limit: 25 });
    const sql = queries.map((entry) => entry.sql).join("\n");
    assert.match(sql, /lower\(COALESCE\(record\.entity_type,''\)\) <> 'lead'/);
    assert.doesNotMatch(sql, /tenant\.crm_leads lead/);
  }
});

test("F001 Pass 2A: sensitive generic intelligence still inherits Lead company/branch/owner scope", async () => {
  const context = {
    ...base,
    permissions: ["crm.view", "crm.leads.view_sensitive"],
  };
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (/count\(\*\)::int AS total/.test(sql)) return { rows: [{ total: 0 }] };
      return { rows: [] };
    },
  };
  await listCrmRecords(client, context, "ai-predictions", { limit: 25 });
  const count = queries[0];
  assert.match(count.sql, /EXISTS \(SELECT 1 FROM tenant\.crm_leads lead/);
  assert.match(count.sql, /lead\.company_id IS NULL OR lead\.company_id\s*=\s*\$/);
  assert.match(count.sql, /lead\.branch_id IS NULL OR lead\.branch_id\s*=\s*\$/);
  assert.match(count.sql, /lead\.owner_user_id IS NULL OR lead\.owner_user_id\s*=\s*\$/);
  assert.ok(count.values.includes(base.activeCompanyId));
  assert.ok(count.values.includes(base.activeBranchId));
  assert.ok(count.values.includes(base.userId));
});

test("F001 Pass 2A: restricted actors cannot create Lead-linked generic intelligence", async () => {
  const client = {
    async query() {
      throw new Error("DB_QUERY_MUST_NOT_BE_REACHED");
    },
  };
  await assert.rejects(
    () =>
      createCrmRecord(client, base, "ai-predictions", {
        entityType: "lead",
        entityId: "55555555-5555-4555-8555-555555555555",
        predictionType: "conversion",
        score: 50,
        status: "active",
      }),
    (error) =>
      error?.code === "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN" && error?.status === 403,
  );
});

test("F001 Pass 2A: generic Lead entity types are normalized and historical mixed-case rows are scoped", () => {
  const source = [
    read("src/modules/crm/crm-data-operations-and-customization/resource-validation.js"),
    read("src/modules/crm/crm-data-operations-and-customization/record-policy.js"),
  ].join("\n");
  assert.match(source, /prepared\.entityType = String\(prepared\.entityType \|\| ""\)\.trim\(\)\.toLowerCase\(\)/);
  assert.match(source, /lower\(COALESCE\(\$\{alias\}\.\$\{entityTypeColumn\},''\)\) <> 'lead'/);
  assert.match(source, /lower\(prediction\.entity_type\)='lead'/);
});

test("F001 Pass 2A: AI feedback inherits access through its parent prediction", async () => {
  const source = [
    read("src/modules/crm/crm-data-operations-and-customization/record-policy.js"),
    read("src/modules/crm/crm-data-operations-and-customization/resource-mutation-service.js"),
  ].join("\n");
  assert.match(source, /function aiFeedbackLeadScope/);
  assert.match(source, /tenant\.crm_ai_predictions prediction/);
  assert.match(source, /lower\(prediction\.entity_type\)='lead'/);
  assert.match(source, /resource === "ai-feedback"/);
  assert.match(source, /getCrmRecord\(client, context, "ai-predictions", effective\.predictionId\)/);
});


test("F001 Pass 2A: permission catalog and migrations preserve least privilege", () => {
  const permissions = read("../../packages/permissions/src/crm.js");
  const platformMigration = read("../../database/platform/migrations/034_crm_lead_governance_permissions.sql");
  const tenantMigration = read("../../database/tenant/migrations/073_f001_lead_governance_recovery.sql");

  assert.match(permissions, /leadsViewSensitive:\s*"crm\.leads\.view_sensitive"/);
  assert.match(permissions, /savedViewsShare:\s*"crm\.saved_views\.share"/);

  assert.match(platformMigration, /'crm\.leads\.view_sensitive'/);
  assert.match(platformMigration, /'crm\.saved_views\.share'/);
  assert.match(platformMigration, /sales_representative/);

  const shareBlock = platformMigration.match(
    /p\.permission_key='crm\.saved_views\.share'[\s\S]*?r\.slug IN \(([\s\S]*?)\)\s*\)/,
  );
  assert.ok(shareBlock, "saved-view sharing role backfill must be explicit");
  assert.doesNotMatch(
    shareBlock[1],
    /sales_representative/,
    "ordinary sales representatives must not gain organization/team publish authority",
  );

  for (const column of [
    "visibility text NOT NULL DEFAULT 'private'",
    "team_id uuid",
    "company_id uuid",
    "branch_id uuid",
    "created_by uuid",
    "updated_by uuid",
  ]) {
    assert.match(tenantMigration, new RegExp(column.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")));
  }
  assert.match(tenantMigration, /SET visibility='organization'[\s\S]*is_shared=true[\s\S]*team_id IS NULL/);
  assert.match(tenantMigration, /visibility IN \('private','team','organization'\)/);
  assert.match(tenantMigration, /FOREIGN KEY \(organization_id,team_id\)/);
  assert.match(tenantMigration, /SET is_shared=\(visibility<>'private'\)/);
});
