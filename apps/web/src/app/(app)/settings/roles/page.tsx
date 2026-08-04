import AccessDenied from "@/components/access-denied";
import RoleManager from "@/components/role-manager";
import { analyzePermissionConflicts } from "@/lib/access-control";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { query } from "@/lib/db";

export const metadata = { title: "Roles and permissions" };

export default async function RolesPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.rolesView)) {
    return <AccessDenied area="roles and permissions" returnHref="/settings" />;
  }
  const organizationId = session.organizationId;
  const roleRows = await query<{
    id: string;
    name: string;
    slug: string;
    description: string;
    is_system: boolean;
    assignable: boolean;
    module_key: string;
    risk_level: "standard" | "sensitive" | "privileged";
    version: number;
    permission_keys: string[] | null;
    user_count: number;
  }>(
    `
      SELECT r.id,r.name,r.slug,r.description,r.is_system,r.assignable,
             r.module_key,r.risk_level,r.version,
             COALESCE(array_agg(rp.permission_key ORDER BY rp.permission_key)
               FILTER (WHERE rp.permission_key IS NOT NULL),ARRAY[]::text[]) AS permission_keys,
             (SELECT count(*)::int FROM user_role_assignments ura
               WHERE ura.organization_id=r.organization_id AND ura.role_id=r.id
                 AND ura.status='active'
                 AND ura.starts_at<=now()
                 AND (ura.expires_at IS NULL OR ura.expires_at>now())) AS user_count
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id=r.id
      WHERE r.organization_id=$1 AND r.status='active'
        AND (
          r.module_key='platform'
          OR EXISTS (
            SELECT 1 FROM organization_modules module
             WHERE module.organization_id=r.organization_id
               AND module.module_key=r.module_key
               AND module.status='enabled'
          )
        )
      GROUP BY r.id
      ORDER BY CASE WHEN r.slug='organization_owner' THEN 0 WHEN r.is_system THEN 1 ELSE 2 END,
               r.module_key,r.name
    `,
    [organizationId],
  );
  const permissions = await query<{
    key: string;
    name: string;
    category: string;
    description: string;
  }>(
    "SELECT key,name,category,description FROM permissions ORDER BY category,name",
  );
  const canManage = hasPermission(session, PERMISSIONS.rolesManage);
  const unrestricted = session.roleSlugs.includes("organization_owner");
  const grantable = new Set(session.permissions);
  const roles = roleRows.map((row) => {
    const permissionKeys = row.permission_keys || [];
    return {
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      isSystem: row.is_system,
      assignable: row.assignable,
      moduleKey: row.module_key,
      riskLevel: row.risk_level,
      version: row.version,
      permissionKeys,
      userCount: row.user_count,
      conflicts: analyzePermissionConflicts(permissionKeys),
      canManage:
        canManage &&
        row.slug !== "organization_owner" &&
        (unrestricted || permissionKeys.every((key) => grantable.has(key))),
    };
  });
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Role-based access control</p>
          <h1>Roles and permissions</h1>
          <p>
            Combine job roles, keep one primary role, restrict organisational
            scope and review segregation-of-duties conflicts before assignment.
          </p>
        </div>
      </section>
      <RoleManager
        roles={roles}
        permissions={permissions.filter(
          (permission) => unrestricted || grantable.has(permission.key),
        )}
        canManage={canManage}
      />
    </>
  );
}
