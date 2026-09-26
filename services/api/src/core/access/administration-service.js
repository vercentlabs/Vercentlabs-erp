// Ported from the recovered pre-rebuild snapshot (last present at commit d4df5eb1), apps/web/src/
// core/access-admin.ts (unchanged logic; converted from TypeScript to this
// package's plain-JS + client-injection convention, matching
// services/api/src/core/master-data.js and idempotency.js).
//
// Security properties preserved from the original (re-reviewed, not
// weakened): delegated-admin scope containment via fail-closed NOT EXISTS
// anti-join subset checks (a scoped administrator can never see or grant
// access outside their own company/branch/department/team scope);
// grant-ceiling enforcement (nobody can grant a permission they do not
// themselves hold, except organization_owner); separation-of-duties
// conflict detection with a required, permission-gated acknowledgement
// step for warning-level conflicts and a hard block for blocking-level
// conflicts.
import { randomUUID } from "node:crypto";

import {
  ALL_PERMISSIONS,
  CURRENT_MODULE_KEYS,
  analyzePermissionConflicts,
  permissionsOutsideGrantCeiling,
} from "@vercentlabs/permissions";

import { hasSessionPermission, requireSessionPermission } from "./control-runtime.js";
import { ACCESS_EVIDENCE_EVENTS, recordAccessAssignmentEvent } from "./index.js";
import { audit } from "../security/request-security.js";

export class AccessAdministrationError extends Error {
  constructor(status, message, code = "ACCESS_ADMINISTRATION_ERROR") {
    super(message);
    this.name = "AccessAdministrationError";
    this.status = status;
    this.code = code;
  }
}

export async function validateRoleSelection(
  client,
  {
    organizationId,
    roleIds,
    primaryRoleId,
    actor,
    acknowledgeWarningConflicts,
    allowOwnerRole = false,
  },
) {
  const uniqueRoleIds = [...new Set(roleIds)];
  if (!uniqueRoleIds.length || !uniqueRoleIds.includes(primaryRoleId)) {
    throw new AccessAdministrationError(
      400,
      "Select at least one role and choose its primary role.",
    );
  }

  const result = await client.query(
    `SELECT r.id,r.slug,r.name,r.is_system,r.assignable,r.module_key,r.risk_level,
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
      GROUP BY r.id`,
    [organizationId, uniqueRoleIds],
  );
  if (result.rows.length !== uniqueRoleIds.length) {
    throw new AccessAdministrationError(
      400,
      "One or more roles are unavailable for the released modules.",
    );
  }

  const roles = result.rows;
  const ownerRole = roles.find((role) => role.slug === "organization_owner");
  if (ownerRole && !allowOwnerRole) {
    throw new AccessAdministrationError(
      403,
      "Organisation ownership must use the controlled transfer flow.",
    );
  }
  const unavailable = roles.filter(
    (role) => !role.assignable && role.slug !== "organization_owner",
  );
  if (unavailable.length) {
    throw new AccessAdministrationError(
      400,
      `${unavailable.map((role) => role.name).join(", ")} cannot be assigned until its module is released.`,
    );
  }

  const permissionKeys = [
    ...new Set(roles.flatMap((role) => role.permission_keys || [])),
  ].sort();
  const outsideCeiling = permissionsOutsideGrantCeiling(
    actor.roleSlugs,
    actor.permissions,
    permissionKeys,
  );
  if (outsideCeiling.length) {
    throw new AccessAdministrationError(
      403,
      `You cannot grant permissions you do not hold: ${outsideCeiling.join(", ")}.`,
    );
  }

  const privilegedSystemRole = roles.some(
    (role) =>
      role.is_system &&
      ["organization_owner", "system_administrator", "company_administrator"].includes(
        role.slug,
      ),
  );
  const conflicts = privilegedSystemRole ? [] : analyzePermissionConflicts(permissionKeys);
  const blocking = conflicts.filter((conflict) => conflict.severity === "blocking");
  if (blocking.length) {
    throw new AccessAdministrationError(
      409,
      `This role combination violates separation of duties: ${blocking
        .map((conflict) => conflict.description)
        .join(" ")}`,
    );
  }
  const warnings = conflicts.filter((conflict) => conflict.severity === "warning");
  if (warnings.length) {
    if (!acknowledgeWarningConflicts) {
      throw new AccessAdministrationError(
        409,
        `Review and acknowledge these access conflicts: ${warnings
          .map((conflict) => conflict.description)
          .join(" ")}`,
      );
    }
    if (
      !actor.roleSlugs.includes("organization_owner") &&
      !actor.permissions.includes("access.sod.override")
    ) {
      throw new AccessAdministrationError(
        403,
        "You do not have permission to acknowledge access-conflict warnings.",
      );
    }
  }

  const primaryRole = roles.find((role) => role.id === primaryRoleId);
  if (!primaryRole) throw new AccessAdministrationError(400, "Select a valid primary role.");
  if (
    roles.some((role) =>
      ["system_administrator", "company_administrator"].includes(role.slug),
    ) &&
    !["system_administrator", "company_administrator"].includes(primaryRole.slug)
  ) {
    throw new AccessAdministrationError(
      400,
      "An administrator role must be selected as the primary role when assigned.",
    );
  }

  return { roles, primaryRole, permissionKeys, warnings };
}

export function hasUnrestrictedAccessAdministration(roleSlugs) {
  return (
    roleSlugs.includes("organization_owner") || roleSlugs.includes("system_administrator")
  );
}

// ---------------------------------------------------------------------
// Delegated administration scope — ONE SQL definition used both to list
// (Settings users/invitations) and to assert (every mutation), so reads and
// writes can never disagree. A target is inside a scoped administrator's
// scope only when:
//   - it holds at least one company grant (an unscoped target is
//     organisation-level and belongs to unrestricted administrators);
//   - every company/branch/department/team grant it holds is also held by
//     the administrator;
//   - it holds no unrestricted role (organization_owner /
//     system_administrator) — a delegated admin never administers them.
// Arguments are SQL expressions (e.g. "$1", "membership.user_id").
// ---------------------------------------------------------------------
const SCOPE_DIMENSIONS = Object.freeze([
  ["company_id", "membership_company_access", "organization_invitation_company_access"],
  ["branch_id", "membership_branch_access", "organization_invitation_branch_access"],
  ["department_id", "membership_department_access", "organization_invitation_department_access"],
  ["team_id", "membership_team_access", "organization_invitation_team_access"],
]);

function grantsSubsetSql(targetTable, targetKey, targetId, membershipTable, column, organizationId, actorUserId) {
  return [
    "NOT EXISTS (",
    `  SELECT 1 FROM ${targetTable} target_access`,
    `   WHERE target_access.organization_id = ${organizationId} AND target_access.${targetKey} = ${targetId}`,
    "     AND NOT EXISTS (",
    `       SELECT 1 FROM ${membershipTable} actor_access`,
    "        WHERE actor_access.organization_id = target_access.organization_id",
    `          AND actor_access.user_id = ${actorUserId}`,
    `          AND actor_access.${column} = target_access.${column}))`,
  ].join("\n");
}

export function memberWithinAdministrationScopeSql({ organizationId, actorUserId, targetUserId }) {
  return [
    "(",
    `EXISTS (SELECT 1 FROM membership_company_access target_company WHERE target_company.organization_id = ${organizationId} AND target_company.user_id = ${targetUserId})`,
    ...SCOPE_DIMENSIONS.map(([column, table]) => "AND " + grantsSubsetSql(table, "user_id", targetUserId, table, column, organizationId, actorUserId)),
    "AND NOT EXISTS (",
    "  SELECT 1 FROM user_role_assignments target_assignment",
    "    JOIN roles target_role ON target_role.id = target_assignment.role_id AND target_role.organization_id = target_assignment.organization_id",
    `   WHERE target_assignment.organization_id = ${organizationId} AND target_assignment.user_id = ${targetUserId}`,
    "     AND target_assignment.status = 'active'",
    "     AND target_role.slug IN ('organization_owner', 'system_administrator'))",
    ")",
  ].join("\n");
}

export function invitationWithinAdministrationScopeSql({ organizationId, actorUserId, invitationId }) {
  return [
    "(",
    `EXISTS (SELECT 1 FROM organization_invitation_company_access target_company WHERE target_company.organization_id = ${organizationId} AND target_company.invitation_id = ${invitationId})`,
    ...SCOPE_DIMENSIONS.map(
      ([column, membershipTable, invitationTable]) =>
        "AND " + grantsSubsetSql(invitationTable, "invitation_id", invitationId, membershipTable, column, organizationId, actorUserId),
    ),
    "AND NOT EXISTS (",
    "  SELECT 1 FROM organization_invitation_roles target_invitation_role",
    "    JOIN roles target_role ON target_role.id = target_invitation_role.role_id AND target_role.organization_id = target_invitation_role.organization_id",
    `   WHERE target_invitation_role.organization_id = ${organizationId} AND target_invitation_role.invitation_id = ${invitationId}`,
    "     AND target_role.slug IN ('organization_owner', 'system_administrator'))",
    ")",
  ].join("\n");
}

export async function assertUserWithinAdministrationScope(
  client,
  { organizationId, actorUserId, actorRoleSlugs, targetUserId },
) {
  if (hasUnrestrictedAccessAdministration(actorRoleSlugs)) return;
  const predicate = memberWithinAdministrationScopeSql({ organizationId: "$1", actorUserId: "$2", targetUserId: "$3" });
  const result = await client.query(`SELECT ${predicate} AS within_scope`, [organizationId, actorUserId, targetUserId]);
  if (!result.rows[0]?.within_scope) {
    throw new AccessAdministrationError(403, "This user has access outside your administration scope.", "ACCESS_ADMIN_OUT_OF_SCOPE");
  }
}

export async function assertInvitationWithinAdministrationScope(
  client,
  { organizationId, actorUserId, actorRoleSlugs, invitationId },
) {
  if (hasUnrestrictedAccessAdministration(actorRoleSlugs)) return;
  const predicate = invitationWithinAdministrationScopeSql({ organizationId: "$1", actorUserId: "$2", invitationId: "$3" });
  const result = await client.query(`SELECT ${predicate} AS within_scope`, [organizationId, actorUserId, invitationId]);
  if (!result.rows[0]?.within_scope) {
    throw new AccessAdministrationError(403, "This invitation has access outside your administration scope.", "ACCESS_ADMIN_OUT_OF_SCOPE");
  }
}

// Departments and teams in a scope selection must exist in this
// organisation, be active when newly granted, and sit under the rest of the
// selection: a company-bound department under a selected company, a team
// under a selected department (the same rule branches follow for companies).
// Never trusts client-side filtering; stale and cross-organisation ids fail.
export async function validateDepartmentTeamScope(client, organizationId, { companyIds, departmentIds, teamIds }, { previousDepartmentIds = [], previousTeamIds = [] } = {}) {
  const departments = departmentIds.length
    ? (await client.query("SELECT id, company_id, status FROM departments WHERE organization_id = $1 AND id = ANY($2::uuid[])", [organizationId, departmentIds])).rows
    : [];
  if (departments.length !== departmentIds.length) {
    throw new AccessAdministrationError(422, "One or more departments do not belong to this organization.", "ACCESS_ADMIN_DEPARTMENT_INVALID");
  }
  if (departments.some((department) => department.status !== "active" && !previousDepartmentIds.includes(department.id))) {
    throw new AccessAdministrationError(422, "Inactive departments cannot be newly granted.", "ACCESS_ADMIN_DEPARTMENT_INACTIVE");
  }
  if (departments.some((department) => department.company_id && !companyIds.includes(department.company_id))) {
    throw new AccessAdministrationError(422, "Every department must belong to one of the selected companies.", "ACCESS_ADMIN_DEPARTMENT_OUTSIDE_COMPANY");
  }
  const teams = teamIds.length
    ? (await client.query("SELECT id, department_id, status FROM teams WHERE organization_id = $1 AND id = ANY($2::uuid[])", [organizationId, teamIds])).rows
    : [];
  if (teams.length !== teamIds.length) {
    throw new AccessAdministrationError(422, "One or more teams do not belong to this organization.", "ACCESS_ADMIN_TEAM_INVALID");
  }
  if (teams.some((team) => team.status !== "active" && !previousTeamIds.includes(team.id))) {
    throw new AccessAdministrationError(422, "Inactive teams cannot be newly granted.", "ACCESS_ADMIN_TEAM_INACTIVE");
  }
  if (teams.some((team) => team.department_id && !departmentIds.includes(team.department_id))) {
    throw new AccessAdministrationError(422, "Every team must belong to one of the selected departments.", "ACCESS_ADMIN_TEAM_OUTSIDE_DEPARTMENT");
  }
}

export async function validateScopeGrantCeiling(
  client,
  { organizationId, actorUserId, actorRoleSlugs, companyIds, branchIds, departmentIds, teamIds },
) {
  if (hasUnrestrictedAccessAdministration(actorRoleSlugs)) return;

  const checks = await client.query(
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
    [organizationId, actorUserId, companyIds, branchIds, departmentIds, teamIds],
  );
  const row = checks.rows[0];
  if (
    row?.company_count !== companyIds.length ||
    row?.branch_count !== branchIds.length ||
    row?.department_count !== departmentIds.length ||
    row?.team_count !== teamIds.length
  ) {
    throw new AccessAdministrationError(
      403,
      "You cannot grant company, branch, department or team access outside your own scope.",
    );
  }
}

export async function validateInvitationRolesForAcceptance(client, { organizationId, invitationId }) {
  const result = await client.query(
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
    [invitationId, organizationId],
  );
  if (!result.rows.length || result.rows.filter((role) => role.is_primary).length !== 1) {
    throw new AccessAdministrationError(409, "The invitation roles are no longer valid.");
  }
  const permissionKeys = [...new Set(result.rows.flatMap((role) => role.permission_keys || []))];
  const blocking = analyzePermissionConflicts(permissionKeys).filter(
    (conflict) => conflict.severity === "blocking",
  );
  if (blocking.length) {
    throw new AccessAdministrationError(
      409,
      "The invitation now contains a blocking access conflict. Ask an administrator to issue a new invitation.",
    );
  }
  return result.rows;
}

export async function recordRoleSnapshot(client, { organizationId, roleId, actorUserId, reason }) {
  const roleResult = await client.query(
    `SELECT id,name,slug,description,module_key,risk_level,assignable,version
       FROM roles WHERE organization_id=$1 AND id=$2`,
    [organizationId, roleId],
  );
  const role = roleResult.rows[0];
  if (!role) throw new AccessAdministrationError(404, "Role not found.");
  const permissions = await client.query(
    "SELECT permission_key FROM role_permissions WHERE role_id=$1 ORDER BY permission_key",
    [role.id],
  );
  await client.query(
    `INSERT INTO role_version_snapshots(
       organization_id,role_id,version,snapshot,reason,created_by
     ) VALUES($1,$2,$3,$4::jsonb,$5,$6)
     ON CONFLICT (organization_id,role_id,version) DO NOTHING`,
    [
      organizationId,
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
      reason,
      actorUserId,
    ],
  );
}

// ---------------------------------------------------------------------
// SP008 — role definition CRUD and role-to-user assignment. Everything
// above this point (validateRoleSelection, grant-ceiling enforcement, SoD
// conflict analysis, recordRoleSnapshot's append-only audit trail) already
// existed but had no actual mutation entry point calling it -- roles could
// only ever be listed (organization-administration.js's
// listOrganizationRoles) or seeded by a migration, never created or edited
// through the application. These functions are that missing entry point.
// ---------------------------------------------------------------------

// Canonical list from @vercentlabs/permissions — never a local copy.
const ROLE_MODULE_KEYS = CURRENT_MODULE_KEYS;
const ROLE_RISK_LEVELS = Object.freeze(["standard", "sensitive", "privileged"]);
const VALID_PERMISSION_KEYS = new Set(ALL_PERMISSIONS);

function slugifyRoleName(name) {
  const slug = String(name)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!slug) throw new AccessAdministrationError(422, "Role name must contain at least one letter or number.", "ACCESS_ADMIN_VALIDATION");
  return slug;
}

function requireRoleText(value, label, maxLength) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) throw new AccessAdministrationError(422, `${label} is required.`, "ACCESS_ADMIN_VALIDATION");
  if (trimmed.length > maxLength) throw new AccessAdministrationError(422, `${label} must be ${maxLength} characters or fewer.`, "ACCESS_ADMIN_VALIDATION");
  return trimmed;
}

// Shared by createRole/updateRole: rejects unknown permission keys outright
// (never silently drops them -- an unrecognized key is far more likely a
// bug or a stale client than an intentional choice), then applies the same
// grant-ceiling (you cannot grant what you don't hold) and
// separation-of-duties analysis already enforced for role ASSIGNMENT
// (validateRoleSelection above) -- role DEFINITION deserves the identical
// privilege-escalation protection, not a weaker one, since defining a
// role's permission set is itself how privilege would be escalated.
function validateRolePermissionKeys(permissionKeys, session, acknowledgeWarningConflicts) {
  const uniqueKeys = [...new Set(permissionKeys)];
  const unknown = uniqueKeys.filter((key) => !VALID_PERMISSION_KEYS.has(key));
  if (unknown.length) {
    throw new AccessAdministrationError(422, `Unknown permission key(s): ${unknown.join(", ")}.`, "ACCESS_ADMIN_VALIDATION");
  }
  const outsideCeiling = permissionsOutsideGrantCeiling(session.roleSlugs, session.permissions, uniqueKeys);
  if (outsideCeiling.length) {
    throw new AccessAdministrationError(403, `You cannot grant permissions you do not hold: ${outsideCeiling.join(", ")}.`, "ACCESS_ADMIN_GRANT_CEILING");
  }
  const conflicts = analyzePermissionConflicts(uniqueKeys);
  const blocking = conflicts.filter((conflict) => conflict.severity === "blocking");
  if (blocking.length) {
    throw new AccessAdministrationError(
      409,
      `This permission combination violates separation of duties: ${blocking.map((c) => c.description).join(" ")}`,
      "ACCESS_ADMIN_SOD_BLOCKING",
    );
  }
  const warnings = conflicts.filter((conflict) => conflict.severity === "warning");
  if (warnings.length && !acknowledgeWarningConflicts) {
    throw new AccessAdministrationError(
      409,
      `Review and acknowledge these access conflicts: ${warnings.map((c) => c.description).join(" ")}`,
      "ACCESS_ADMIN_SOD_WARNING",
    );
  }
  if (warnings.length && !session.roleSlugs.includes("organization_owner") && !session.permissions.includes("access.sod.override")) {
    throw new AccessAdministrationError(403, "You do not have permission to acknowledge access-conflict warnings.", "ACCESS_ADMIN_SOD_OVERRIDE_DENIED");
  }
  return { uniqueKeys, warnings };
}

async function loadRoleForOrganization(client, organizationId, roleId) {
  const result = await client.query(
    `SELECT id, organization_id, name, slug, description, is_system, status, module_key, assignable, risk_level, version
       FROM roles WHERE organization_id = $1 AND id = $2`,
    [organizationId, roleId],
  );
  const role = result.rows[0];
  if (!role) throw new AccessAdministrationError(404, "Role not found.", "ACCESS_ADMIN_ROLE_NOT_FOUND");
  return role;
}

export async function listPermissionCatalog(client, session) {
  requireSessionPermission(session, "roles.manage");
  const rows = await client.query("SELECT key, name, category, description FROM permissions ORDER BY category, name");
  return rows.rows;
}

export async function listOrganizationRolesDetailed(client, session) {
  requireSessionPermission(session, "roles.view");
  const rows = await client.query(
    `SELECT r.id, r.name, r.slug, r.description, r.is_system, r.status, r.module_key, r.assignable, r.risk_level, r.version,
            COALESCE(array_agg(DISTINCT rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), ARRAY[]::text[]) AS permission_keys,
            (SELECT count(*)::int FROM user_role_assignments ura WHERE ura.organization_id = r.organization_id AND ura.role_id = r.id AND ura.status = 'active') AS assigned_user_count
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
      WHERE r.organization_id = $1 AND r.status = 'active'
      GROUP BY r.id
      ORDER BY r.is_system DESC, r.name ASC`,
    [session.organizationId],
  );
  return rows.rows;
}

export async function createRole(client, session, input) {
  requireSessionPermission(session, "roles.manage");
  const name = requireRoleText(input.name, "Role name", 100);
  const description = String(input.description ?? "").trim().slice(0, 1000);
  const moduleKey = String(input.moduleKey ?? "platform").trim();
  if (!ROLE_MODULE_KEYS.includes(moduleKey)) {
    throw new AccessAdministrationError(422, `Module must be one of: ${ROLE_MODULE_KEYS.join(", ")}.`, "ACCESS_ADMIN_VALIDATION");
  }
  const riskLevel = String(input.riskLevel ?? "standard").trim();
  if (!ROLE_RISK_LEVELS.includes(riskLevel)) {
    throw new AccessAdministrationError(422, `Risk level must be one of: ${ROLE_RISK_LEVELS.join(", ")}.`, "ACCESS_ADMIN_VALIDATION");
  }
  const { uniqueKeys } = validateRolePermissionKeys(
    Array.isArray(input.permissionKeys) ? input.permissionKeys : [],
    session,
    Boolean(input.acknowledgeWarningConflicts),
  );

  const baseSlug = slugifyRoleName(name);
  const existingSlugs = new Set(
    (
      await client.query("SELECT slug FROM roles WHERE organization_id = $1 AND slug LIKE $2", [
        session.organizationId,
        `${baseSlug}%`,
      ])
    ).rows.map((row) => row.slug),
  );
  let slug = baseSlug;
  let suffix = 2;
  while (existingSlugs.has(slug)) {
    slug = `${baseSlug}_${suffix}`;
    suffix += 1;
  }

  const roleId = randomUUID();
  await client.query(
    `INSERT INTO roles (id, organization_id, name, slug, description, is_system, status, module_key, assignable, risk_level, version)
     VALUES ($1, $2, $3, $4, $5, false, 'active', $6, true, $7, 1)`,
    [roleId, session.organizationId, name, slug, description, moduleKey, riskLevel],
  );
  if (uniqueKeys.length) {
    await client.query(
      `INSERT INTO role_permissions (role_id, permission_key) SELECT $1, unnest($2::text[])`,
      [roleId, uniqueKeys],
    );
  }
  await recordRoleSnapshot(client, { organizationId: session.organizationId, roleId, actorUserId: session.userId, reason: "Role created" });
  await audit(client, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    eventType: "role.created",
    entityType: "role",
    entityId: roleId,
    afterData: { name, slug, moduleKey, riskLevel, permissionKeys: uniqueKeys },
  });

  return loadRoleForOrganization(client, session.organizationId, roleId);
}

export async function updateRole(client, session, roleId, input) {
  requireSessionPermission(session, "roles.manage");
  const role = await loadRoleForOrganization(client, session.organizationId, roleId);
  if (role.is_system) {
    throw new AccessAdministrationError(403, "System roles are reserved and cannot be edited.", "ACCESS_ADMIN_SYSTEM_ROLE_PROTECTED");
  }

  const before = await client.query("SELECT permission_key FROM role_permissions WHERE role_id = $1 ORDER BY permission_key", [roleId]);
  const beforeKeys = before.rows.map((row) => row.permission_key);

  const name = input.name !== undefined ? requireRoleText(input.name, "Role name", 100) : role.name;
  const description = input.description !== undefined ? String(input.description).trim().slice(0, 1000) : role.description;
  let riskLevel = role.risk_level;
  if (input.riskLevel !== undefined) {
    riskLevel = String(input.riskLevel).trim();
    if (!ROLE_RISK_LEVELS.includes(riskLevel)) {
      throw new AccessAdministrationError(422, `Risk level must be one of: ${ROLE_RISK_LEVELS.join(", ")}.`, "ACCESS_ADMIN_VALIDATION");
    }
  }
  const permissionKeys = input.permissionKeys !== undefined ? input.permissionKeys : beforeKeys;
  const { uniqueKeys } = validateRolePermissionKeys(permissionKeys, session, Boolean(input.acknowledgeWarningConflicts));

  await client.query(
    `UPDATE roles SET name = $2, description = $3, risk_level = $4, version = version + 1, updated_at = now()
      WHERE organization_id = $1 AND id = $5`,
    [session.organizationId, name, description, riskLevel, roleId],
  );
  await client.query("DELETE FROM role_permissions WHERE role_id = $1", [roleId]);
  if (uniqueKeys.length) {
    await client.query(`INSERT INTO role_permissions (role_id, permission_key) SELECT $1, unnest($2::text[])`, [roleId, uniqueKeys]);
  }
  await recordRoleSnapshot(client, { organizationId: session.organizationId, roleId, actorUserId: session.userId, reason: "Role updated" });
  await audit(client, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    eventType: "role.updated",
    entityType: "role",
    entityId: roleId,
    beforeData: { name: role.name, description: role.description, riskLevel: role.risk_level, permissionKeys: beforeKeys },
    afterData: { name, description, riskLevel, permissionKeys: uniqueKeys },
  });

  return loadRoleForOrganization(client, session.organizationId, roleId);
}

export async function archiveRole(client, session, roleId) {
  requireSessionPermission(session, "roles.manage");
  const role = await loadRoleForOrganization(client, session.organizationId, roleId);
  if (role.is_system) {
    throw new AccessAdministrationError(403, "System roles are reserved and cannot be removed.", "ACCESS_ADMIN_SYSTEM_ROLE_PROTECTED");
  }
  const inUse = await client.query(
    "SELECT count(*)::int AS count FROM user_role_assignments WHERE organization_id = $1 AND role_id = $2 AND status = 'active'",
    [session.organizationId, roleId],
  );
  if ((inUse.rows[0]?.count || 0) > 0) {
    throw new AccessAdministrationError(
      409,
      `This role is still assigned to ${inUse.rows[0].count} user(s). Reassign them before removing the role.`,
      "ACCESS_ADMIN_ROLE_IN_USE",
    );
  }
  await client.query("UPDATE roles SET status = 'inactive', updated_at = now() WHERE organization_id = $1 AND id = $2", [session.organizationId, roleId]);
  await recordRoleSnapshot(client, { organizationId: session.organizationId, roleId, actorUserId: session.userId, reason: "Role archived" });
  await audit(client, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    eventType: "role.archived",
    entityType: "role",
    entityId: roleId,
    beforeData: { status: role.status },
    afterData: { status: "inactive" },
  });
}

// Sets a user's COMPLETE active role set in one call (rather than an
// incremental add/remove) so grant-ceiling and SoD conflicts are always
// evaluated against the user's real, final permission surface -- assigning
// roles one at a time could otherwise be used to smuggle in a combination
// that would have been rejected if considered together.
export async function setUserRoles(client, session, { targetUserId, roleIds, primaryRoleId, acknowledgeWarningConflicts }) {
  requireSessionPermission(session, "roles.assign");
  await assertUserWithinAdministrationScope(client, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorRoleSlugs: session.roleSlugs,
    targetUserId,
  });

  const membership = await client.query(
    "SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2",
    [session.organizationId, targetUserId],
  );
  if (!membership.rows[0]) throw new AccessAdministrationError(404, "User is not a member of this organization.", "ACCESS_ADMIN_USER_NOT_FOUND");

  const { roles, primaryRole } = await validateRoleSelection(client, {
    organizationId: session.organizationId,
    roleIds,
    primaryRoleId,
    actor: { roleSlugs: session.roleSlugs, permissions: session.permissions },
    acknowledgeWarningConflicts,
    allowOwnerRole: false,
  });

  const before = await client.query(
    "SELECT role_id, is_primary FROM user_role_assignments WHERE organization_id = $1 AND user_id = $2 AND status = 'active'",
    [session.organizationId, targetUserId],
  );
  const beforeRoleIds = new Set(before.rows.map((row) => row.role_id));
  const beforePrimaryRoleId = before.rows.find((row) => row.is_primary)?.role_id ?? null;
  const nextRoleIds = new Set(roles.map((role) => role.id));

  // Demote every currently-primary row FIRST, in its own statement, before
  // any insert/update below sets a new one -- user_role_assignments_one_
  // primary_idx is an immediate (non-deferrable) unique index on
  // (organization_id, user_id) WHERE is_primary AND status='active', so
  // setting a new primary while the old one is still flagged true (even
  // transiently, mid-transaction, across separate statements) violates it.
  await client.query(
    `UPDATE user_role_assignments SET is_primary = false, updated_at = now()
      WHERE organization_id = $1 AND user_id = $2 AND status = 'active' AND is_primary = true`,
    [session.organizationId, targetUserId],
  );

  for (const roleId of nextRoleIds) {
    if (beforeRoleIds.has(roleId)) {
      await client.query(
        `UPDATE user_role_assignments SET is_primary = $4, status = 'active', revoked_at = NULL, revoked_by = NULL, updated_at = now()
          WHERE organization_id = $1 AND user_id = $2 AND role_id = $3`,
        [session.organizationId, targetUserId, roleId, roleId === primaryRole.id],
      );
    } else {
      await client.query(
        `INSERT INTO user_role_assignments (organization_id, user_id, role_id, assigned_by, is_primary, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         ON CONFLICT (organization_id, user_id, role_id) DO UPDATE
           SET is_primary = EXCLUDED.is_primary, status = 'active', revoked_at = NULL, revoked_by = NULL, updated_at = now()`,
        [session.organizationId, targetUserId, roleId, session.userId, roleId === primaryRole.id],
      );
    }
  }
  for (const roleId of beforeRoleIds) {
    if (!nextRoleIds.has(roleId)) {
      await client.query(
        `UPDATE user_role_assignments SET status = 'revoked', revoked_at = now(), revoked_by = $4, updated_at = now()
          WHERE organization_id = $1 AND user_id = $2 AND role_id = $3`,
        [session.organizationId, targetUserId, roleId, session.userId],
      );
    }
  }

  await audit(client, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    eventType: "user.roles_assigned",
    entityType: "user",
    entityId: targetUserId,
    beforeData: { roleIds: [...beforeRoleIds] },
    afterData: { roleIds: [...nextRoleIds], primaryRoleId: primaryRole.id },
  });
  const changed =
    beforePrimaryRoleId !== primaryRole.id ||
    beforeRoleIds.size !== nextRoleIds.size ||
    [...nextRoleIds].some((roleId) => !beforeRoleIds.has(roleId));
  if (changed) {
    await recordAccessAssignmentEvent(client, {
      organizationId: session.organizationId,
      userId: targetUserId,
      actorUserId: session.userId,
      eventType: ACCESS_EVIDENCE_EVENTS.ROLES_CHANGED,
      beforeState: { roleIds: [...beforeRoleIds].sort(), primaryRoleId: beforePrimaryRoleId },
      afterState: { roleIds: [...nextRoleIds].sort(), primaryRoleId: primaryRole.id },
    });
  }

  return getUserAccessState(client, session.organizationId, targetUserId);
}

// ---------------------------------------------------------------------
// Grantability (for the role/scope selectors). The server decides what an
// actor may grant, with the SAME rules the mutations enforce
// (validateRoleSelection / validateScopeGrantCeiling), so the UI never shows
// a choice that will simply fail with 403.
// ---------------------------------------------------------------------
function requireAnyPermission(session, keys) {
  if (keys.some((key) => hasSessionPermission(session, key))) return;
  requireSessionPermission(session, keys[0]);
}

export async function listGrantableRolesForActor(client, session) {
  requireAnyPermission(session, ["roles.assign", "users.manage"]);
  const rows = await client.query(
    `SELECT r.id, r.name, r.slug, r.description, r.module_key, r.risk_level, r.is_system, r.assignable,
            (r.module_key = 'platform' OR EXISTS (
               SELECT 1 FROM organization_modules module
                WHERE module.organization_id = r.organization_id AND module.module_key = r.module_key AND module.status = 'enabled'
            )) AS module_enabled,
            COALESCE(array_agg(DISTINCT rp.permission_key) FILTER (WHERE rp.permission_key IS NOT NULL), ARRAY[]::text[]) AS permission_keys
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
      WHERE r.organization_id = $1 AND r.status = 'active'
      GROUP BY r.id
      ORDER BY r.is_system DESC, r.name ASC`,
    [session.organizationId],
  );
  return rows.rows.map((role) => {
    let reason = null;
    if (role.slug === "organization_owner") reason = "ownership_transfer_only";
    else if (!role.assignable) reason = "not_assignable";
    else if (!role.module_enabled) reason = "module_disabled";
    else if (permissionsOutsideGrantCeiling(session.roleSlugs, session.permissions, role.permission_keys).length) reason = "exceeds_your_access";
    return { ...role, grantable: reason === null, reason };
  });
}

// Companies (each with its branches) the actor may grant. Unrestricted
// administrators: every active company/branch. Scoped administrators: only
// their own active company and branch grants.
export async function listGrantableScope(client, session) {
  requireSessionPermission(session, "users.manage");
  const unrestricted = hasUnrestrictedAccessAdministration(session.roleSlugs);
  const companies = await client.query(
    `SELECT company.id, company.name, company.code
       FROM companies company
      WHERE company.organization_id = $1 AND company.status = 'active'
        AND ($3::boolean OR EXISTS (
          SELECT 1 FROM membership_company_access access
           WHERE access.organization_id = company.organization_id AND access.user_id = $2 AND access.company_id = company.id))
      ORDER BY company.is_primary DESC, company.name ASC`,
    [session.organizationId, session.userId, unrestricted],
  );
  const branches = await client.query(
    `SELECT branch.id, branch.name, branch.code, branch.company_id
       FROM branches branch
      WHERE branch.organization_id = $1 AND branch.status = 'active'
        AND ($3::boolean OR EXISTS (
          SELECT 1 FROM membership_branch_access access
           WHERE access.organization_id = branch.organization_id AND access.user_id = $2 AND access.branch_id = branch.id))
      ORDER BY branch.is_primary DESC, branch.name ASC`,
    [session.organizationId, session.userId, unrestricted],
  );
  // Departments and teams follow the same ceiling: unrestricted
  // administrators see all active ones, delegated administrators only those
  // they hold themselves.
  const departments = await client.query(
    `SELECT department.id, department.name, department.code, department.company_id
       FROM departments department
      WHERE department.organization_id = $1 AND department.status = 'active'
        AND ($3::boolean OR EXISTS (
          SELECT 1 FROM membership_department_access access
           WHERE access.organization_id = department.organization_id AND access.user_id = $2 AND access.department_id = department.id))
      ORDER BY department.name ASC`,
    [session.organizationId, session.userId, unrestricted],
  );
  const teams = await client.query(
    `SELECT team.id, team.name, team.code, team.department_id
       FROM teams team
      WHERE team.organization_id = $1 AND team.status = 'active'
        AND ($3::boolean OR EXISTS (
          SELECT 1 FROM membership_team_access access
           WHERE access.organization_id = team.organization_id AND access.user_id = $2 AND access.team_id = team.id))
      ORDER BY team.name ASC`,
    [session.organizationId, session.userId, unrestricted],
  );
  return {
    unrestricted,
    companies: companies.rows.map((company) => ({
      ...company,
      branches: branches.rows.filter((branch) => branch.company_id === company.id).map(({ id, name, code }) => ({ id, name, code })),
    })),
    departments: departments.rows.map((row) => ({ id: row.id, name: row.name, code: row.code, companyId: row.company_id })),
    teams: teams.rows.map((row) => ({ id: row.id, name: row.name, code: row.code, departmentId: row.department_id })),
  };
}

// ---------------------------------------------------------------------
// The ONE user access-scope mutation (company + branch productized;
// department/team preserved when not supplied). Replaces the former
// setUserCompanyAccess/setUserBranchAccess pair, which could leave a user
// half-updated between two independent calls.
// ---------------------------------------------------------------------
function uniqueIds(values) {
  return [...new Set((values || []).filter(Boolean))].sort();
}

export async function setUserAccessScope(client, session, targetUserId, { companyIds, branchIds, departmentIds, teamIds }) {
  requireSessionPermission(session, "users.manage");
  // 1. The actor must already administer the target (before anything is
  //    read or written): a scoped admin cannot take over an out-of-scope
  //    user by first stripping that user's external grants.
  await assertUserWithinAdministrationScope(client, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorRoleSlugs: session.roleSlugs,
    targetUserId,
  });
  const membership = await client.query(
    "SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2",
    [session.organizationId, targetUserId],
  );
  if (!membership.rows[0]) throw new AccessAdministrationError(404, "User is not a member of this organization.", "ACCESS_ADMIN_USER_NOT_FOUND");

  const before = await getUserAccessState(client, session.organizationId, targetUserId);
  const next = {
    companyIds: uniqueIds(companyIds),
    branchIds: uniqueIds(branchIds),
    departmentIds: departmentIds === undefined ? before.departmentIds : uniqueIds(departmentIds),
    teamIds: teamIds === undefined ? before.teamIds : uniqueIds(teamIds),
  };

  // 2. Every target must exist in this organization; newly granted
  //    companies/branches must be active (existing grants to a since-
  //    deactivated one may be kept); every branch must sit under a selected
  //    company.
  const companies = next.companyIds.length
    ? (await client.query("SELECT id, status FROM companies WHERE organization_id = $1 AND id = ANY($2::uuid[])", [session.organizationId, next.companyIds])).rows
    : [];
  if (companies.length !== next.companyIds.length) {
    throw new AccessAdministrationError(422, "One or more companies do not belong to this organization.", "ACCESS_ADMIN_COMPANY_INVALID");
  }
  if (companies.some((company) => company.status !== "active" && !before.companyIds.includes(company.id))) {
    throw new AccessAdministrationError(422, "Inactive companies cannot be newly granted.", "ACCESS_ADMIN_COMPANY_INACTIVE");
  }
  const branches = next.branchIds.length
    ? (await client.query("SELECT id, company_id, status FROM branches WHERE organization_id = $1 AND id = ANY($2::uuid[])", [session.organizationId, next.branchIds])).rows
    : [];
  if (branches.length !== next.branchIds.length) {
    throw new AccessAdministrationError(422, "One or more branches do not belong to this organization.", "ACCESS_ADMIN_BRANCH_INVALID");
  }
  if (branches.some((branch) => branch.status !== "active" && !before.branchIds.includes(branch.id))) {
    throw new AccessAdministrationError(422, "Inactive branches cannot be newly granted.", "ACCESS_ADMIN_BRANCH_INACTIVE");
  }
  if (branches.some((branch) => !next.companyIds.includes(branch.company_id))) {
    throw new AccessAdministrationError(422, "Every branch must belong to one of the selected companies.", "ACCESS_ADMIN_BRANCH_OUTSIDE_COMPANY");
  }

  await validateDepartmentTeamScope(client, session.organizationId, next, { previousDepartmentIds: before.departmentIds, previousTeamIds: before.teamIds });

  // 3. The new grants must stay inside the actor's own scope.
  await validateScopeGrantCeiling(client, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
    actorRoleSlugs: session.roleSlugs,
    ...next,
  });

  // 4. Apply as a diff: unchanged rows are not touched, so an unchanged save
  //    does not trip the session-revocation triggers on these tables.
  const tables = [
    ["membership_company_access", "company_id", before.companyIds, next.companyIds],
    ["membership_branch_access", "branch_id", before.branchIds, next.branchIds],
    ["membership_department_access", "department_id", before.departmentIds, next.departmentIds],
    ["membership_team_access", "team_id", before.teamIds, next.teamIds],
  ];
  let changed = false;
  for (const [table, column, previous, desired] of tables) {
    const removed = previous.filter((id) => !desired.includes(id));
    const added = desired.filter((id) => !previous.includes(id));
    if (removed.length) {
      await client.query(`DELETE FROM ${table} WHERE organization_id = $1 AND user_id = $2 AND ${column} = ANY($3::uuid[])`, [session.organizationId, targetUserId, removed]);
    }
    if (added.length) {
      await client.query(
        `INSERT INTO ${table} (organization_id, user_id, ${column}) SELECT $1, $2, unnest($3::uuid[]) ON CONFLICT DO NOTHING`,
        [session.organizationId, targetUserId, added],
      );
    }
    changed ||= removed.length > 0 || added.length > 0;
  }

  const after = await getUserAccessState(client, session.organizationId, targetUserId);
  if (changed) {
    const scopeOf = (state) => ({ companyIds: state.companyIds, branchIds: state.branchIds, departmentIds: state.departmentIds, teamIds: state.teamIds });
    await recordAccessAssignmentEvent(client, {
      organizationId: session.organizationId,
      userId: targetUserId,
      actorUserId: session.userId,
      eventType: ACCESS_EVIDENCE_EVENTS.SCOPE_CHANGED,
      beforeState: scopeOf(before),
      afterState: scopeOf(after),
    });
    await audit(client, {
      organizationId: session.organizationId,
      actorUserId: session.userId,
      eventType: "user.access_updated",
      entityType: "organization_membership",
      entityId: targetUserId,
      beforeData: scopeOf(before),
      afterData: scopeOf(after),
    });
  }
  return after;
}

export async function getUserAccessState(client, organizationId, userId) {
  // Sequential, not Promise.all: a single pg client/connection can only
  // run one query at a time -- see entitlements.js's getBillingSummary
  // and module-entitlements.js's getAccessibleModules for the same fix,
  // made for the same reason (a real "client.query() when the client is
  // already executing a query" deprecation warning surfaced in production
  // usage).
  const roles = await client.query(
    `SELECT ura.role_id,ura.is_primary,ura.starts_at,ura.expires_at,ura.status,r.slug,r.name
       FROM user_role_assignments ura JOIN roles r ON r.id=ura.role_id
      WHERE ura.organization_id=$1 AND ura.user_id=$2 AND ura.status='active'
      ORDER BY ura.is_primary DESC,r.name`,
    [organizationId, userId],
  );
  const companies = await client.query(
    "SELECT company_id FROM membership_company_access WHERE organization_id=$1 AND user_id=$2 ORDER BY company_id",
    [organizationId, userId],
  );
  const branches = await client.query(
    "SELECT branch_id FROM membership_branch_access WHERE organization_id=$1 AND user_id=$2 ORDER BY branch_id",
    [organizationId, userId],
  );
  const departments = await client.query(
    "SELECT department_id FROM membership_department_access WHERE organization_id=$1 AND user_id=$2 ORDER BY department_id",
    [organizationId, userId],
  );
  const teams = await client.query(
    "SELECT team_id FROM membership_team_access WHERE organization_id=$1 AND user_id=$2 ORDER BY team_id",
    [organizationId, userId],
  );
  return {
    roles: roles.rows,
    companyIds: companies.rows.map((row) => row.company_id),
    branchIds: branches.rows.map((row) => row.branch_id),
    departmentIds: departments.rows.map((row) => row.department_id),
    teamIds: teams.rows.map((row) => row.team_id),
  };
}
