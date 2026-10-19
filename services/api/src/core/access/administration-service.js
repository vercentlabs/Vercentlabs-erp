// Ported from the recovered pre-rebuild snapshot (last present at commit d4df5eb1), apps/web/src/
// core/access-admin.ts (unchanged logic; converted from TypeScript to this
// package's plain-JS + client-injection convention, matching
// services/api/src/core/master-data.js and idempotency.js).
//
// Security properties preserved from the original (re-reviewed, not
// weakened): a delegated administrator can never administer an owner or
// system administrator; grant-ceiling enforcement (nobody can grant a permission they do not
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
      ["organization_owner", "system_administrator", "user_administrator"].includes(
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
      ["system_administrator", "user_administrator"].includes(role.slug),
    ) &&
    !["system_administrator", "user_administrator"].includes(primaryRole.slug)
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
// Delegated administration — ONE SQL definition used both to list
// (Settings users/invitations) and to assert (every mutation), so reads and
// writes can never disagree. Access is organisation-wide (roles and
// permissions only), so a delegated administrator (users.manage without an
// unrestricted role) may administer every member EXCEPT one holding an
// unrestricted role (organization_owner / system_administrator).
// Arguments are SQL expressions (e.g. "$1", "membership.user_id").
// ---------------------------------------------------------------------
export function memberWithinAdministrationScopeSql({ organizationId, targetUserId }) {
  return [
    "NOT EXISTS (",
    "  SELECT 1 FROM user_role_assignments target_assignment",
    "    JOIN roles target_role ON target_role.id = target_assignment.role_id AND target_role.organization_id = target_assignment.organization_id",
    `   WHERE target_assignment.organization_id = ${organizationId} AND target_assignment.user_id = ${targetUserId}`,
    "     AND target_assignment.status = 'active'",
    "     AND target_role.slug IN ('organization_owner', 'system_administrator'))",
  ].join("\n");
}

export function invitationWithinAdministrationScopeSql({ organizationId, invitationId }) {
  return [
    "NOT EXISTS (",
    "  SELECT 1 FROM organization_invitation_roles target_invitation_role",
    "    JOIN roles target_role ON target_role.id = target_invitation_role.role_id AND target_role.organization_id = target_invitation_role.organization_id",
    `   WHERE target_invitation_role.organization_id = ${organizationId} AND target_invitation_role.invitation_id = ${invitationId}`,
    "     AND target_role.slug IN ('organization_owner', 'system_administrator'))",
  ].join("\n");
}

export async function assertUserWithinAdministrationScope(
  client,
  { organizationId, actorRoleSlugs, targetUserId },
) {
  if (hasUnrestrictedAccessAdministration(actorRoleSlugs)) return;
  const predicate = memberWithinAdministrationScopeSql({ organizationId: "$1", targetUserId: "$2" });
  const result = await client.query(`SELECT ${predicate} AS within_scope`, [organizationId, targetUserId]);
  if (!result.rows[0]?.within_scope) {
    throw new AccessAdministrationError(403, "Only an owner or system administrator can administer this user.", "ACCESS_ADMIN_OUT_OF_SCOPE");
  }
}

export async function assertInvitationWithinAdministrationScope(
  client,
  { organizationId, actorRoleSlugs, invitationId },
) {
  if (hasUnrestrictedAccessAdministration(actorRoleSlugs)) return;
  const predicate = invitationWithinAdministrationScopeSql({ organizationId: "$1", invitationId: "$2" });
  const result = await client.query(`SELECT ${predicate} AS within_scope`, [organizationId, invitationId]);
  if (!result.rows[0]?.within_scope) {
    throw new AccessAdministrationError(403, "Only an owner or system administrator can administer this invitation.", "ACCESS_ADMIN_OUT_OF_SCOPE");
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
// The permission catalogue in the database (public.permissions) is the authority: every key a module's migration added is valid,
// including keys the package's ALL_PERMISSIONS list does not name.
async function catalogueKeys(client, keys) {
  if (!keys.length) return new Set();
  const { rows } = await client.query("SELECT key FROM permissions WHERE key = ANY($1::text[])", [keys]);
  return new Set(rows.map((row) => row.key));
}

async function validateRolePermissionKeys(client, permissionKeys, session, acknowledgeWarningConflicts) {
  const uniqueKeys = [...new Set(permissionKeys)];
  const catalogue = await catalogueKeys(client, uniqueKeys);
  const unknown = uniqueKeys.filter((key) => !catalogue.has(key) && !VALID_PERMISSION_KEYS.has(key));
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
  // Anyone who can view roles sees what each permission means (the role list already carries the keys).
  requireSessionPermission(session, "roles.view");
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
  await assertRoleNameFree(client, session.organizationId, name);
  const { uniqueKeys } = await validateRolePermissionKeys(
    client,
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
  if (role.status !== "active") throw new AccessAdministrationError(409, "Restore this role before editing it.", "ACCESS_ADMIN_ROLE_ARCHIVED");
  // Two administrators editing the same role: the second save is refused rather than silently replacing the first.
  if (input.expectedVersion !== undefined && input.expectedVersion !== null && Number(input.expectedVersion) !== Number(role.version)) {
    throw new AccessAdministrationError(409, "Someone else changed this role while you were editing it. Reload it and make your change again.", "ACCESS_ADMIN_ROLE_STALE");
  }

  const before = await client.query("SELECT permission_key FROM role_permissions WHERE role_id = $1 ORDER BY permission_key", [roleId]);
  const beforeKeys = before.rows.map((row) => row.permission_key);

  const name = input.name !== undefined ? requireRoleText(input.name, "Role name", 100) : role.name;
  if (name.toLowerCase() !== role.name.toLowerCase()) await assertRoleNameFree(client, session.organizationId, name, roleId);
  const description = input.description !== undefined ? String(input.description).trim().slice(0, 1000) : role.description;
  let riskLevel = role.risk_level;
  if (input.riskLevel !== undefined) {
    riskLevel = String(input.riskLevel).trim();
    if (!ROLE_RISK_LEVELS.includes(riskLevel)) {
      throw new AccessAdministrationError(422, `Risk level must be one of: ${ROLE_RISK_LEVELS.join(", ")}.`, "ACCESS_ADMIN_VALIDATION");
    }
  }
  const permissionKeys = input.permissionKeys !== undefined ? input.permissionKeys : beforeKeys;
  const { uniqueKeys } = await validateRolePermissionKeys(client, permissionKeys, session, Boolean(input.acknowledgeWarningConflicts));

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
    `SELECT assignment.role_id, assignment.is_primary, role.slug FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
      WHERE assignment.organization_id = $1 AND assignment.user_id = $2 AND assignment.status = 'active'`,
    [session.organizationId, targetUserId],
  );
  // The owner keeps ownership until it is transferred: changing their roles here can never leave the company without an owner.
  if (before.rows.some((row) => row.slug === "organization_owner")) {
    throw new AccessAdministrationError(409, "This person owns the company. Transfer ownership first; the owner's roles cannot be changed here.", "ACCESS_ADMIN_OWNER_PROTECTED");
  }
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
// Grantability (for the role selector). The server decides what an actor may
// grant, with the SAME rules the mutations enforce (validateRoleSelection), so
// the UI never shows a choice that will simply fail with 403.
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

export async function getUserAccessState(client, organizationId, userId) {
  const roles = await client.query(
    `SELECT ura.role_id,ura.is_primary,ura.starts_at,ura.expires_at,ura.status,r.slug,r.name
       FROM user_role_assignments ura JOIN roles r ON r.id=ura.role_id
      WHERE ura.organization_id=$1 AND ura.user_id=$2 AND ura.status='active'
      ORDER BY ura.is_primary DESC,r.name`,
    [organizationId, userId],
  );
  return { roles: roles.rows };
}

// ---------------------------------------------------------------------
// Roles & Permissions MVP: unique names, duplicate, restore, role detail (people and history) and the two access reports.
// ---------------------------------------------------------------------

// Active role names are unique in a company whatever their letter case (migration 0194's index is the backstop).
async function assertRoleNameFree(client, organizationId, name, exceptRoleId = null) {
  const taken = await client.query(
    "SELECT name FROM roles WHERE organization_id = $1 AND status = 'active' AND lower(name) = lower($2) AND ($3::uuid IS NULL OR id <> $3) LIMIT 1",
    [organizationId, name, exceptRoleId],
  );
  if (taken.rows[0]) throw new AccessAdministrationError(409, `A role named "${taken.rows[0].name}" already exists. Choose another name.`, "ACCESS_ADMIN_ROLE_NAME_TAKEN");
}

// A copy of any role (built-in or custom) as a new custom role: the way to change what a built-in role allows. The copy goes through
// createRole, so the grant ceiling and separation-of-duties checks apply to it like to any new role.
export async function duplicateRole(client, session, roleId, input = {}) {
  requireSessionPermission(session, "roles.manage");
  const source = await loadRoleForOrganization(client, session.organizationId, roleId);
  const keys = (await client.query("SELECT permission_key FROM role_permissions WHERE role_id = $1 ORDER BY permission_key", [source.id])).rows.map((row) => row.permission_key);
  let name = String(input.name ?? "").trim();
  if (!name) {
    name = `${source.name} (copy)`;
    for (let copy = 2; (await client.query("SELECT 1 FROM roles WHERE organization_id = $1 AND status = 'active' AND lower(name) = lower($2)", [session.organizationId, name])).rows[0]; copy += 1)
      name = `${source.name} (copy ${copy})`;
  }
  const role = await createRole(client, session, {
    name, description: input.description ?? source.description, moduleKey: source.module_key, riskLevel: source.risk_level,
    permissionKeys: keys, acknowledgeWarningConflicts: input.acknowledgeWarningConflicts,
  });
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "role.duplicated", entityType: "role", entityId: role.id,
    afterData: { from: { id: source.id, name: source.name }, name } });
  return role;
}

// An archived custom role in use again (its name must still be free).
export async function restoreRole(client, session, roleId) {
  requireSessionPermission(session, "roles.manage");
  const role = await loadRoleForOrganization(client, session.organizationId, roleId);
  if (role.status === "active") return role;
  await assertRoleNameFree(client, session.organizationId, role.name, role.id);
  await client.query("UPDATE roles SET status = 'active', version = version + 1, updated_at = now() WHERE organization_id = $1 AND id = $2", [session.organizationId, roleId]);
  await recordRoleSnapshot(client, { organizationId: session.organizationId, roleId, actorUserId: session.userId, reason: "Role restored" });
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "role.restored", entityType: "role", entityId: roleId,
    beforeData: { status: role.status }, afterData: { status: "active" } });
  return loadRoleForOrganization(client, session.organizationId, roleId);
}

export async function listArchivedRoles(client, session) {
  requireSessionPermission(session, "roles.view");
  return (await client.query(
    "SELECT id, name, description, module_key, risk_level, updated_at FROM roles WHERE organization_id = $1 AND status <> 'active' AND NOT is_system ORDER BY lower(name)",
    [session.organizationId])).rows;
}

// One role: what it is, who has it, and every change to it (each saved version against the one before: permissions added and removed).
export async function getRoleDetail(client, session, roleId) {
  requireSessionPermission(session, "roles.view");
  const role = await loadRoleForOrganization(client, session.organizationId, roleId);
  const permissionKeys = (await client.query("SELECT permission_key FROM role_permissions WHERE role_id = $1 ORDER BY permission_key", [role.id])).rows.map((row) => row.permission_key);
  const people = (await client.query(
    `SELECT assignment.user_id, account.full_name, account.email, membership.status AS membership_status, assignment.is_primary, assignment.created_at AS assigned_at,
            assigner.full_name AS assigned_by_name, account.last_login_at
       FROM user_role_assignments assignment
       JOIN users account ON account.id = assignment.user_id
       LEFT JOIN organization_memberships membership ON membership.organization_id = assignment.organization_id AND membership.user_id = assignment.user_id
       LEFT JOIN users assigner ON assigner.id = assignment.assigned_by
      WHERE assignment.organization_id = $1 AND assignment.role_id = $2 AND assignment.status = 'active'
      ORDER BY lower(account.full_name)`,
    [session.organizationId, role.id])).rows.map((row) => ({
    userId: row.user_id, name: row.full_name, email: row.email, status: row.membership_status ?? "unknown", isPrimary: row.is_primary,
    assignedAt: row.assigned_at, assignedBy: row.assigned_by_name ?? null, lastSignInAt: row.last_login_at ?? null,
  }));
  const snapshots = (await client.query(
    `SELECT snapshot.version, snapshot.snapshot, snapshot.reason, snapshot.created_at, actor.full_name AS actor_name
       FROM role_version_snapshots snapshot LEFT JOIN users actor ON actor.id = snapshot.created_by
      WHERE snapshot.organization_id = $1 AND snapshot.role_id = $2 ORDER BY snapshot.version, snapshot.created_at`,
    [session.organizationId, role.id])).rows;
  const history = snapshots.map((row, index) => {
    const keys = new Set(row.snapshot?.permissionKeys ?? []);
    const previous = index ? new Set(snapshots[index - 1].snapshot?.permissionKeys ?? []) : new Set();
    return {
      version: row.version, reason: row.reason, at: row.created_at, by: row.actor_name ?? null, name: row.snapshot?.name ?? null,
      added: index ? [...keys].filter((key) => !previous.has(key)).sort() : [], removed: index ? [...previous].filter((key) => !keys.has(key)).sort() : [],
      permissionCount: keys.size,
    };
  }).reverse();
  return { role: { ...role, permission_keys: permissionKeys }, people, history };
}

// Role usage: every active role, how many active people hold it and when it last changed.
export async function roleUsageReport(client, session) {
  requireSessionPermission(session, "roles.view");
  const { rows } = await client.query(
    `SELECT r.id, r.name, r.module_key, r.risk_level, r.is_system, r.assignable,
            (SELECT count(*)::int FROM role_permissions rp WHERE rp.role_id = r.id) AS permission_count,
            (SELECT count(*)::int FROM user_role_assignments ura JOIN organization_memberships m ON m.organization_id = ura.organization_id AND m.user_id = ura.user_id AND m.status = 'active'
              WHERE ura.organization_id = r.organization_id AND ura.role_id = r.id AND ura.status = 'active') AS active_people,
            (SELECT max(created_at) FROM role_version_snapshots s WHERE s.organization_id = r.organization_id AND s.role_id = r.id) AS last_changed_at
       FROM roles r WHERE r.organization_id = $1 AND r.status = 'active'
      ORDER BY active_people DESC, lower(r.name)`,
    [session.organizationId]);
  return rows;
}

// User access: every member, their roles, how much they can do, and whether that includes sensitive or privileged access.
export async function userAccessReport(client, session) {
  requireSessionPermission(session, "users.view");
  const { rows } = await client.query(
    `SELECT member.user_id, account.full_name, account.email, member.status, account.last_login_at,
            COALESCE(array_agg(DISTINCT role.name) FILTER (WHERE role.id IS NOT NULL), ARRAY[]::text[]) AS roles,
            COALESCE(array_agg(DISTINCT role.risk_level) FILTER (WHERE role.id IS NOT NULL), ARRAY[]::text[]) AS risks,
            count(DISTINCT grant_row.permission_key)::int AS permission_count,
            COALESCE(array_agg(DISTINCT split_part(grant_row.permission_key, '.', 1)) FILTER (WHERE grant_row.permission_key IS NOT NULL), ARRAY[]::text[]) AS areas
       FROM organization_memberships member
       JOIN users account ON account.id = member.user_id
       LEFT JOIN user_role_assignments assignment ON assignment.organization_id = member.organization_id AND assignment.user_id = member.user_id AND assignment.status = 'active'
       LEFT JOIN roles role ON role.id = assignment.role_id AND role.status = 'active'
       LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
      WHERE member.organization_id = $1
      GROUP BY member.user_id, account.full_name, account.email, member.status, account.last_login_at
      ORDER BY lower(account.full_name)`,
    [session.organizationId]);
  return rows.map((row) => ({
    userId: row.user_id, name: row.full_name, email: row.email, status: row.status, lastSignInAt: row.last_login_at ?? null, roles: row.roles,
    permissionCount: row.permission_count, privileged: row.risks.includes("privileged"), sensitive: row.risks.includes("sensitive"), areas: row.areas.length,
  }));
}
