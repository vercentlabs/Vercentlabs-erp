// Rebuilds a member's CURRENT authority for work that runs later on their
// behalf (a background report run): active membership, active role
// assignments -> permissions as they are now - never the permissions they
// had when they clicked "Run". Returns null when the member can no longer
// act (removed or deactivated).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveMemberExecutionContext(client, organizationId, { userId }) {
  if (!UUID.test(String(userId || ""))) return null;
  const { rows } = await client.query(
    `SELECT COALESCE(array_agg(DISTINCT role.slug) FILTER (WHERE role.slug IS NOT NULL), ARRAY[]::text[]) AS role_slugs,
            COALESCE(array_agg(DISTINCT permission.permission_key) FILTER (WHERE permission.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
       FROM public.organization_memberships membership
       JOIN public.users account ON account.id = membership.user_id AND account.status = 'active'
       LEFT JOIN public.user_role_assignments assignment
         ON assignment.organization_id = membership.organization_id AND assignment.user_id = membership.user_id
        AND assignment.status = 'active' AND assignment.starts_at <= now() AND (assignment.expires_at IS NULL OR assignment.expires_at > now())
       LEFT JOIN public.roles role ON role.organization_id = assignment.organization_id AND role.id = assignment.role_id AND role.status = 'active'
       LEFT JOIN public.role_permissions permission ON permission.role_id = role.id
      WHERE membership.organization_id = $1 AND membership.user_id = $2 AND membership.status = 'active'
      GROUP BY membership.user_id`,
    [organizationId, userId],
  );
  if (!rows[0]) return null;
  const roleSlugs = rows[0].role_slugs;
  const permissions = rows[0].permissions;
  return Object.freeze({ organizationId, userId, permissions, roleSlugs, emailVerified: true });
}
