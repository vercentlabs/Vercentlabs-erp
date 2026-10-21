// Who a record made without a person (a web form, a website chat, a WhatsApp message, a lead connector, an automation) is recorded as
// (CRM audit B13): the given member (the connector's creator, the lead's owner) while they are still an active member; else the
// organization's creator while still active; else its longest-standing active owner. Never someone who has left: their name on new
// leads, and a manager fallback pointing at them, would send work nowhere.
const ACTIVE = `JOIN public.organization_memberships member ON member.organization_id = $1 AND member.user_id = candidate.user_id AND member.status = 'active'
  JOIN public.users person ON person.id = candidate.user_id AND person.status = 'active'`;
const OWNERS = `SELECT owner_role.user_id, 3 AS rank, owner_role.created_at FROM public.user_role_assignments owner_role
  JOIN public.roles role ON role.id = owner_role.role_id
 WHERE owner_role.organization_id = $1 AND owner_role.status = 'active' AND role.slug = 'organization_owner'`;

export async function integrationActor(client, organizationId, preferredUserId = null) {
  const { rows } = await client.query(
    `SELECT candidate.user_id FROM (
       SELECT $2::uuid AS user_id, 1 AS rank, NULL::timestamptz AS created_at
       UNION ALL SELECT organization.created_by, 2, NULL FROM public.organizations organization WHERE organization.id = $1
       UNION ALL ${OWNERS}) candidate
     ${ACTIVE}
     WHERE candidate.user_id IS NOT NULL ORDER BY candidate.rank, candidate.created_at NULLS FIRST LIMIT 1`,
    [organizationId, preferredUserId]);
  return rows[0]?.user_id ?? null;
}

// SQL (with $1 the organization): the active member a manager-less notice falls back to — the creator while active, else an owner —
// never `exceptExpr`.
export const fallbackManagerSql = (exceptExpr) => `(SELECT candidate.user_id FROM (
    SELECT organization.created_by AS user_id, 2 AS rank, NULL::timestamptz AS created_at FROM public.organizations organization WHERE organization.id = $1
    UNION ALL ${OWNERS}) candidate
  ${ACTIVE}
  WHERE candidate.user_id IS NOT NULL AND candidate.user_id IS DISTINCT FROM ${exceptExpr} ORDER BY candidate.rank, candidate.created_at NULLS FIRST LIMIT 1)`;
