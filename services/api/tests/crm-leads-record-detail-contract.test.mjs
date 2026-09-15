import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  queueLeadEnrichment,
  reviewLeadEnrichment,
} from "../src/modules/crm/prospect-and-relationship-master-data/lead-acquisition.js";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const base = {
  organizationId: "11111111-1111-4111-8111-111111111111",
  userId: "22222222-2222-4222-8222-222222222222",
  activeCompanyId: "33333333-3333-4333-8333-333333333333",
  activeBranchId: "44444444-4444-4444-8444-444444444444",
  allowAllCompanies: false,
  roleSlugs: [],
  permissions: ["crm.view", "crm.data-quality.manage", "crm.privacy.manage"],
};
const leadId = "55555555-5555-4555-8555-555555555555";
const reviewId = "66666666-6666-4666-8666-666666666666";


test("F001 Pass 2B: restricted actors cannot queue Lead enrichment by known Lead id", async () => {
  const client = {
    async query() {
      throw new Error("DB_QUERY_MUST_NOT_BE_REACHED");
    },
  };
  await assert.rejects(
    () => queueLeadEnrichment(client, base, { entityType: "lead", entityId: leadId, provider: "test" }),
    (error) => error?.status === 403 && error?.code === "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN",
  );
});


test("F001 Pass 2B: enrichment review re-checks Lead record scope before applying proposed changes", async () => {
  const context = { ...base, permissions: [...base.permissions, "crm.leads.view_sensitive"] };
  const queries = [];
  const client = {
    async query(sql, values) {
      queries.push({ sql, values });
      if (queries.length === 1) {
        return {
          rows: [{
            id: reviewId,
            status: "pending",
            entity_type: "lead",
            entity_id: leadId,
            proposed_changes: { companyName: "Should not apply" },
          }],
        };
      }
      if (queries.length === 2) return { rows: [] };
      throw new Error("MUTATION_MUST_NOT_BE_REACHED");
    },
  };
  await assert.rejects(
    () => reviewLeadEnrichment(client, context, reviewId, { decision: "approved" }),
    (error) => error?.status === 404 && error?.code === "CRM_LEAD_NOT_FOUND",
  );
  assert.equal(queries.length, 2);
  assert.match(queries[1].sql, /tenant\.crm_leads lead/);
  assert.match(queries[1].sql, /lead\.company_id IS NULL OR lead\.company_id=/);
  assert.match(queries[1].sql, /lead\.branch_id IS NULL OR lead\.branch_id=/);
  assert.match(queries[1].sql, /lead\.owner_user_id IS NULL OR lead\.owner_user_id=/);
  assert.match(queries[1].sql, /FOR UPDATE/);
});


test("F001 Pass 2B: generic consent list/create boundaries inherit the Lead privacy and record scope", () => {
  const source = [
    read("src/modules/crm/crm-data-operations-and-customization/record-policy.js"),
    read("src/modules/crm/crm-data-operations-and-customization/resource-mutation-service.js"),
  ].join("\n");
  assert.match(source, /definition\.table === "tenant\.crm_consent_events"/);
  assert.match(source, /return ` AND \${alias}\.\${leadIdColumn} IS NULL`/);
  assert.match(source, /tenant\.crm_leads lead WHERE lead\.organization_id=\${alias}\.organization_id/);
  assert.match(source, /resource === "consent-events" && effective\?\.leadId/);
  assert.match(source, /CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN/);
  assert.match(source, /getCrmRecord\(client, context, "leads", effective\.leadId\)/);
  assert.match(source, /resource === "consent-events"[\s\S]*CRM_CONSENT_IMMUTABLE/);
});


test("F001 Pass 2B: specialized enrichment service and route enforce both record scope and same-origin mutation protection", () => {
  const service = read("src/modules/crm/prospect-and-relationship-master-data/lead-acquisition.js");
  const route = read("../../apps/web/src/app/api/crm/leads/enrichment/route.ts");
  assert.match(service, /getScopedSensitiveEnrichmentLead/);
  assert.match(service, /canViewSensitiveLeadContent/);
  assert.match(service, /leadScopeSql\(context/);
  assert.match(service, /CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN/);
  assert.match(route, /assertSameOrigin\(request/);
  assert.match(route, /CRM_PERMISSIONS\.leadsViewSensitive/);
  assert.match(route, /readJson\(request\)/);
});
