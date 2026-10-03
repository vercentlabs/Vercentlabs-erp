// Organization profile and member administration. An organization is the
// single workspace a user belongs to; access is role + permission based.
import { requireSessionPermission } from "../access/index.js";
import { assertUserWithinAdministrationScope, hasUnrestrictedAccessAdministration, memberWithinAdministrationScopeSql } from "../access/index.js";
import { ACCESS_EVIDENCE_EVENTS, recordAccessAssignmentEvent } from "../access/index.js";
import { assertSeatAvailable, reconcileSeatOverage, withSeatLock } from "../billing/index.js";

export class OrganizationAdministrationError extends Error {
  constructor(status, message, code = "ORG_ADMIN_ERROR") {
    super(message);
    this.name = "OrganizationAdministrationError";
    this.status = status;
    this.code = code;
  }
}

function text(value, label, maxLength) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) throw new OrganizationAdministrationError(422, `${label} is required.`, "ORG_ADMIN_VALIDATION");
  if (trimmed.length > maxLength) throw new OrganizationAdministrationError(422, `${label} must be ${maxLength} characters or fewer.`, "ORG_ADMIN_VALIDATION");
  return trimmed;
}

// ---------------------------------------------------------------------
// Organization profile
// ---------------------------------------------------------------------
export async function getOrganizationProfile(client, organizationId) {
  const row = (
    await client.query(
      `SELECT id, name, slug, country_code, timezone, base_currency, fiscal_year_start_month, status, onboarding_completed_at, created_at, updated_at
         FROM organizations WHERE id = $1`,
      [organizationId],
    )
  ).rows[0];
  if (!row) throw new OrganizationAdministrationError(404, "Organization not found.", "ORG_ADMIN_ORG_NOT_FOUND");
  return row;
}

export async function updateOrganizationProfile(client, session, updates) {
  requireSessionPermission(session, "organization.manage");
  const fields = [];
  const values = [session.organizationId];
  if (updates.name !== undefined) {
    values.push(text(updates.name, "Organization name", 200));
    fields.push(`name = $${values.length}`);
  }
  if (updates.timezone !== undefined) {
    values.push(text(updates.timezone, "Timezone", 100));
    fields.push(`timezone = $${values.length}`);
  }
  if (updates.fiscalYearStartMonth !== undefined) {
    const month = Number(updates.fiscalYearStartMonth);
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new OrganizationAdministrationError(422, "Fiscal year start month must be between 1 and 12.", "ORG_ADMIN_VALIDATION");
    }
    values.push(month);
    fields.push(`fiscal_year_start_month = $${values.length}`);
  }
  if (!fields.length) throw new OrganizationAdministrationError(422, "No changes were provided.", "ORG_ADMIN_VALIDATION");
  fields.push("updated_at = now()");
  const updated = await client.query(`UPDATE organizations SET ${fields.join(", ")} WHERE id = $1 RETURNING id`, values);
  if (!updated.rows[0]) throw new OrganizationAdministrationError(404, "Organization not found.", "ORG_ADMIN_ORG_NOT_FOUND");
  return getOrganizationProfile(client, session.organizationId);
}

function isUnrestricted(session) {
  return hasUnrestrictedAccessAdministration(session.roleSlugs || []);
}

// ---------------------------------------------------------------------
// Roles (read-only list; role definitions and grantability live in
// access-administration.js)
// ---------------------------------------------------------------------
export async function listOrganizationRoles(client, session) {
  requireSessionPermission(session, "roles.view");
  const rows = await client.query(
    `SELECT id, name, slug, description, module_key, risk_level, assignable
       FROM roles WHERE organization_id = $1 AND status = 'active'
       ORDER BY name ASC`,
    [session.organizationId],
  );
  return rows.rows;
}

// ---------------------------------------------------------------------
// Organization members (Settings > Users)
//
// Delegated administrators see every member except owners and system
// administrators; the filter is the same SQL predicate every mutation asserts
// (memberWithinAdministrationScopeSql), evaluated in PostgreSQL.
// ---------------------------------------------------------------------
export async function listOrganizationMembers(client, session) {
  requireSessionPermission(session, "users.view");
  const scope = memberWithinAdministrationScopeSql({ organizationId: "$1", targetUserId: "membership.user_id" });
  const rows = await client.query(
    `SELECT
        membership.user_id, app_user.email, app_user.full_name, app_user.status AS user_status,
        membership.role AS membership_role, membership.status AS membership_status, membership.created_at AS joined_at,
        COALESCE(role_agg.role_names, ARRAY[]::text[]) AS role_names,
        COALESCE(role_agg.role_ids, ARRAY[]::uuid[]) AS role_ids,
        role_agg.primary_role_id,
        role_agg.primary_role_name
      FROM organization_memberships AS membership
      JOIN users AS app_user ON app_user.id = membership.user_id
      LEFT JOIN LATERAL (
        SELECT array_agg(role.name ORDER BY assignment.is_primary DESC, role.name) AS role_names,
               array_agg(role.id ORDER BY assignment.is_primary DESC, role.name) AS role_ids,
               (array_agg(role.id ORDER BY assignment.is_primary DESC))[1] AS primary_role_id,
               (array_agg(role.name ORDER BY assignment.is_primary DESC))[1] AS primary_role_name
        FROM user_role_assignments assignment
        JOIN roles role ON role.id = assignment.role_id AND role.organization_id = membership.organization_id
        WHERE assignment.organization_id = membership.organization_id AND assignment.user_id = membership.user_id AND assignment.status = 'active'
      ) AS role_agg ON true
      WHERE membership.organization_id = $1
        AND ($2::boolean OR ${scope})
      ORDER BY membership.created_at ASC`,
    [session.organizationId, isUnrestricted(session)],
  );
  return rows.rows;
}

export async function setMemberStatus(client, session, targetUserId, status) {
  requireSessionPermission(session, "users.manage");
  if (!["active", "disabled"].includes(status)) throw new OrganizationAdministrationError(422, "Status must be active or disabled.", "ORG_ADMIN_VALIDATION");
  if (targetUserId === session.userId) throw new OrganizationAdministrationError(422, "You cannot change your own membership status.", "ORG_ADMIN_SELF_TARGET");
  await assertUserWithinAdministrationScope(client, {
    organizationId: session.organizationId,
    actorRoleSlugs: session.roleSlugs || [],
    targetUserId,
  });
  let previousStatus = null;
  const updated = await withSeatLock(client, session.organizationId, async () => {
    const current = (await client.query(`SELECT status FROM organization_memberships WHERE organization_id=$1 AND user_id=$2`, [session.organizationId, targetUserId])).rows[0];
    previousStatus = current?.status ?? null;
    if (status === "active" && current && current.status !== "active") await assertSeatAvailable(client, session.organizationId, { additional: 1 });
    return client.query(
      `UPDATE organization_memberships SET status = $3 WHERE organization_id = $1 AND user_id = $2 RETURNING user_id`,
      [session.organizationId, targetUserId, status],
    );
  });
  if (!updated.rows[0]) throw new OrganizationAdministrationError(404, "Member not found.", "ORG_ADMIN_MEMBER_NOT_FOUND");
  if (status === "disabled") {
    // A disabled membership must not leave a live session usable — the
    // same "credential/access change must invalidate stale sessions" rule
    // resetPasswordWithToken/disableMfa already apply.
    await client.query(`UPDATE sessions SET revoked_at = now(), revoked_reason = 'membership_disabled' WHERE user_id = $1 AND revoked_at IS NULL`, [targetUserId]);
  }
  await reconcileSeatOverage(client, session.organizationId);
  if (previousStatus !== status) {
    await recordAccessAssignmentEvent(client, {
      organizationId: session.organizationId,
      userId: targetUserId,
      actorUserId: session.userId,
      eventType: status === "active" ? ACCESS_EVIDENCE_EVENTS.MEMBER_ENABLED : ACCESS_EVIDENCE_EVENTS.MEMBER_DISABLED,
      beforeState: { status: previousStatus },
      afterState: { status },
    });
  }
  return { userId: targetUserId, status };
}
