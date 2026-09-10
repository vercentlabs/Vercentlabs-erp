// Prompt 6 (CRM-CAP-004): the shared in-app notification helper. This
// exact INSERT shape (organization/active-membership check + per-category
// notification_preferences gate) was previously copy-pasted three times
// (services/api/src/modules/crm/index.js's notifyLeadAssignmentOwner, the
// crm.automation "notification" action, and shared-platform.ts's workflow
// "notify" action) — factored out here as F016's reminder/escalation
// delivery is a fourth call site. Real, working in-app delivery; email
// delivery is a separate, explicit function (see sendReminderEmail in
// follow-up-operations.js) since email uses a different transport, and
// there is no platform push-notification mechanism (no device-token
// table exists) — push is deliberately not offered as a channel.
export async function createInAppNotification(client, context, { userId, type, category, title, message, href = null }) {
  if (!userId) return false;
  const result = await client.query(
    `INSERT INTO notifications(organization_id,user_id,type,title,message,href)
     SELECT $1,$2,$3,$4,$5,$6
     WHERE EXISTS(SELECT 1 FROM organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='active')
       AND COALESCE((SELECT enabled FROM notification_preferences
         WHERE organization_id=$1 AND user_id=$2 AND channel='in_app' AND category=$7),true)
     RETURNING id`,
    [context.organizationId, userId, type, title, message, href, category],
  );
  return Boolean(result.rows[0]);
}

// Resolves the escalation target for a user: their active sales-team
// membership's manager (crm_sales_team_members -> crm_sales_teams.
// manager_user_id). No generic org-wide "manager" concept exists in this
// codebase outside the CRM sales-team hierarchy (organization_memberships.
// role is only owner/admin/member) — this is the real, populated schema
// Prompt 4/5's assignment/territory code already relies on, not new
// invented schema. Returns null (no crash, no fake escalation target) when
// the user has no active team membership or their team has no manager
// configured — callers must treat that as "escalation not resolvable",
// not as an error.
export async function getManagerForUser(client, organizationId, userId) {
  if (!userId) return null;
  const result = await client.query(
    `SELECT team.manager_user_id
       FROM tenant.crm_sales_team_members member
       JOIN tenant.crm_sales_teams team
         ON team.organization_id = member.organization_id AND team.id = member.team_id
      WHERE member.organization_id = $1
        AND member.user_id = $2
        AND member.status = 'active'
        AND team.status = 'active'
        AND team.manager_user_id IS NOT NULL
        AND team.manager_user_id <> $2
      ORDER BY member.member_role = 'seller' DESC, member.created_at ASC
      LIMIT 1`,
    [organizationId, userId],
  );
  return result.rows[0]?.manager_user_id || null;
}
