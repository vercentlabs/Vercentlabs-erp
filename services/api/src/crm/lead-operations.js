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
export function evaluateLeadReadiness(lead, now = new Date()) {
  const reasons = [];
  if (
    !text(lead.full_name || `${lead.first_name || ""} ${lead.last_name || ""}`)
  )
    reasons.push("Lead name is missing.");
  if (!text(lead.email) && !text(lead.mobile) && !text(lead.phone))
    reasons.push("At least one contact method is required.");
  if (!text(lead.company_name)) reasons.push("Company is missing.");
  if (!text(lead.product_interest))
    reasons.push("Product interest is missing.");
  if (finite(lead.score) < 20)
    reasons.push("Lead score is below the conversion threshold.");
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
  };
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
  return {
    lead: lead.rows[0],
    readiness: evaluateLeadReadiness(lead.rows[0]),
    activities: activities.rows,
    conversions: conversions.rows,
    assignments: assignments.rows,
  };
}
export async function previewLeadAssignment(client, context, input) {
  const policies = await client.query(
    `SELECT id,name,sequence,criteria,mode,assignee_user_id,member_user_ids,territory_id FROM tenant.crm_lead_assignment_policies WHERE organization_id=$1 AND status='active' ORDER BY sequence,id`,
    [context.organizationId],
  );
  const matches = (criteria) =>
    Object.entries(criteria || {}).every(([key, value]) =>
      Array.isArray(value)
        ? value.map(String).includes(String(input[key] ?? ""))
        : String(input[key] ?? "") === String(value),
    );
  const policy = policies.rows.find((item) => matches(item.criteria));
  if (!policy)
    return {
      matched: false,
      policy: null,
      ownerUserId: input.ownerUserId || null,
    };
  const ownerUserId =
    policy.mode === "fixed"
      ? policy.assignee_user_id
      : policy.mode === "round_robin"
        ? (policy.member_user_ids || [])[0] || null
        : null;
  return { matched: true, policy, ownerUserId };
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
  const allowed = new Map([
    ["ownerUserId", "owner_user_id"],
    ["status", "status"],
    ["leadSource", "lead_source"],
    ["nextFollowUpAt", "next_follow_up_at"],
    ["priority", "priority"],
  ]);
  const changes =
    input.changes && typeof input.changes === "object" ? input.changes : {};
  const sets = [];
  const values = [context.organizationId, ids];
  for (const [key, column] of allowed)
    if (Object.prototype.hasOwnProperty.call(changes, key)) {
      values.push(changes[key] || null);
      sets.push(`${column}=$${values.length}`);
    }
  if (!sets.length)
    throw new LeadOperationsError(
      400,
      "No supported lead changes were supplied.",
      "CRM_LEAD_BULK_CHANGES_EMPTY",
    );
  sets.push("updated_at=now()", `updated_by=$${values.push(context.userId)}`);
  const result = await client.query(
    `UPDATE tenant.crm_leads SET ${sets.join(",")} WHERE organization_id=$1 AND id=ANY($2::uuid[]) AND status NOT IN ('converted','archived') RETURNING id,owner_user_id,status,next_follow_up_at,updated_at`,
    values,
  );
  return { requested: ids.length, updated: result.rowCount, rows: result.rows };
}
export async function getLeadOperationsDashboard(client, context) {
  const result = await client.query(
    `SELECT id,status,score,next_follow_up_at,created_at,updated_at FROM tenant.crm_leads WHERE organization_id=$1 AND status NOT IN ('archived','converted')`,
    [context.organizationId],
  );
  const readiness = result.rows.map((row) => evaluateLeadReadiness(row));
  return {
    total: result.rowCount,
    ready: readiness.filter((r) => r.ready).length,
    overdue: readiness.filter((r) => r.overdue).length,
    aging: buildLeadAgingBuckets(result.rows),
  };
}
