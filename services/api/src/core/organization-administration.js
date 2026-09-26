// SP001/SP002/SP003 — organization profile, company and branch
// administration. Real gap this closes: only a read-only
// listAccessibleCompanies (session.js, self-service "which companies can
// I currently work in") existed anywhere in the codebase before this —
// there was no way for an admin to actually CREATE a company or branch at
// all, despite both tables existing since migration 001 and the UI-facing
// "Companies"/"Branches" settings screens this module backs being an
// explicit, named requirement.
import { randomUUID } from "node:crypto";

import { requireSessionPermission } from "./access-control-runtime.js";
import { assertUserWithinAdministrationScope, hasUnrestrictedAccessAdministration, memberWithinAdministrationScopeSql } from "./access-administration.js";
import { ACCESS_EVIDENCE_EVENTS, recordAccessAssignmentEvent } from "./access/index.js";
import { assertSeatAvailable, reconcileSeatOverage, withSeatLock } from "./billing/index.js";

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

// ---------------------------------------------------------------------
// Delegated administration
//
// organization_owner / system_administrator administer the whole
// organization. Everyone else (e.g. Company Administrator) administers ONLY
// the companies/branches they are explicitly granted — reads included, even
// inside the same organization. Out-of-scope ids answer "not found" so a
// guessed id never proves a record exists.
// ---------------------------------------------------------------------
function isUnrestricted(session) {
  return hasUnrestrictedAccessAdministration(session.roleSlugs || []);
}

async function assertCompanyAdministrable(client, session, companyId) {
  if (isUnrestricted(session)) return;
  const granted = await client.query(
    `SELECT 1 FROM membership_company_access WHERE organization_id = $1 AND user_id = $2 AND company_id = $3`,
    [session.organizationId, session.userId, companyId],
  );
  if (!granted.rows[0]) throw new OrganizationAdministrationError(404, "Company not found.", "ORG_ADMIN_COMPANY_NOT_FOUND");
}

async function assertBranchAdministrable(client, session, branchId) {
  if (isUnrestricted(session)) return;
  const granted = await client.query(
    `SELECT 1 FROM membership_branch_access WHERE organization_id = $1 AND user_id = $2 AND branch_id = $3`,
    [session.organizationId, session.userId, branchId],
  );
  if (!granted.rows[0]) throw new OrganizationAdministrationError(404, "Branch not found.", "ORG_ADMIN_BRANCH_NOT_FOUND");
}

// ---------------------------------------------------------------------
// Companies
// ---------------------------------------------------------------------

// Admin management view, regardless of status (an admin needs to see and
// reactivate an inactive company) — a different semantic than session.js's
// listAccessibleCompanies (self-service context switching, active only).
export async function listOrganizationCompanies(client, session) {
  requireSessionPermission(session, "company.manage");
  const rows = await client.query(
    `SELECT id, name, legal_name, code, country_code, base_currency, tax_id, is_primary, status, created_at, updated_at
       FROM companies company
      WHERE company.organization_id = $1
        AND ($3::boolean OR EXISTS (
          SELECT 1 FROM membership_company_access access
           WHERE access.organization_id = company.organization_id AND access.user_id = $2 AND access.company_id = company.id))
      ORDER BY is_primary DESC, created_at ASC`,
    [session.organizationId, session.userId, isUnrestricted(session)],
  );
  return rows.rows;
}

// A new legal entity is an organization-level decision: company.manage alone
// (delegated administration of EXISTING companies) is not enough.
export async function createCompany(client, session, input) {
  requireSessionPermission(session, "company.manage");
  if (!isUnrestricted(session)) requireSessionPermission(session, "organization.manage");
  const name = text(input.name, "Company name", 200);
  const legalName = text(input.legalName, "Legal name", 200);
  const code = text(input.code, "Company code", 30).toUpperCase();
  const countryCode = text(input.countryCode, "Country code", 2).toUpperCase();
  const baseCurrency = text(input.baseCurrency, "Base currency", 3).toUpperCase();
  if (countryCode.length !== 2) throw new OrganizationAdministrationError(422, "Country code must be a 2-letter ISO code.", "ORG_ADMIN_VALIDATION");
  if (baseCurrency.length !== 3) throw new OrganizationAdministrationError(422, "Base currency must be a 3-letter ISO code.", "ORG_ADMIN_VALIDATION");

  const duplicate = await client.query(`SELECT 1 FROM companies WHERE organization_id = $1 AND upper(code) = $2`, [session.organizationId, code]);
  if (duplicate.rows[0]) throw new OrganizationAdministrationError(409, `A company with code "${code}" already exists.`, "ORG_ADMIN_DUPLICATE_CODE");

  const id = randomUUID();
  await client.query(
    `INSERT INTO companies (id, organization_id, name, legal_name, code, country_code, base_currency, tax_id, is_primary, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')`,
    [id, session.organizationId, name, legalName, code, countryCode, baseCurrency, input.taxId ? text(input.taxId, "Tax ID", 50) : null, Boolean(input.isPrimary)],
  );
  return (await client.query(`SELECT * FROM companies WHERE id = $1`, [id])).rows[0];
}

export async function updateCompany(client, session, companyId, updates) {
  requireSessionPermission(session, "company.manage");
  await assertCompanyAdministrable(client, session, companyId);
  const fields = [];
  const values = [companyId, session.organizationId];
  if (updates.name !== undefined) {
    values.push(text(updates.name, "Company name", 200));
    fields.push(`name = $${values.length}`);
  }
  if (updates.legalName !== undefined) {
    values.push(text(updates.legalName, "Legal name", 200));
    fields.push(`legal_name = $${values.length}`);
  }
  if (updates.taxId !== undefined) {
    values.push(updates.taxId ? text(updates.taxId, "Tax ID", 50) : null);
    fields.push(`tax_id = $${values.length}`);
  }
  if (updates.status !== undefined) {
    if (!["active", "inactive"].includes(updates.status)) throw new OrganizationAdministrationError(422, "Status must be active or inactive.", "ORG_ADMIN_VALIDATION");
    values.push(updates.status);
    fields.push(`status = $${values.length}`);
  }
  if (!fields.length) throw new OrganizationAdministrationError(422, "No changes were provided.", "ORG_ADMIN_VALIDATION");
  fields.push("updated_at = now()");
  const updated = await client.query(
    `UPDATE companies SET ${fields.join(", ")} WHERE id = $1 AND organization_id = $2 RETURNING id`,
    values,
  );
  if (!updated.rows[0]) throw new OrganizationAdministrationError(404, "Company not found.", "ORG_ADMIN_COMPANY_NOT_FOUND");
  return (await client.query(`SELECT * FROM companies WHERE id = $1`, [companyId])).rows[0];
}

// ---------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------
export async function listOrganizationBranches(client, session, companyId = null) {
  requireSessionPermission(session, "branch.manage");
  const rows = await client.query(
    `SELECT * FROM branches branch
      WHERE branch.organization_id = $1
        AND ($3::uuid IS NULL OR branch.company_id = $3::uuid)
        AND ($4::boolean OR EXISTS (
          SELECT 1 FROM membership_branch_access access
           WHERE access.organization_id = branch.organization_id AND access.user_id = $2 AND access.branch_id = branch.id))
      ORDER BY is_primary DESC, created_at ASC`,
    [session.organizationId, session.userId, companyId, isUnrestricted(session)],
  );
  return rows.rows;
}

export async function createBranch(client, session, input) {
  requireSessionPermission(session, "branch.manage");
  const name = text(input.name, "Branch name", 200);
  const code = text(input.code, "Branch code", 30).toUpperCase();
  const timezone = text(input.timezone, "Timezone", 100);
  const companyId = text(input.companyId, "Company", 36);

  const company = await client.query(`SELECT id FROM companies WHERE id = $1 AND organization_id = $2`, [companyId, session.organizationId]);
  if (!company.rows[0]) throw new OrganizationAdministrationError(422, "That company does not belong to this organization.", "ORG_ADMIN_COMPANY_INVALID");
  // A delegated administrator may only open branches under a company they administer.
  await assertCompanyAdministrable(client, session, companyId);

  const duplicate = await client.query(`SELECT 1 FROM branches WHERE organization_id = $1 AND upper(code) = $2`, [session.organizationId, code]);
  if (duplicate.rows[0]) throw new OrganizationAdministrationError(409, `A branch with code "${code}" already exists.`, "ORG_ADMIN_DUPLICATE_CODE");

  const id = randomUUID();
  await client.query(
    `INSERT INTO branches (id, organization_id, company_id, name, code, timezone, is_primary, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')`,
    [id, session.organizationId, companyId, name, code, timezone, Boolean(input.isPrimary)],
  );
  if (!isUnrestricted(session)) {
    // Same transaction: the delegated creator can administer what they just
    // created. Nobody else's scope is widened.
    await client.query(
      `INSERT INTO membership_branch_access (organization_id, user_id, branch_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [session.organizationId, session.userId, id],
    );
  }
  return (await client.query(`SELECT * FROM branches WHERE id = $1`, [id])).rows[0];
}

export async function updateBranch(client, session, branchId, updates) {
  requireSessionPermission(session, "branch.manage");
  await assertBranchAdministrable(client, session, branchId);
  const fields = [];
  const values = [branchId, session.organizationId];
  if (updates.name !== undefined) {
    values.push(text(updates.name, "Branch name", 200));
    fields.push(`name = $${values.length}`);
  }
  if (updates.timezone !== undefined) {
    values.push(text(updates.timezone, "Timezone", 100));
    fields.push(`timezone = $${values.length}`);
  }
  if (updates.status !== undefined) {
    if (!["active", "inactive"].includes(updates.status)) throw new OrganizationAdministrationError(422, "Status must be active or inactive.", "ORG_ADMIN_VALIDATION");
    values.push(updates.status);
    fields.push(`status = $${values.length}`);
  }
  if (!fields.length) throw new OrganizationAdministrationError(422, "No changes were provided.", "ORG_ADMIN_VALIDATION");
  fields.push("updated_at = now()");
  const updated = await client.query(
    `UPDATE branches SET ${fields.join(", ")} WHERE id = $1 AND organization_id = $2 RETURNING id`,
    values,
  );
  if (!updated.rows[0]) throw new OrganizationAdministrationError(404, "Branch not found.", "ORG_ADMIN_BRANCH_NOT_FOUND");
  return (await client.query(`SELECT * FROM branches WHERE id = $1`, [branchId])).rows[0];
}

// User company/branch grants: see access-administration.js setUserAccessScope
// (the one atomic scope mutation). Invitation-time grants: auth-lifecycle.js.

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
// Scoped administrators see only members entirely inside their scope; the
// filter is the same SQL predicate every mutation asserts
// (memberWithinAdministrationScopeSql), evaluated in PostgreSQL. Access is
// returned as ids AND names — the UI never derives identity from a name.
// ---------------------------------------------------------------------
export async function listOrganizationMembers(client, session) {
  requireSessionPermission(session, "users.view");
  const scope = memberWithinAdministrationScopeSql({ organizationId: "$1", actorUserId: "$2", targetUserId: "membership.user_id" });
  const rows = await client.query(
    `SELECT
        membership.user_id, app_user.email, app_user.full_name, app_user.status AS user_status,
        membership.role AS membership_role, membership.status AS membership_status, membership.created_at AS joined_at,
        COALESCE(role_agg.role_names, ARRAY[]::text[]) AS role_names,
        COALESCE(role_agg.role_ids, ARRAY[]::uuid[]) AS role_ids,
        role_agg.primary_role_id,
        role_agg.primary_role_name,
        COALESCE(company_agg.company_ids, ARRAY[]::uuid[]) AS company_ids,
        COALESCE(company_agg.company_names, ARRAY[]::text[]) AS company_names,
        COALESCE(branch_agg.branch_ids, ARRAY[]::uuid[]) AS branch_ids,
        COALESCE(branch_agg.branch_names, ARRAY[]::text[]) AS branch_names,
        COALESCE(department_agg.department_ids, ARRAY[]::uuid[]) AS department_ids,
        COALESCE(department_agg.department_names, ARRAY[]::text[]) AS department_names,
        COALESCE(team_agg.team_ids, ARRAY[]::uuid[]) AS team_ids,
        COALESCE(team_agg.team_names, ARRAY[]::text[]) AS team_names
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
      LEFT JOIN LATERAL (
        SELECT array_agg(company.id ORDER BY company.name) AS company_ids, array_agg(company.name ORDER BY company.name) AS company_names
        FROM membership_company_access access
        JOIN companies company ON company.id = access.company_id
        WHERE access.organization_id = membership.organization_id AND access.user_id = membership.user_id
      ) AS company_agg ON true
      LEFT JOIN LATERAL (
        SELECT array_agg(branch.id ORDER BY branch.name) AS branch_ids, array_agg(branch.name ORDER BY branch.name) AS branch_names
        FROM membership_branch_access access
        JOIN branches branch ON branch.id = access.branch_id
        WHERE access.organization_id = membership.organization_id AND access.user_id = membership.user_id
      ) AS branch_agg ON true
      LEFT JOIN LATERAL (
        SELECT array_agg(department.id ORDER BY department.name) AS department_ids, array_agg(department.name ORDER BY department.name) AS department_names
        FROM membership_department_access access
        JOIN departments department ON department.id = access.department_id
        WHERE access.organization_id = membership.organization_id AND access.user_id = membership.user_id
      ) AS department_agg ON true
      LEFT JOIN LATERAL (
        SELECT array_agg(team.id ORDER BY team.name) AS team_ids, array_agg(team.name ORDER BY team.name) AS team_names
        FROM membership_team_access access
        JOIN teams team ON team.id = access.team_id
        WHERE access.organization_id = membership.organization_id AND access.user_id = membership.user_id
      ) AS team_agg ON true
      WHERE membership.organization_id = $1
        AND ($3::boolean OR ${scope})
      ORDER BY membership.created_at ASC`,
    [session.organizationId, session.userId, isUnrestricted(session)],
  );
  return rows.rows;
}

export async function setMemberStatus(client, session, targetUserId, status) {
  requireSessionPermission(session, "users.manage");
  if (!["active", "disabled"].includes(status)) throw new OrganizationAdministrationError(422, "Status must be active or disabled.", "ORG_ADMIN_VALIDATION");
  if (targetUserId === session.userId) throw new OrganizationAdministrationError(422, "You cannot change your own membership status.", "ORG_ADMIN_SELF_TARGET");
  await assertUserWithinAdministrationScope(client, {
    organizationId: session.organizationId,
    actorUserId: session.userId,
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
