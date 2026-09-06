import { moveOpportunityStage } from "./services/api/src/modules/crm/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const opportunityId = "55555555-5555-4555-8555-555555555555";
const pipelineId = "66666666-6666-4666-8666-666666666666";
const wonStageId = "77777777-7777-4777-8777-777777777777";
const wonReasonId = "99999999-9999-4999-8999-999999999999";

const crmContext = {
  organizationId: org,
  userId: "user-1",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["crm.opportunities.manage", "crm.records.view_all"],
  roleSlugs: [],
};

const client = {
  async query(sql, values = []) {
    console.log("SQL:", sql.slice(0, 160).replace(/\s+/g, " "));
    if (sql.includes("FROM tenant.crm_opportunities record") && sql.includes("FOR UPDATE")) {
      return { rows: [{ id: opportunityId, organization_id: org, stage_id: "open-stage", pipeline_id: pipelineId, status: "open", updated_at: new Date().toISOString(), outcome_reason_id: null, lost_reason_id: null }] };
    }
    if (sql.includes("crm_pipeline_stages WHERE organization_id = $1 AND id = $2")) {
      return { rows: [{ id: wonStageId, probability: 100, forecast_category: "closed", is_won: true, is_lost: false }] };
    }
    if (sql.includes("FROM tenant.crm_lost_reasons")) {
      return { rows: [{ id: wonReasonId, name: "Other", outcome_type: "won" }] };
    }
    if (sql.startsWith("UPDATE tenant.crm_opportunities")) {
      return { rows: [{ id: opportunityId, status: "won" }] };
    }
    if (sql.includes("INSERT INTO tenant.crm_opportunity_stage_history")) return { rows: [] };
    if (sql.includes("FROM tenant.crm_automation_rules")) return { rows: [] };
    return { rows: [] };
  },
};

try {
  const result = await moveOpportunityStage(client, crmContext, opportunityId, wonStageId, "test note", { outcomeReasonId: wonReasonId });
  console.log("RESULT:", result);
} catch (error) {
  console.error("ERROR:", error);
}
