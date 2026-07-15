import UserAdministration, {
  type UserRow,
} from "@/components/user-administration";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { query } from "@/lib/db";

export const metadata = { title: "Users" };
export default async function UsersPage() {
  const session = await requireWorkspace();
  const organizationId = session.organizationId as string;

  const userRows = await query<{
    user_id: string;
    full_name: string;
    email: string;
    status: "active" | "disabled";
    role_id: string | null;
    role_name: string | null;
    role_slug: string | null;
    email_verified_at: Date | null;
    last_login_at: Date | null;
    company_ids: string[] | null;
    branch_ids: string[] | null;
    department_ids: string[] | null;
  }>(
    `
    SELECT
      u.id AS user_id, u.full_name, u.email, m.status,
      r.id AS role_id, r.name AS role_name, r.slug AS role_slug,
      u.email_verified_at, u.last_login_at,
      COALESCE((SELECT array_agg(a.company_id) FROM membership_company_access a WHERE a.organization_id=m.organization_id AND a.user_id=u.id), ARRAY[]::uuid[]) AS company_ids,
      COALESCE((SELECT array_agg(a.branch_id) FROM membership_branch_access a WHERE a.organization_id=m.organization_id AND a.user_id=u.id), ARRAY[]::uuid[]) AS branch_ids,
      COALESCE((SELECT array_agg(a.department_id) FROM membership_department_access a WHERE a.organization_id=m.organization_id AND a.user_id=u.id), ARRAY[]::uuid[]) AS department_ids
    FROM organization_memberships m
    JOIN users u ON u.id=m.user_id
    LEFT JOIN user_role_assignments ura ON ura.organization_id=m.organization_id AND ura.user_id=u.id
    LEFT JOIN roles r ON r.id=ura.role_id
    WHERE m.organization_id=$1
    ORDER BY CASE WHEN r.slug='organization_owner' THEN 0 ELSE 1 END, u.full_name
  `,
    [organizationId],
  );

  const invitationRows = await query<{
    id: string;
    email: string;
    role_name: string;
    expires_at: Date;
    revoked_at: Date | null;
    accepted_at: Date | null;
  }>(
    `
    SELECT i.id,i.email,COALESCE(r.name,i.role) AS role_name,i.expires_at,i.revoked_at,i.accepted_at
    FROM organization_invitations i LEFT JOIN roles r ON r.id=i.role_id
    WHERE i.organization_id=$1 ORDER BY i.created_at DESC LIMIT 100
  `,
    [organizationId],
  );

  const [roles, companies, branches, departments] = await Promise.all([
    query<{ id: string; name: string; slug: string }>(
      "SELECT id,name,slug FROM roles WHERE organization_id=$1 AND status='active' ORDER BY CASE WHEN slug='organization_owner' THEN 0 WHEN is_system THEN 1 ELSE 2 END,name",
      [organizationId],
    ),
    query<{ id: string; name: string }>(
      "SELECT id,name FROM companies WHERE organization_id=$1 AND status='active' ORDER BY is_primary DESC,name",
      [organizationId],
    ),
    query<{ id: string; name: string; company_id: string }>(
      "SELECT id,name,company_id FROM branches WHERE organization_id=$1 AND status='active' ORDER BY is_primary DESC,name",
      [organizationId],
    ),
    query<{ id: string; name: string }>(
      "SELECT id,name FROM departments WHERE organization_id=$1 AND status='active' ORDER BY name",
      [organizationId],
    ),
  ]);

  const users: UserRow[] = userRows.map((row) => ({
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    status: row.status,
    roleId: row.role_id,
    roleName: row.role_name,
    roleSlug: row.role_slug,
    companyIds: (row.company_ids || []).map(String),
    branchIds: (row.branch_ids || []).map(String),
    departmentIds: (row.department_ids || []).map(String),
    emailVerified: Boolean(row.email_verified_at),
    lastLoginAt: row.last_login_at?.toISOString() || null,
  }));

  const invitations = invitationRows.map((row) => ({
    id: row.id,
    email: row.email,
    roleName: row.role_name,
    expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() || null,
    acceptedAt: row.accepted_at?.toISOString() || null,
  }));
  const canManage = hasPermission(session, PERMISSIONS.usersManage);

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Access administration</p>
          <h1>Users and invitations</h1>
          <p>
            Assign least-privilege roles and company or branch access for every
            organisation member.
          </p>
        </div>
        {canManage ? (
          <span className="status-badge">Manage access</span>
        ) : (
          <span className="status-badge neutral">Read only</span>
        )}
      </section>
      <UserAdministration
        users={users}
        invitations={invitations}
        roles={roles}
        companies={companies}
        branches={branches.map((row) => ({
          id: row.id,
          name: row.name,
          companyId: row.company_id,
        }))}
        departments={departments}
        canManage={canManage}
        currentUserId={session.userId}
      />
    </>
  );
}
