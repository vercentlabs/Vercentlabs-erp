import { resolveLeadOwner } from "./lead-governance.js";
import {
  LeadSourceError,
  validateLeadSourceAssignment,
} from "./features/lead-sources/validation.js";

export class LeadOperationsError extends Error {
  constructor(
    status,
    message,
    code = "CRM_LEAD_OPERATIONS_ERROR",
    details = [],
  ) {
    super(message);
    this.name = "LeadOperationsError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
const text = (v) => String(v ?? "").trim();
const finite = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export function evaluateLeadReadiness(lead, now = new Date(), options = {}) {
  const reasons = [];
  const scoringConfigured = options.scoringConfigured !== false;
  if (
    !text(lead.full_name || `${lead.first_name || ""} ${lead.last_name || ""}`)
  )
    reasons.push("Lead name is missing.");
  if (!text(lead.email) && !text(lead.mobile) && !text(lead.phone))
    reasons.push("At least one contact method is required.");
  const followUp = lead.next_follow_up_at
    ? new Date(lead.next_follow_up_at)
    : null;
  const overdue = Boolean(
    followUp && Number.isFinite(followUp.getTime()) && followUp < now,
  );
  return {
    ready: reasons.length === 0,
    reasons,
    overdue,
    score: finite(lead.score),
    scoringConfigured,
  };
}

export async function isLeadScoringConfigured(client, organizationId) {
  const result = await client.query(
    `SELECT EXISTS (
       SELECT 1
         FROM tenant.crm_scoring_rules
        WHERE organization_id=$1 AND status='active'
     ) AS configured`,
    [organizationId],
  );
  return Boolean(result.rows[0]?.configured);
}
export function buildLeadAgingBuckets(rows, now = new Date()) {
  const buckets = { fresh: 0, aging: 0, stale: 0, overdue: 0 };
  for (const row of rows) {
    const updated = new Date(row.updated_at || row.created_at || now);
    const days = Math.max(0, Math.floor((now - updated) / 86400000));
    if (row.next_follow_up_at && new Date(row.next_follow_up_at) < now)
      buckets.overdue += 1;
    else if (days <= 7) buckets.fresh += 1;
    else if (days <= 30) buckets.aging += 1;
    else buckets.stale += 1;
  }
  return buckets;
}
export async function getLeadTimeline(client, context, leadId) {
  const lead = await client.query(
    `SELECT id,code,full_name,status,score,owner_user_id,next_follow_up_at,created_at,updated_at FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, leadId],
  );
  if (!lead.rows[0])
    throw new LeadOperationsError(404, "Lead not found.", "CRM_LEAD_NOT_FOUND");
  const [activities, conversions, assignments] = await Promise.all([
    client.query(
      `SELECT id,activity_type,subject,status,due_at,completed_at,created_at FROM tenant.crm_activities WHERE organization_id=$1 AND lead_id=$2 ORDER BY created_at DESC LIMIT 100`,
      [context.organizationId, leadId],
    ),
    client.query(
      `SELECT id,account_id,contact_id,opportunity_id,created_at FROM tenant.crm_lead_conversions WHERE organization_id=$1 AND lead_id=$2 ORDER BY created_at DESC`,
      [context.organizationId, leadId],
    ),
    client.query(
      `SELECT id,previous_owner_user_id,new_owner_user_id,reason,created_at FROM tenant.crm_lead_assignment_events WHERE organization_id=$1 AND lead_id=$2 ORDER BY created_at DESC LIMIT 100`,
      [context.organizationId, leadId],
    ),
  ]);
  const scoringConfigured = await isLeadScoringConfigured(
    client,
    context.organizationId,
  );
  return {
    lead: lead.rows[0],
    readiness: evaluateLeadReadiness(lead.rows[0], new Date(), {
      scoringConfigured,
    }),
    activities: activities.rows,
    conversions: conversions.rows,
    assignments: assignments.rows,
  };
}
export async function previewLeadAssignment(client, context, input) {
  const policies = await client.query(
    `SELECT id,name,sequence,criteria,mode,assignee_user_id,member_user_ids,territory_id
       FROM tenant.crm_lead_assignment_policies
      WHERE organization_id=$1 AND status='active' ORDER BY sequence,id`,
    [context.organizationId],
  );
  const criteriaMatches = (criteria) =>
    Object.entries(criteria || {}).every(([key, value]) =>
      Array.isArray(value)
        ? value.map(String).includes(String(input[key] ?? ""))
        : String(input[key] ?? "") === String(value),
    );
  const policy = policies.rows.find((item) => criteriaMatches(item.criteria));
  const ownerUserId = await resolveLeadOwner(client, context, input);
  return {
    matched: Boolean(policy),
    policy: policy || null,
    ownerUserId: ownerUserId || input.ownerUserId || null,
  };
}
export async function bulkUpdateLeads(client, context, input) {
  const ids = Array.isArray(input.ids)
    ? [...new Set(input.ids.map(String))]
    : [];
  if (!ids.length || ids.length > 200)
    throw new LeadOperationsError(
      400,
      "Select between 1 and 200 leads.",
      "CRM_LEAD_BULK_SELECTION_INVALID",
    );
  const changes =
    input.changes && typeof input.changes === "object" ? input.changes : {};
  if (
    Object.keys(changes).some((key) => key.startsWith("qualification")) ||
    ["qualified", "unqualified"].includes(String(changes.status || ""))
  )
    throw new LeadOperationsError(
      409,
      "Bulk Lead Qualification is not available. Use the governed per-Lead action.",
      "CRM_LEAD_QUALIFICATION_ACTION_REQUIRED",
    );
  if (
    ["status", "stage", "stageId", "stageCode", "recordStatus"].some(
      (field) => Object.prototype.hasOwnProperty.call(changes, field),
    )
  )
    throw new LeadOperationsError(
      409,
      "Bulk lifecycle movement is not available. Move each Lead through the governed transition action.",
      "CRM_LEAD_STAGE_ACTION_REQUIRED",
    );
  if (Object.prototype.hasOwnProperty.call(changes, "ownerUserId"))
    throw new LeadOperationsError(
      409,
      "Use the governed Lead assignment action to change ownership.",
      "CRM_LEAD_ASSIGNMENT_REQUIRED",
    );
  if (Object.prototype.hasOwnProperty.call(changes, "sourceId")) {
    try {
      await validateLeadSourceAssignment(client, context, changes.sourceId);
    } catch (error) {
      if (error instanceof LeadSourceError)
        throw new LeadOperationsError(
          error.status,
          error.message,
          error.code,
          error.details,
        );
      throw error;
    }
  }
  const allowed = new Map([
    ["sourceId", "source_id"],
    ["nextFollowUpAt", "next_follow_up_at"],
    ["priority", "priority"],
    ["rating", "rating"],
  ]);
  const sets = [];
  const values = [context.organizationId, ids];
  for (const [key, column] of allowed) {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
    values.push(changes[key] === "" ? null : changes[key]);
    sets.push(`${column}=$${values.length}`);
  }
  if (!sets.length)
    throw new LeadOperationsError(
      400,
      "No supported lead changes were supplied.",
      "CRM_LEAD_BULK_CHANGES_EMPTY",
    );
  values.push(context.userId);
  sets.push(`updated_by=$${values.length}`, "updated_at=now()");
  let scope = "";
  if (context.activeCompanyId) {
    values.push(context.activeCompanyId);
    scope += ` AND (company_id IS NULL OR company_id=$${values.length})`;
  } else if (!context.allowAllCompanies) scope += " AND false";
  if (context.activeBranchId) {
    values.push(context.activeBranchId);
    scope += ` AND (branch_id IS NULL OR branch_id=$${values.length})`;
  }
  const canViewAll =
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    Boolean(context.permissions?.includes("crm.records.view_all"));
  if (!canViewAll) {
    values.push(context.userId);
    scope += ` AND (owner_user_id IS NULL OR owner_user_id=$${values.length})`;
  }
  const result = await client.query(
    `UPDATE tenant.crm_leads SET ${sets.join(",")}
      WHERE organization_id=$1 AND id=ANY($2::uuid[])
        AND record_status='active' ${scope}
      RETURNING id,owner_user_id,source_id,status,record_status,priority,rating,next_follow_up_at,updated_at`,
    values,
  );
  return { requested: ids.length, updated: result.rowCount, rows: result.rows };
}
export async function getLeadOperationsDashboard(client, context) {
  const [result, scoringConfigured] = await Promise.all([
    client.query(
      `SELECT id,status,score,next_follow_up_at,created_at,updated_at FROM tenant.crm_leads WHERE organization_id=$1 AND record_status='active'`,
      [context.organizationId],
    ),
    isLeadScoringConfigured(client, context.organizationId),
  ]);
  const readiness = result.rows.map((row) =>
    evaluateLeadReadiness(row, new Date(), { scoringConfigured }),
  );
  return {
    total: result.rowCount,
    ready: readiness.filter((r) => r.ready).length,
    overdue: readiness.filter((r) => r.overdue).length,
    aging: buildLeadAgingBuckets(result.rows),
  };
}
