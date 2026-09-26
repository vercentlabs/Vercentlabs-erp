import { createNotification } from "../../../core/platform/notifications/index.js";
import { projectLeadForContext } from "./lead-security.js";
import { assertEligibleLeadAssignee } from "./lead-governance.js";
import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { queueOutboxEvent } from "../crm-data-operations-and-customization/outbox.js";
import { canAssignLeadOwners, recordScope } from "../crm-data-operations-and-customization/record-policy.js";
import { assertCrmOwnerAssignable, canViewAllCrmResource } from "../crm-data-operations-and-customization/crm-access-scope.js";
import { resources } from "../crm-data-operations-and-customization/resource-registry.js";
import { camelizeRow } from "../crm-data-operations-and-customization/record-utils.js";
import { assertLeadExpectedVersion } from "../crm-data-operations-and-customization/resource-validation.js";



// F005: gated on the same in-app notification infra + preference table
// every other notification-emitting path uses (see workflow-run "notify"
// action in shared-platform.ts) — no separate CRM notification channel.
async function notifyLeadAssignmentOwner(client, context, { ownerUserId, leadId, leadName, reason }) {
  if (!ownerUserId || ownerUserId === context.userId) return;
  await createNotification(client, {
    organizationId: context.organizationId,
    userId: ownerUserId,
    category: "crm_assignment",
    title: "New Lead assigned to you",
    message: `${leadName || "A Lead"} was assigned to you (${reason || "manual"}).`,
    href: `/crm/leads/${leadId}`,
    entityType: "crm_lead",
    entityId: leadId,
  });
}



export async function recordLeadAssignment(
  client,
  context,
  {
    leadId,
    previousOwnerUserId = null,
    ownerUserId = null,
    policyId = null,
    reason = "manual",
    evaluationTrace = null,
    isOverride = false,
    leadName = null,
  },
) {
  if ((previousOwnerUserId || null) === (ownerUserId || null)) return null;
  const event = await client.query(
    `INSERT INTO tenant.crm_lead_assignment_events
       (organization_id,lead_id,previous_owner_user_id,new_owner_user_id,policy_id,reason,evaluation_trace,is_override,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
     RETURNING id,lead_id,previous_owner_user_id,new_owner_user_id,policy_id,reason,evaluation_trace,is_override,created_by,created_at`,
    [
      context.organizationId,
      leadId,
      previousOwnerUserId || null,
      ownerUserId || null,
      policyId || null,
      String(reason || "manual").slice(0, 120),
      JSON.stringify(evaluationTrace || {}),
      Boolean(isOverride),
      context.userId || null,
    ],
  );
  await queueOutboxEvent(
    client,
    context,
    "crm.leads.assigned",
    "leads",
    leadId,
    {
      previousOwnerUserId: previousOwnerUserId || null,
      ownerUserId: ownerUserId || null,
      policyId: policyId || null,
      reason: String(reason || "manual").slice(0, 120),
      isOverride: Boolean(isOverride),
    },
  );
  await notifyLeadAssignmentOwner(client, context, { ownerUserId, leadId, leadName, reason });
  return camelizeRow(event.rows[0]);
}



export async function assignLeadOwner(
  client,
  context,
  leadId,
  ownerUserId,
  options = {},
) {
  if (!canAssignLeadOwners(context))
    throw new CrmError(
      403,
      "You do not have permission to assign Leads.",
      "CRM_LEAD_ASSIGNMENT_FORBIDDEN",
    );
  if (
    ownerUserId !== null &&
    ownerUserId !== "" &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      String(ownerUserId),
    )
  )
    throw new CrmError(
      400,
      "Select a valid Lead owner.",
      "CRM_LEAD_ASSIGNEE_NOT_FOUND",
    );
  // Self, own team (Sales Manager) or anyone (view-all) — never an arbitrary
  // user. Checked before the Lead is even read.
  await assertCrmOwnerAssignable(client, context, ownerUserId ? String(ownerUserId) : null, "You can only assign Leads to yourself or to members of a team you manage.", { resource: "leads" });
  const parameters = [context.organizationId, leadId];
  const scope = recordScope(resources.leads, context, parameters);
  const current = await client.query(
    `SELECT record.* FROM tenant.crm_leads record
      WHERE record.organization_id=$1 AND record.id=$2${scope}
      FOR UPDATE`,
    parameters,
  );
  if (!current.rows[0])
    throw new CrmError(404, "CRM record not found.", "CRM_LEAD_NOT_FOUND");
  const before = camelizeRow(current.rows[0]);
  assertLeadExpectedVersion(
    before,
    options.expectedUpdatedAt,
    options.requireVersion === true,
  );
  const normalizedOwner = ownerUserId ? String(ownerUserId) : null;
  if ((before.ownerUserId || null) === normalizedOwner)
    return {
      lead: projectLeadForContext(context, before),
      assignment: {
        changed: false,
        previousOwnerUserId: before.ownerUserId || null,
        ownerUserId: before.ownerUserId || null,
      },
    };
  let assignee = null;
  let isOverride = false;
  if (normalizedOwner) {
    try {
      assignee = await assertEligibleLeadAssignee(
        client,
        context,
        normalizedOwner,
        { companyId: before.companyId, branchId: before.branchId },
      );
    } catch (error) {
      if (error?.code !== "CRM_LEAD_ASSIGNEE_SCOPE_INVALID") throw error;
      // F005 manual override: the caller already holds canAssignLeadOwners'
      // elevated permission (organization_owner, or view_all+leads.manage)
      // to reach this function at all — an eligibility-check failure alone
      // does not block them, but they must say explicitly that they intend
      // an override and why, so a genuinely mistaken owner ID still fails
      // closed by default.
      // The eligibility override stays an elevated (view-all) action.
      if (!canViewAllCrmResource(context, "leads")) throw new CrmError(409, error.message, error.code);
      const overrideReason = String(options.overrideReason ?? "").trim();
      if (!options.override || !overrideReason)
        throw new CrmError(409, error.message, error.code);
      if (overrideReason.length < 3)
        throw new CrmError(400, "Explain the override in at least 3 characters.", "CRM_LEAD_ASSIGNMENT_OVERRIDE_REASON_REQUIRED");
      isOverride = true;
    }
  }
  const updated = await client.query(
    `UPDATE tenant.crm_leads SET owner_user_id=$3,updated_by=$4,updated_at=now()
      WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, leadId, normalizedOwner, context.userId],
  );
  const lead = camelizeRow(updated.rows[0]);
  const event = await recordLeadAssignment(client, context, {
    leadId,
    previousOwnerUserId: before.ownerUserId || null,
    ownerUserId: normalizedOwner,
    reason: isOverride ? `override:${String(options.overrideReason).trim().slice(0, 100)}` : options.reason || "manual",
    isOverride,
    leadName: before.fullName || before.firstName || null,
  });
  return {
    lead: projectLeadForContext(context, lead),
    assignment: {
      changed: true,
      eventId: event?.id || null,
      previousOwnerUserId: before.ownerUserId || null,
      ownerUserId: normalizedOwner,
      isOverride,
      owner: assignee
        ? { id: assignee.id, name: assignee.name, email: assignee.email }
        : null,
    },
  };
}
