import { assertEligibleLeadAssignee } from "../leads/assignment.js";
import { CrmError } from "../data-management/errors.js";
import { getCrmRecord } from "../data-management/resource-query-service.js";
import { validationErrorDetails } from "../data-management/resource-validation.js";



export function throwOpportunityValidation(issues) {
  if (!issues.length) return;
  const first = issues[0];
  throw new CrmError(
    400,
    first.message,
    first.code,
    validationErrorDetails(issues),
  );
}



export function opportunityOutboxSnapshot(record, changedFields) {
  if (!record) return null;
  return {
    id: record.id,
    code: record.code,
    status: record.status,
    ownerUserId: record.ownerUserId ?? null,
    leadId: record.leadId ?? null,
    partyId: record.partyId ?? null,
    contactId: record.contactId ?? null,
    pipelineId: record.pipelineId ?? null,
    stageId: record.stageId ?? null,
    ...(changedFields ? { changedFields } : {}),
  };
}



export async function resolveOpportunityInitialStage(client, context, prepared) {
  const suppliedStageId = prepared.stageId || null;
  const suppliedPipelineId = prepared.pipelineId || null;
  let row = null;

  if (suppliedStageId) {
    const result = await client.query(
      `SELECT s.id AS stage_id,s.pipeline_id,s.probability,s.forecast_category
         FROM tenant.crm_pipeline_stages s
         JOIN tenant.crm_pipelines p
           ON p.organization_id=s.organization_id AND p.id=s.pipeline_id
        WHERE s.organization_id=$1 AND s.id=$2
          AND s.status='active' AND NOT s.is_won AND NOT s.is_lost AND p.status='active'
        LIMIT 1`,
      [context.organizationId, suppliedStageId],
    );
    row = result.rows[0] || null;
    if (!row)
      throw new CrmError(409, "Select an active Open stage from an active CRM pipeline.", "CRM_OPPORTUNITY_STAGE_INVALID");
    if (suppliedPipelineId && suppliedPipelineId !== row.pipeline_id)
      throw new CrmError(409, "The selected stage does not belong to the selected pipeline.", "CRM_OPPORTUNITY_STAGE_PIPELINE_MISMATCH");
  } else if (suppliedPipelineId) {
    const result = await client.query(
      `SELECT s.id AS stage_id,s.pipeline_id,s.probability,s.forecast_category
         FROM tenant.crm_pipelines p
         JOIN tenant.crm_pipeline_stages s
           ON s.organization_id=p.organization_id AND s.pipeline_id=p.id AND s.status='active' AND NOT s.is_won AND NOT s.is_lost
        WHERE p.organization_id=$1 AND p.id=$2 AND p.status='active'
        ORDER BY s.sequence,s.id LIMIT 1`,
      [context.organizationId, suppliedPipelineId],
    );
    row = result.rows[0] || null;
    if (!row)
      throw new CrmError(409, "The selected pipeline needs at least one active Open stage.", "CRM_OPPORTUNITY_PIPELINE_INVALID");
  } else {
    const result = await client.query(
      `SELECT s.id AS stage_id,s.pipeline_id,s.probability,s.forecast_category
         FROM tenant.crm_pipelines p
         JOIN tenant.crm_pipeline_stages s
           ON s.organization_id=p.organization_id AND s.pipeline_id=p.id AND s.status='active' AND NOT s.is_won AND NOT s.is_lost
        WHERE p.organization_id=$1 AND p.status='active'
        ORDER BY p.is_default DESC,s.sequence,s.id
        LIMIT 1`,
      [context.organizationId],
    );
    row = result.rows[0] || null;
    if (!row)
      throw new CrmError(409, "Configure an active CRM pipeline with an active Open stage before creating opportunities.", "CRM_OPPORTUNITY_PIPELINE_REQUIRED");
  }

  prepared.pipelineId = row.pipeline_id;
  prepared.stageId = row.stage_id;
  prepared.probability = Number(row.probability || 0);
  prepared.forecastCategory = row.forecast_category || "pipeline";
}



export async function validateOpportunityRelationships(client, context, prepared, existing = {}) {
  const effective = { ...existing, ...prepared };

  if (effective.leadId) {
    // getCrmRecord applies the caller's lead scope and excludes archived leads.
    await getCrmRecord(client, context, "leads", effective.leadId);
  }

  let selectedParty = null;
  if (effective.contactId) {
    const contact = await client.query(
      `SELECT c.id,c.party_id,c.status,p.status AS party_status
         FROM tenant.contacts c
         JOIN tenant.business_parties p
           ON p.organization_id=c.organization_id AND p.id=c.party_id
        WHERE c.organization_id=$1 AND c.id=$2 LIMIT 1`,
      [context.organizationId, effective.contactId],
    );
    const row = contact.rows[0];
    if (!row || row.status !== "active" || row.party_status !== "active")
      throw new CrmError(409, "Select an active Contact linked to an active Account.", "CRM_OPPORTUNITY_CONTACT_INVALID");
    if (effective.partyId && effective.partyId !== row.party_id)
      throw new CrmError(409, "The selected Contact does not belong to the selected Account.", "CRM_OPPORTUNITY_CONTACT_ACCOUNT_MISMATCH");
    if (!effective.partyId) {
      if (Object.prototype.hasOwnProperty.call(prepared, "partyId") && prepared.partyId === null)
        throw new CrmError(409, "Clear the Contact before clearing its Account.", "CRM_OPPORTUNITY_CONTACT_ACCOUNT_REQUIRED");
      // A Contact canonically implies its Account. When the caller selected a
      // Contact without separately sending partyId, persist the relationship
      // rather than validating a derived value only in memory.
      prepared.partyId = row.party_id;
      effective.partyId = row.party_id;
    }
    selectedParty = { id: row.party_id };
  }

  if (effective.partyId && !selectedParty) {
    const party = await client.query(
      `SELECT id,status FROM tenant.business_parties
        WHERE organization_id=$1 AND id=$2 LIMIT 1`,
      [context.organizationId, effective.partyId],
    );
    selectedParty = party.rows[0] || null;
    if (!selectedParty || selectedParty.status !== "active")
      throw new CrmError(409, "Select an active Account for this Opportunity.", "CRM_OPPORTUNITY_ACCOUNT_INVALID");
  }

  if (effective.ownerUserId) {
    try {
      await assertEligibleLeadAssignee(client, context, effective.ownerUserId);
    } catch (error) {
      if (error?.code === "CRM_LEAD_ASSIGNEE_SCOPE_INVALID")
        throw new CrmError(409, error.message, "CRM_OPPORTUNITY_OWNER_INELIGIBLE");
      throw error;
    }
  }
}
