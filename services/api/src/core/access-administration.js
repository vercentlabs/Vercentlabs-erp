// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
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

import { requireSessionPermission } from "./access-control-runtime.js";
import { audit } from "./security.js";

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

export async function assertUserWithinAdministrationScope(
  client,
  { organizationId, actorUserId, actorRoleSlugs, targetUserId },
) {
  if (hasUnrestrictedAccessAdministration(actorRoleSlugs)) return;
  const result = await client.query(
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
    [organizationId, actorUserId, targetUserId],
  );
  const scope = result.rows[0];
  if (
    !scope?.has_company_scope ||
    !scope.companies_within_scope ||
    !scope.branches_within_scope ||
    !scope.departments_within_scope ||
    !scope.teams_within_scope
  ) {
    throw new AccessAdministrationError(403, "This user has access outside your administration scope.");
  }
}

export async function assertInvitationWithinAdministrationScope(
  client,
  { organizationId, actorUserId, actorRoleSlugs, invitationId },
) {
  if (hasUnrestrictedAccessAdministration(actorRoleSlugs)) return;
  const result = await client.query(
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
    [organizationId, actorUserId, invitationId],
  );
  const scope = result.rows[0];
  if (
    !scope?.has_company_scope ||
    !scope.companies_within_scope ||
    !scope.branches_within_scope ||
    !scope.departments_within_scope ||
    !scope.teams_within_scope
  ) {
    throw new AccessAdministrationError(403, "This invitation has access outside your administration scope.");
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
    "SELECT role_id FROM user_role_assignments WHERE organization_id = $1 AND user_id = $2 AND status = 'active'",
    [session.organizationId, targetUserId],
  );
  const beforeRoleIds = new Set(before.rows.map((row) => row.role_id));
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

  return getUserAccessState(client, session.organizationId, targetUserId);
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
