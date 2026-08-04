import { notFound } from "next/navigation";

import UserAdministration, {
  type UserRow,
} from "@/components/user-administration";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { query } from "@/lib/db";

type UserDatabaseRow = {
  user_id: string;
  full_name: string;
  email: string;
  status: "active" | "disabled";
  role_ids: string[] | null;
  role_names: string[] | null;
  role_slugs: string[] | null;
  primary_role_id: string | null;
  access_starts_at: Date | null;
  access_expires_at: Date | null;
  email_verified_at: Date | null;
  last_login_at: Date | null;
  company_ids: string[] | null;
  branch_ids: string[] | null;
  department_ids: string[] | null;
  team_ids: string[] | null;
};

type InvitationDatabaseRow = {
  id: string;
  email: string;
  role_names: string[] | null;
  expires_at: Date;
  revoked_at: Date | null;
  accepted_at: Date | null;
};

type RoleDatabaseRow = {
  id: string;
  name: string;
  slug: string;
  module_key: string;
  risk_level: string;
  permission_keys: string[] | null;
};

export const metadata = { title: "Users" };
export default async function UsersPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.usersView)) notFound();
  const organizationId = session.organizationId as string;
  const unrestricted =
    session.roleSlugs.includes("organization_owner") ||
    session.roleSlugs.includes("system_administrator");
  const isOwner = session.roleSlugs.includes("organization_owner");

  const [
    userRows,
    invitationRows,
    roleRows,
    companies,
    branchRows,
    departmentRows,
    teamRows,
  ] = await Promise.all([
    query<UserDatabaseRow>(
      `SELECT u.id AS user_id,u.full_name,u.email,m.status,
          COALESCE((SELECT array_agg(ura.role_id ORDER BY ura.is_primary DESC,r.name)
            FROM user_role_assignments ura JOIN roles r ON r.id=ura.role_id
            WHERE ura.organization_id=m.organization_id AND ura.user_id=u.id
              AND ura.status='active'),ARRAY[]::uuid[]) AS role_ids,
          COALESCE((SELECT array_agg(r.name ORDER BY ura.is_primary DESC,r.name)
            FROM user_role_assignments ura JOIN roles r ON r.id=ura.role_id
            WHERE ura.organization_id=m.organization_id AND ura.user_id=u.id
              AND ura.status='active'),ARRAY[]::text[]) AS role_names,
          COALESCE((SELECT array_agg(r.slug ORDER BY ura.is_primary DESC,r.name)
            FROM user_role_assignments ura JOIN roles r ON r.id=ura.role_id
            WHERE ura.organization_id=m.organization_id AND ura.user_id=u.id
              AND ura.status='active'),ARRAY[]::text[]) AS role_slugs,
          (SELECT ura.role_id FROM user_role_assignments ura
            WHERE ura.organization_id=m.organization_id AND ura.user_id=u.id
              AND ura.status='active' AND ura.is_primary LIMIT 1) AS primary_role_id,
          (SELECT min(ura.starts_at) FROM user_role_assignments ura
            WHERE ura.organization_id=m.organization_id AND ura.user_id=u.id
              AND ura.status='active') AS access_starts_at,
          (SELECT CASE WHEN bool_or(ura.expires_at IS NULL) THEN NULL
                       ELSE max(ura.expires_at) END
            FROM user_role_assignments ura
            WHERE ura.organization_id=m.organization_id AND ura.user_id=u.id
              AND ura.status='active') AS access_expires_at,
          u.email_verified_at,u.last_login_at,
          COALESCE((SELECT array_agg(a.company_id) FROM membership_company_access a
            WHERE a.organization_id=m.organization_id AND a.user_id=u.id),ARRAY[]::uuid[]) AS company_ids,
          COALESCE((SELECT array_agg(a.branch_id) FROM membership_branch_access a
            WHERE a.organization_id=m.organization_id AND a.user_id=u.id),ARRAY[]::uuid[]) AS branch_ids,
          COALESCE((SELECT array_agg(a.department_id) FROM membership_department_access a
            WHERE a.organization_id=m.organization_id AND a.user_id=u.id),ARRAY[]::uuid[]) AS department_ids,
          COALESCE((SELECT array_agg(a.team_id) FROM membership_team_access a
            WHERE a.organization_id=m.organization_id AND a.user_id=u.id),ARRAY[]::uuid[]) AS team_ids
        FROM organization_memberships m JOIN users u ON u.id=m.user_id
        WHERE m.organization_id=$1
          AND ($3::boolean OR EXISTS(
            SELECT 1 FROM membership_company_access actor_access
            JOIN membership_company_access target_access
              ON target_access.organization_id=actor_access.organization_id
             AND target_access.company_id=actor_access.company_id
            WHERE actor_access.organization_id=m.organization_id
              AND actor_access.user_id=$2 AND target_access.user_id=u.id))
        ORDER BY u.full_name`,
      [organizationId, session.userId, unrestricted],
    ),
    query<InvitationDatabaseRow>(
      `SELECT i.id,i.email,i.expires_at,i.revoked_at,i.accepted_at,
          COALESCE((SELECT array_agg(r.name ORDER BY invitation_role.is_primary DESC,r.name)
            FROM organization_invitation_roles invitation_role
            JOIN roles r ON r.id=invitation_role.role_id
            WHERE invitation_role.invitation_id=i.id),
            ARRAY[COALESCE(primary_role.name,i.role)]::text[]) AS role_names
        FROM organization_invitations i
        LEFT JOIN roles primary_role ON primary_role.id=i.role_id
        WHERE i.organization_id=$1
          AND ($3::boolean OR EXISTS(
            SELECT 1 FROM membership_company_access actor_access
            JOIN organization_invitation_company_access invitation_access
              ON invitation_access.organization_id=actor_access.organization_id
             AND invitation_access.company_id=actor_access.company_id
            WHERE actor_access.organization_id=i.organization_id
              AND actor_access.user_id=$2
              AND invitation_access.invitation_id=i.id))
        ORDER BY i.created_at DESC LIMIT 100`,
      [organizationId, session.userId, unrestricted],
    ),
    query<RoleDatabaseRow>(
      `SELECT r.id,r.name,r.slug,r.module_key,r.risk_level,
          COALESCE(array_agg(role_permission.permission_key ORDER BY role_permission.permission_key)
            FILTER (WHERE role_permission.permission_key IS NOT NULL),ARRAY[]::text[]) AS permission_keys
        FROM roles r
        LEFT JOIN role_permissions role_permission ON role_permission.role_id=r.id
        WHERE r.organization_id=$1 AND r.status='active'
          AND (r.assignable OR ($4::boolean AND r.slug='organization_owner'))
          AND ($3::boolean OR NOT EXISTS (
            SELECT 1 FROM role_permissions ceiling_permission
            WHERE ceiling_permission.role_id=r.id
              AND NOT(ceiling_permission.permission_key=ANY($2::text[]))))
          AND (r.module_key='platform' OR EXISTS(
            SELECT 1 FROM organization_modules module
            WHERE module.organization_id=r.organization_id
              AND module.module_key=r.module_key AND module.status='enabled'))
        GROUP BY r.id ORDER BY r.module_key,r.name`,
      [organizationId, session.permissions, unrestricted, isOwner],
    ),
    query<{ id: string; name: string }>(
      `SELECT company.id,company.name FROM companies company
        WHERE company.organization_id=$1 AND company.status='active'
          AND ($3::boolean OR EXISTS(
            SELECT 1 FROM membership_company_access access
            WHERE access.organization_id=company.organization_id
              AND access.user_id=$2 AND access.company_id=company.id))
        ORDER BY company.is_primary DESC,company.name`,
      [organizationId, session.userId, unrestricted],
    ),
    query<{ id: string; name: string; company_id: string }>(
      `SELECT branch.id,branch.name,branch.company_id FROM branches branch
        WHERE branch.organization_id=$1 AND branch.status='active'
          AND ($3::boolean OR EXISTS(
            SELECT 1 FROM membership_branch_access access
            WHERE access.organization_id=branch.organization_id
              AND access.user_id=$2 AND access.branch_id=branch.id))
        ORDER BY branch.is_primary DESC,branch.name`,
      [organizationId, session.userId, unrestricted],
    ),
    query<{
      id: string;
      name: string;
      company_id: string | null;
      branch_id: string | null;
    }>(
      `SELECT department.id,department.name,department.company_id,department.branch_id
        FROM departments department
        WHERE department.organization_id=$1 AND department.status='active'
          AND ($3::boolean OR EXISTS(
            SELECT 1 FROM membership_department_access access
            WHERE access.organization_id=department.organization_id
              AND access.user_id=$2 AND access.department_id=department.id))
        ORDER BY department.name`,
      [organizationId, session.userId, unrestricted],
    ),
    query<{ id: string; name: string; department_id: string | null }>(
      `SELECT team.id,team.name,team.department_id FROM teams team
        WHERE team.organization_id=$1 AND team.status='active'
          AND ($3::boolean OR EXISTS(
            SELECT 1 FROM membership_team_access access
            WHERE access.organization_id=team.organization_id
              AND access.user_id=$2 AND access.team_id=team.id))
        ORDER BY team.name`,
      [organizationId, session.userId, unrestricted],
    ),
  ]);

  const users: UserRow[] = userRows.map((row) => ({
    userId: row.user_id,
    fullName: row.full_name,
    email: row.email,
    status: row.status,
    roleIds: (row.role_ids || []).map(String),
    roleNames: row.role_names || [],
    roleSlugs: row.role_slugs || [],
    primaryRoleId: row.primary_role_id,
    accessStartsAt: row.access_starts_at?.toISOString() || null,
    accessExpiresAt: row.access_expires_at?.toISOString() || null,
    companyIds: (row.company_ids || []).map(String),
    branchIds: (row.branch_ids || []).map(String),
    departmentIds: (row.department_ids || []).map(String),
    teamIds: (row.team_ids || []).map(String),
    emailVerified: Boolean(row.email_verified_at),
    lastLoginAt: row.last_login_at?.toISOString() || null,
  }));

  const invitations = invitationRows.map((row) => ({
    id: row.id,
    email: row.email,
    roleNames: row.role_names || [],
    expiresAt: row.expires_at.toISOString(),
    revokedAt: row.revoked_at?.toISOString() || null,
    acceptedAt: row.accepted_at?.toISOString() || null,
  }));
  const roles = roleRows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: row.slug,
    moduleKey: row.module_key,
    riskLevel: row.risk_level,
    permissionKeys: row.permission_keys || [],
  }));
  const branches = branchRows.map((row) => ({
    id: row.id,
    name: row.name,
    companyId: row.company_id,
  }));
  const departments = departmentRows.map((row) => ({
    id: row.id,
    name: row.name,
    companyId: row.company_id,
    branchId: row.branch_id,
  }));
  const teams = teamRows.map((row) => ({
    id: row.id,
    name: row.name,
    departmentId: row.department_id,
  }));
  const canManage =
    hasPermission(session, PERMISSIONS.usersManage) &&
    hasPermission(session, PERMISSIONS.rolesAssign);

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
        branches={branches}
        departments={departments}
        teams={teams}
        canManage={canManage}
        currentUserId={session.userId}
      />
    </>
  );
}
