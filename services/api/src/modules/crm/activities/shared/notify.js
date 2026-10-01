// In-app notifications are written by the Shared Platform service
// (core/platform/notifications: createNotification). This file keeps only the
// CRM-specific escalation lookup.

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
