import type { PoolClient } from "pg";

import type { SessionContext } from "@/core/auth";
import {
  analyzePermissionConflicts,
  permissionsOutsideGrantCeiling,
} from "@/core/access-control";
import { HttpError } from "@/core/http";

export type AssignableRole = {
  id: string;
  slug: string;
  name: string;
  is_system: boolean;
  assignable: boolean;
  module_key: string;
  risk_level: string;
  permission_keys: string[];
};

export async function validateRoleSelection(
  client: PoolClient,
  input: {
    organizationId: string;
    roleIds: string[];
    primaryRoleId: string;
    actor: Pick<SessionContext, "roleSlugs" | "permissions">;
    acknowledgeWarningConflicts: boolean;
    allowOwnerRole?: boolean;
  },
) {
  const roleIds = [...new Set(input.roleIds)];
  if (!roleIds.length || !roleIds.includes(input.primaryRoleId)) {
    throw new HttpError(
      400,
      "Select at least one role and choose its primary role.",
    );
  }

  const result = await client.query<AssignableRole>(
    `
      SELECT r.id,r.slug,r.name,r.is_system,r.assignable,r.module_key,r.risk_level,
             COALESCE(array_agg(DISTINCT rp.permission_key)
               FILTER (WHERE rp.permission_key IS NOT NULL),ARRAY[]::text[]) AS permission_keys
      FROM roles r
      LEFT JOIN role_permissions rp ON rp.role_id=r.id
      WHERE r.organization_id=$1
        AND r.id=ANY($2::uuid[])
        AND r.status='active'
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
    `,
    [input.organizationId, roleIds],
  );
  if (result.rows.length !== roleIds.length) {
    throw new HttpError(
      400,
      "One or more roles are unavailable for the released modules.",
    );
  }

  const roles = result.rows;
  const ownerRole = roles.find((role) => role.slug === "organization_owner");
  if (ownerRole && !input.allowOwnerRole) {
    throw new HttpError(
      403,
      "Organisation ownership must use the controlled transfer flow.",
    );
  }
  const unavailable = roles.filter(
    (role) => !role.assignable && role.slug !== "organization_owner",
  );
  if (unavailable.length) {
    throw new HttpError(
      400,
      `${unavailable.map((role) => role.name).join(", ")} cannot be assigned until its module is released.`,
    );
  }

  const permissionKeys = [
    ...new Set(roles.flatMap((role) => role.permission_keys || [])),
  ].sort();
  const outsideCeiling = permissionsOutsideGrantCeiling(
    input.actor.roleSlugs,
    input.actor.permissions,
    permissionKeys,
  );
  if (outsideCeiling.length) {
    throw new HttpError(
      403,
      `You cannot grant permissions you do not hold: ${outsideCeiling.join(", ")}.`,
    );
  }

  const privilegedSystemRole = roles.some(
    (role) =>
      role.is_system &&
      [
        "organization_owner",
        "system_administrator",
        "company_administrator",
      ].includes(role.slug),
  );
  const conflicts = privilegedSystemRole
    ? []
    : analyzePermissionConflicts(permissionKeys);
  const blocking = conflicts.filter(
    (conflict) => conflict.severity === "blocking",
  );
  if (blocking.length) {
    throw new HttpError(
      409,
      `This role combination violates separation of duties: ${blocking
        .map((conflict) => conflict.description)
        .join(" ")}`,
    );
  }
  const warnings = conflicts.filter(
    (conflict) => conflict.severity === "warning",
  );
  if (warnings.length) {
    if (!input.acknowledgeWarningConflicts) {
      throw new HttpError(
        409,
        `Review and acknowledge these access conflicts: ${warnings
          .map((conflict) => conflict.description)
          .join(" ")}`,
      );
    }
    if (
      !input.actor.roleSlugs.includes("organization_owner") &&
      !input.actor.permissions.includes("access.sod.override")
    ) {
      throw new HttpError(
        403,
        "You do not have permission to acknowledge access-conflict warnings.",
      );
    }
  }

  const primaryRole = roles.find((role) => role.id === input.primaryRoleId);
  if (!primaryRole) throw new HttpError(400, "Select a valid primary role.");
  if (
    roles.some((role) =>
      ["system_administrator", "company_administrator"].includes(role.slug),
    ) &&
    !["system_administrator", "company_administrator"].includes(
      primaryRole.slug,
    )
  ) {
    throw new HttpError(
      400,
      "An administrator role must be selected as the primary role when assigned.",
    );
  }

  return { roles, primaryRole, permissionKeys, warnings };
}

export function hasUnrestrictedAccessAdministration(
  roleSlugs: readonly string[],
) {
  return (
    roleSlugs.includes("organization_owner") ||
    roleSlugs.includes("system_administrator")
  );
}

export async function assertUserWithinAdministrationScope(
  client: PoolClient,
  input: {
    organizationId: string;
    actorUserId: string;
    actorRoleSlugs: readonly string[];
    targetUserId: string;
  },
) {
  if (hasUnrestrictedAccessAdministration(input.actorRoleSlugs)) return;
  const result = await client.query<{
    has_company_scope: boolean;
    companies_within_scope: boolean;
    branches_within_scope: boolean;
    departments_within_scope: boolean;
    teams_within_scope: boolean;
  }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM membership_company_access target_access
         WHERE target_access.organization_id=$1 AND target_access.user_id=$3
       ) AS has_company_scope,
       NOT EXISTS (
         SELECT 1 FROM membership_company_access target_access
         WHERE target_access.organization_id=$1 AND target_access.user_id=$3
           AND NOT EXISTS (
             SELECT 1 FROM membership_company_access actor_access
             WHERE actor_access.organization_id=target_access.organization_id
               AND actor_access.user_id=$2
               AND actor_access.company_id=target_access.company_id
           )
       ) AS companies_within_scope,
       NOT EXISTS (
         SELECT 1 FROM membership_branch_access target_access
         WHERE target_access.organization_id=$1 AND target_access.user_id=$3
           AND NOT EXISTS (
             SELECT 1 FROM membership_branch_access actor_access
             WHERE actor_access.organization_id=target_access.organization_id
               AND actor_access.user_id=$2
               AND actor_access.branch_id=target_access.branch_id
           )
       ) AS branches_within_scope,
       NOT EXISTS (
         SELECT 1 FROM membership_department_access target_access
         WHERE target_access.organization_id=$1 AND target_access.user_id=$3
           AND NOT EXISTS (
             SELECT 1 FROM membership_department_access actor_access
             WHERE actor_access.organization_id=target_access.organization_id
               AND actor_access.user_id=$2
               AND actor_access.department_id=target_access.department_id
           )
       ) AS departments_within_scope,
       NOT EXISTS (
         SELECT 1 FROM membership_team_access target_access
         WHERE target_access.organization_id=$1 AND target_access.user_id=$3
           AND NOT EXISTS (
             SELECT 1 FROM membership_team_access actor_access
             WHERE actor_access.organization_id=target_access.organization_id
               AND actor_access.user_id=$2
               AND actor_access.team_id=target_access.team_id
           )
       ) AS teams_within_scope`,
    [input.organizationId, input.actorUserId, input.targetUserId],
  );
  const scope = result.rows[0];
  if (
    !scope?.has_company_scope ||
    !scope.companies_within_scope ||
    !scope.branches_within_scope ||
    !scope.departments_within_scope ||
    !scope.teams_within_scope
  ) {
    throw new HttpError(
      403,
      "This user has access outside your administration scope.",
    );
  }
}

export async function assertInvitationWithinAdministrationScope(
  client: PoolClient,
  input: {
    organizationId: string;
    actorUserId: string;
    actorRoleSlugs: readonly string[];
    invitationId: string;
  },
) {
  if (hasUnrestrictedAccessAdministration(input.actorRoleSlugs)) return;
  const result = await client.query<{
    has_company_scope: boolean;
    companies_within_scope: boolean;
    branches_within_scope: boolean;
    departments_within_scope: boolean;
    teams_within_scope: boolean;
  }>(
    `SELECT
       EXISTS (
         SELECT 1 FROM organization_invitation_company_access target_access
         WHERE target_access.organization_id=$1 AND target_access.invitation_id=$3
       ) AS has_company_scope,
       NOT EXISTS (
         SELECT 1 FROM organization_invitation_company_access target_access
         WHERE target_access.organization_id=$1 AND target_access.invitation_id=$3
           AND NOT EXISTS (
             SELECT 1 FROM membership_company_access actor_access
             WHERE actor_access.organization_id=target_access.organization_id
               AND actor_access.user_id=$2
               AND actor_access.company_id=target_access.company_id
           )
       ) AS companies_within_scope,
       NOT EXISTS (
         SELECT 1 FROM organization_invitation_branch_access target_access
         WHERE target_access.organization_id=$1 AND target_access.invitation_id=$3
           AND NOT EXISTS (
             SELECT 1 FROM membership_branch_access actor_access
             WHERE actor_access.organization_id=target_access.organization_id
               AND actor_access.user_id=$2
               AND actor_access.branch_id=target_access.branch_id
           )
       ) AS branches_within_scope,
       NOT EXISTS (
         SELECT 1 FROM organization_invitation_department_access target_access
         WHERE target_access.organization_id=$1 AND target_access.invitation_id=$3
           AND NOT EXISTS (
             SELECT 1 FROM membership_department_access actor_access
             WHERE actor_access.organization_id=target_access.organization_id
               AND actor_access.user_id=$2
               AND actor_access.department_id=target_access.department_id
           )
       ) AS departments_within_scope,
       NOT EXISTS (
         SELECT 1 FROM organization_invitation_team_access target_access
         WHERE target_access.organization_id=$1 AND target_access.invitation_id=$3
           AND NOT EXISTS (
             SELECT 1 FROM membership_team_access actor_access
             WHERE actor_access.organization_id=target_access.organization_id
               AND actor_access.user_id=$2
               AND actor_access.team_id=target_access.team_id
           )
       ) AS teams_within_scope`,
    [input.organizationId, input.actorUserId, input.invitationId],
  );
  const scope = result.rows[0];
  if (
    !scope?.has_company_scope ||
    !scope.companies_within_scope ||
    !scope.branches_within_scope ||
    !scope.departments_within_scope ||
    !scope.teams_within_scope
  ) {
    throw new HttpError(
      403,
      "This invitation has access outside your administration scope.",
    );
  }
}

export async function validateScopeGrantCeiling(
  client: PoolClient,
  input: {
    organizationId: string;
    actorUserId: string;
    actorRoleSlugs: readonly string[];
    companyIds: string[];
    branchIds: string[];
    departmentIds: string[];
    teamIds: string[];
  },
) {
  if (hasUnrestrictedAccessAdministration(input.actorRoleSlugs)) {
    return;
  }

  const checks = await client.query<{
    company_count: number;
    branch_count: number;
    department_count: number;
    team_count: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM membership_company_access access
         WHERE access.organization_id=$1 AND access.user_id=$2
           AND access.company_id=ANY($3::uuid[])) AS company_count,
       (SELECT count(*)::int FROM membership_branch_access access
         WHERE access.organization_id=$1 AND access.user_id=$2
           AND access.branch_id=ANY($4::uuid[])) AS branch_count,
       (SELECT count(*)::int FROM membership_department_access access
         WHERE access.organization_id=$1 AND access.user_id=$2
           AND access.department_id=ANY($5::uuid[])) AS department_count,
       (SELECT count(*)::int FROM membership_team_access access
         WHERE access.organization_id=$1 AND access.user_id=$2
           AND access.team_id=ANY($6::uuid[])) AS team_count`,
    [
      input.organizationId,
      input.actorUserId,
      input.companyIds,
      input.branchIds,
      input.departmentIds,
      input.teamIds,
    ],
  );
  const row = checks.rows[0];
  if (
    row?.company_count !== input.companyIds.length ||
    row?.branch_count !== input.branchIds.length ||
    row?.department_count !== input.departmentIds.length ||
    row?.team_count !== input.teamIds.length
  ) {
    throw new HttpError(
      403,
      "You cannot grant company, branch, department or team access outside your own scope.",
    );
  }
}

export async function validateInvitationRolesForAcceptance(
  client: PoolClient,
  input: { organizationId: string; invitationId: string },
) {
  const result = await client.query<{
    role_id: string;
    slug: string;
    name: string;
    is_primary: boolean;
    permission_keys: string[];
  }>(
    `SELECT r.id AS role_id,r.slug,r.name,invitation_role.is_primary,
       COALESCE(array_agg(DISTINCT permission.permission_key)
         FILTER (WHERE permission.permission_key IS NOT NULL),ARRAY[]::text[]) AS permission_keys
     FROM organization_invitation_roles invitation_role
     JOIN roles r ON r.id=invitation_role.role_id
       AND r.organization_id=invitation_role.organization_id
       AND r.status='active' AND r.assignable=true
     LEFT JOIN role_permissions permission ON permission.role_id=r.id
     WHERE invitation_role.invitation_id=$1 AND invitation_role.organization_id=$2
       AND (r.module_key='platform' OR EXISTS (
         SELECT 1 FROM organization_modules module
         WHERE module.organization_id=r.organization_id
           AND module.module_key=r.module_key AND module.status='enabled'
       ))
     GROUP BY r.id,invitation_role.is_primary`,
    [input.invitationId, input.organizationId],
  );
  if (
    !result.rows.length ||
    result.rows.filter((role) => role.is_primary).length !== 1
  ) {
    throw new HttpError(409, "The invitation roles are no longer valid.");
  }
  const permissionKeys = [
    ...new Set(result.rows.flatMap((role) => role.permission_keys || [])),
  ];
  const blocking = analyzePermissionConflicts(permissionKeys).filter(
    (conflict) => conflict.severity === "blocking",
  );
  if (blocking.length) {
    throw new HttpError(
      409,
      "The invitation now contains a blocking access conflict. Ask an administrator to issue a new invitation.",
    );
  }
  return result.rows;
}

export async function recordRoleSnapshot(
  client: PoolClient,
  input: {
    organizationId: string;
    roleId: string;
    actorUserId: string;
    reason: string;
  },
) {
  const roleResult = await client.query<{
    id: string;
    name: string;
    slug: string;
    description: string;
    module_key: string;
    risk_level: string;
    assignable: boolean;
    version: number;
  }>(
    `SELECT id,name,slug,description,module_key,risk_level,assignable,version
       FROM roles WHERE organization_id=$1 AND id=$2`,
    [input.organizationId, input.roleId],
  );
  const role = roleResult.rows[0];
  if (!role) throw new HttpError(404, "Role not found.");
  const permissions = await client.query<{ permission_key: string }>(
    "SELECT permission_key FROM role_permissions WHERE role_id=$1 ORDER BY permission_key",
    [role.id],
  );
  await client.query(
    `INSERT INTO role_version_snapshots(
       organization_id,role_id,version,snapshot,reason,created_by
     ) VALUES($1,$2,$3,$4::jsonb,$5,$6)
     ON CONFLICT (organization_id,role_id,version) DO NOTHING`,
    [
      input.organizationId,
      role.id,
      role.version,
      JSON.stringify({
        name: role.name,
        slug: role.slug,
        description: role.description,
        moduleKey: role.module_key,
        riskLevel: role.risk_level,
        assignable: role.assignable,
        permissionKeys: permissions.rows.map((row) => row.permission_key),
      }),
      input.reason,
      input.actorUserId,
    ],
  );
}

export async function getUserAccessState(
  client: PoolClient,
  organizationId: string,
  userId: string,
) {
  const [roles, companies, branches, departments, teams] = await Promise.all([
    client.query(
      `SELECT ura.role_id,ura.is_primary,ura.starts_at,ura.expires_at,ura.status,r.slug,r.name
         FROM user_role_assignments ura JOIN roles r ON r.id=ura.role_id
        WHERE ura.organization_id=$1 AND ura.user_id=$2 AND ura.status='active'
        ORDER BY ura.is_primary DESC,r.name`,
      [organizationId, userId],
    ),
    client.query(
      "SELECT company_id FROM membership_company_access WHERE organization_id=$1 AND user_id=$2 ORDER BY company_id",
      [organizationId, userId],
    ),
    client.query(
      "SELECT branch_id FROM membership_branch_access WHERE organization_id=$1 AND user_id=$2 ORDER BY branch_id",
      [organizationId, userId],
    ),
    client.query(
      "SELECT department_id FROM membership_department_access WHERE organization_id=$1 AND user_id=$2 ORDER BY department_id",
      [organizationId, userId],
    ),
    client.query(
      "SELECT team_id FROM membership_team_access WHERE organization_id=$1 AND user_id=$2 ORDER BY team_id",
      [organizationId, userId],
    ),
  ]);
  return {
    roles: roles.rows,
    companyIds: companies.rows.map((row) => row.company_id),
    branchIds: branches.rows.map((row) => row.branch_id),
    departmentIds: departments.rows.map((row) => row.department_id),
    teamIds: teams.rows.map((row) => row.team_id),
  };
}
