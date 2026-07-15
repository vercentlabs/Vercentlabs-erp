import { notFound } from "next/navigation";
import RoleManager from "@/components/role-manager";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { query } from "@/lib/db";

export const metadata = { title: "Roles and permissions" };
export default async function RolesPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.rolesManage)) notFound();
  const organizationId = session.organizationId as string;

  const roleRows = await query<{
    id: string;
    name: string;
    slug: string;
    description: string;
    is_system: boolean;
    permission_keys: string[] | null;
    user_count: number;
  }>(
    `
    SELECT r.id,r.name,r.slug,r.description,r.is_system,
      COALESCE(array_agg(rp.permission_key ORDER BY rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), ARRAY[]::text[]) AS permission_keys,
      (SELECT count(*)::int FROM user_role_assignments ura WHERE ura.organization_id=r.organization_id AND ura.role_id=r.id) AS user_count
    FROM roles r LEFT JOIN role_permissions rp ON rp.role_id=r.id
    WHERE r.organization_id=$1 AND r.status='active'
    GROUP BY r.id ORDER BY CASE WHEN r.slug='organization_owner' THEN 0 WHEN r.is_system THEN 1 ELSE 2 END,r.name
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
  const roles = roleRows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    isSystem: row.is_system,
    permissionKeys: row.permission_keys || [],
    userCount: row.user_count,
  }));
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Role-based access control</p>
          <h1>Roles and permissions</h1>
          <p>
            Use system roles or create custom least-privilege roles for your
            operating model.
          </p>
        </div>
      </section>
      <RoleManager roles={roles} permissions={permissions} />
    </>
  );
}
