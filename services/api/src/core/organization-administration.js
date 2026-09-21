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
import { assertSeatAvailable, reconcileSeatOverage, withSeatLock } from "./subscription-billing.js";

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
// Companies
// ---------------------------------------------------------------------

// Admin management view: EVERY company in the organization regardless of
// status (an admin managing companies needs to see and reactivate an
// inactive one) — a different audience/semantic than session.js's
// listAccessibleCompanies (self-service "which can I currently work in",
// active-only, access-scoped).
export async function listOrganizationCompanies(client, session) {
  requireSessionPermission(session, "company.manage");
  const rows = await client.query(
    `SELECT id, name, legal_name, code, country_code, base_currency, tax_id, is_primary, status, created_at, updated_at
       FROM companies WHERE organization_id = $1
       ORDER BY is_primary DESC, created_at ASC`,
    [session.organizationId],
  );
  return rows.rows;
}

export async function createCompany(client, session, input) {
  requireSessionPermission(session, "company.manage");
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
    companyId
      ? `SELECT * FROM branches WHERE organization_id = $1 AND company_id = $2 ORDER BY is_primary DESC, created_at ASC`
      : `SELECT * FROM branches WHERE organization_id = $1 ORDER BY is_primary DESC, created_at ASC`,
    companyId ? [session.organizationId, companyId] : [session.organizationId],
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

  const duplicate = await client.query(`SELECT 1 FROM branches WHERE organization_id = $1 AND upper(code) = $2`, [session.organizationId, code]);
  if (duplicate.rows[0]) throw new OrganizationAdministrationError(409, `A branch with code "${code}" already exists.`, "ORG_ADMIN_DUPLICATE_CODE");

  const id = randomUUID();
  await client.query(
    `INSERT INTO branches (id, organization_id, company_id, name, code, timezone, is_primary, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'active')`,
    [id, session.organizationId, companyId, name, code, timezone, Boolean(input.isPrimary)],
  );
  return (await client.query(`SELECT * FROM branches WHERE id = $1`, [id])).rows[0];
}

export async function updateBranch(client, session, branchId, updates) {
  requireSessionPermission(session, "branch.manage");
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

// ---------------------------------------------------------------------
// Company/branch access grants (Settings > People > company/branch
// assignment for an EXISTING member — the invitation-time grant path is
// auth-lifecycle.js's createOrganizationInvitation/acceptOrganizationInvitation).
// ---------------------------------------------------------------------
export async function setUserCompanyAccess(client, session, targetUserId, companyIds) {
  requireSessionPermission(session, "users.manage");
  const unique = [...new Set(companyIds)];
  if (unique.length) {
    const found = await client.query(`SELECT id FROM companies WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [session.organizationId, unique]);
    if (found.rows.length !== unique.length) throw new OrganizationAdministrationError(422, "One or more companies do not belong to this organization.", "ORG_ADMIN_COMPANY_INVALID");
  }
  await client.query(`DELETE FROM membership_company_access WHERE organization_id = $1 AND user_id = $2`, [session.organizationId, targetUserId]);
  for (const companyId of unique) {
    await client.query(`INSERT INTO membership_company_access (organization_id, user_id, company_id) VALUES ($1, $2, $3)`, [session.organizationId, targetUserId, companyId]);
  }
  return { companyIds: unique };
}

export async function setUserBranchAccess(client, session, targetUserId, branchIds) {
  requireSessionPermission(session, "users.manage");
  const unique = [...new Set(branchIds)];
  if (unique.length) {
    const found = await client.query(`SELECT id FROM branches WHERE organization_id = $1 AND id = ANY($2::uuid[])`, [session.organizationId, unique]);
    if (found.rows.length !== unique.length) throw new OrganizationAdministrationError(422, "One or more branches do not belong to this organization.", "ORG_ADMIN_BRANCH_INVALID");
  }
  await client.query(`DELETE FROM membership_branch_access WHERE organization_id = $1 AND user_id = $2`, [session.organizationId, targetUserId]);
  for (const branchId of unique) {
    await client.query(`INSERT INTO membership_branch_access (organization_id, user_id, branch_id) VALUES ($1, $2, $3)`, [session.organizationId, targetUserId, branchId]);
  }
  return { branchIds: unique };
}

// ---------------------------------------------------------------------
// Roles (for the invitation form / users screen's role picker — role
// CREATE/EDIT itself is validateRoleSelection's territory, access-administration.js)
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
// Organization members (Settings > People > Users)
// ---------------------------------------------------------------------
export async function listOrganizationMembers(client, session) {
  requireSessionPermission(session, "users.view");
  const rows = await client.query(
    `SELECT
        membership.user_id, app_user.email, app_user.full_name, app_user.status AS user_status,
        membership.role AS membership_role, membership.status AS membership_status, membership.created_at AS joined_at,
        COALESCE(role_agg.role_names, ARRAY[]::text[]) AS role_names,
        COALESCE(role_agg.role_ids, ARRAY[]::uuid[]) AS role_ids,
        role_agg.primary_role_id,
        COALESCE(company_agg.company_names, ARRAY[]::text[]) AS company_names,
        COALESCE(branch_agg.branch_names, ARRAY[]::text[]) AS branch_names
      FROM organization_memberships AS membership
      JOIN users AS app_user ON app_user.id = membership.user_id
      LEFT JOIN LATERAL (
        SELECT array_agg(DISTINCT role.name) AS role_names,
               array_agg(DISTINCT role.id) AS role_ids,
               (array_agg(role.id ORDER BY assignment.is_primary DESC))[1] AS primary_role_id
        FROM user_role_assignments assignment
        JOIN roles role ON role.id = assignment.role_id AND role.organization_id = membership.organization_id
        WHERE assignment.organization_id = membership.organization_id AND assignment.user_id = membership.user_id AND assignment.status = 'active'
      ) AS role_agg ON true
      LEFT JOIN LATERAL (
        SELECT array_agg(company.name) AS company_names
        FROM membership_company_access access
        JOIN companies company ON company.id = access.company_id
        WHERE access.organization_id = membership.organization_id AND access.user_id = membership.user_id
      ) AS company_agg ON true
      LEFT JOIN LATERAL (
        SELECT array_agg(branch.name) AS branch_names
        FROM membership_branch_access access
        JOIN branches branch ON branch.id = access.branch_id
        WHERE access.organization_id = membership.organization_id AND access.user_id = membership.user_id
      ) AS branch_agg ON true
      WHERE membership.organization_id = $1
      ORDER BY membership.created_at ASC`,
    [session.organizationId],
  );
  return rows.rows;
}

export async function setMemberStatus(client, session, targetUserId, status) {
  requireSessionPermission(session, "users.manage");
  if (!["active", "disabled"].includes(status)) throw new OrganizationAdministrationError(422, "Status must be active or disabled.", "ORG_ADMIN_VALIDATION");
  if (targetUserId === session.userId) throw new OrganizationAdministrationError(422, "You cannot change your own membership status.", "ORG_ADMIN_SELF_TARGET");
  const updated = await withSeatLock(client, session.organizationId, async () => {
    if (status === "active") {
      const current = (await client.query(`SELECT status FROM organization_memberships WHERE organization_id=$1 AND user_id=$2`, [session.organizationId, targetUserId])).rows[0];
      if (current && current.status !== "active") await assertSeatAvailable(client, session.organizationId, { additional: 1 });
    }
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
  return { userId: targetUserId, status };
}
