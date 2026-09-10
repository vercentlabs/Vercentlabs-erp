// F005 Lead assignment — fallback owner and out-of-office windows.
import { LeadGovernanceError, text, UUID } from "./shared.js";
import { assertEligibleLeadAssignee } from "./eligibility.js";

export async function getLeadAssignmentFallback(client, context) {
  const result = await client.query(
    `SELECT fallback.fallback_user_id,fallback.updated_at,user_account.full_name AS fallback_user_name,user_account.email AS fallback_user_email
       FROM tenant.crm_lead_assignment_fallback fallback
       LEFT JOIN public.users user_account ON user_account.id=fallback.fallback_user_id
      WHERE fallback.organization_id=$1`,
    [context.organizationId],
  );
  return result.rows[0] || { fallback_user_id: null, updated_at: null, fallback_user_name: null, fallback_user_email: null };
}

export async function setLeadAssignmentFallback(client, context, userId) {
  const fallbackUserId = text(userId) || null;
  if (fallbackUserId) await assertEligibleLeadAssignee(client, context, fallbackUserId);
  const result = await client.query(
    `INSERT INTO tenant.crm_lead_assignment_fallback(organization_id,fallback_user_id,updated_by)
     VALUES($1,$2,$3)
     ON CONFLICT(organization_id) DO UPDATE SET fallback_user_id=$2,updated_by=$3,updated_at=now()
     RETURNING *`,
    [context.organizationId, fallbackUserId, context.userId],
  );
  return result.rows[0];
}

export async function listLeadAssigneeAvailability(client, context) {
  const result = await client.query(
    `SELECT availability.*,user_account.full_name AS user_name,user_account.email AS user_email
       FROM tenant.crm_lead_assignee_availability availability
       JOIN public.users user_account ON user_account.id=availability.user_id
      WHERE availability.organization_id=$1 AND availability.ends_at>now()
      ORDER BY availability.starts_at`,
    [context.organizationId],
  );
  return result.rows;
}

export async function setLeadAssigneeAvailability(client, context, input = {}) {
  const userId = text(input.userId);
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  const reason = text(input.reason).slice(0, 500) || null;
  if (!UUID.test(userId))
    throw new LeadGovernanceError(400, "Select a valid team member.", "CRM_ASSIGNEE_AVAILABILITY_INVALID");
  if (!Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || endsAt <= startsAt)
    throw new LeadGovernanceError(400, "Provide a valid start and end date, with the end after the start.", "CRM_ASSIGNEE_AVAILABILITY_INVALID");
  await assertEligibleLeadAssignee(client, context, userId);
  const result = await client.query(
    `INSERT INTO tenant.crm_lead_assignee_availability(organization_id,user_id,starts_at,ends_at,reason,created_by)
     VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,
    [context.organizationId, userId, startsAt.toISOString(), endsAt.toISOString(), reason, context.userId],
  );
  return result.rows[0];
}

export async function clearLeadAssigneeAvailability(client, context, id) {
  const result = await client.query(
    `DELETE FROM tenant.crm_lead_assignee_availability WHERE organization_id=$1 AND id=$2 RETURNING id`,
    [context.organizationId, text(id)],
  );
  if (!result.rows[0])
    throw new LeadGovernanceError(404, "Availability window not found.", "CRM_ASSIGNEE_AVAILABILITY_NOT_FOUND");
  return { id: result.rows[0].id };
}
