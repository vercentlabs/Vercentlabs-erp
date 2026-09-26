// Rebuilds a member's CURRENT authority for work that runs later on their
// behalf (a background report run): active membership, active role
// assignments -> permissions, and company/branch access as it is now - never
// the permissions they had when they clicked "Run". Returns null when the
// member can no longer act (removed, deactivated, lost the company).
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveMemberExecutionContext(client, organizationId, { userId, activeCompanyId = null, activeBranchId = null }) {
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
  const allowAllCompanies = roleSlugs.includes("organization_owner") || roleSlugs.includes("system_administrator");
  if (activeCompanyId) {
    const { rows: company } = await client.query(
      `SELECT 1 FROM public.companies company WHERE company.organization_id=$1 AND company.id=$2 AND company.status='active'
          AND ($3::boolean OR EXISTS (SELECT 1 FROM public.membership_company_access access WHERE access.organization_id=$1 AND access.user_id=$4 AND access.company_id=company.id))`,
      [organizationId, activeCompanyId, allowAllCompanies, userId],
    );
    if (!company[0]) return null;
  }
  if (activeBranchId) {
    const { rows: branch } = await client.query(
      `SELECT 1 FROM public.branches branch WHERE branch.organization_id=$1 AND branch.id=$2 AND branch.status='active'
          AND ($3::boolean OR EXISTS (SELECT 1 FROM public.membership_branch_access access WHERE access.organization_id=$1 AND access.user_id=$4 AND access.branch_id=branch.id))`,
      [organizationId, activeBranchId, allowAllCompanies, userId],
    );
    if (!branch[0]) return null;
  }
  return Object.freeze({ organizationId, userId, activeCompanyId, activeBranchId, companyId: activeCompanyId, allowAllCompanies, permissions, roleSlugs, emailVerified: true });
}
