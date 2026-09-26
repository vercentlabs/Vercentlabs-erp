// Self-serve organization registration ("create your own account/company").
// Real gap this closes: organization creation was invite-only/administrative
// with zero self-serve path (SP004's documented model) -- every
// organization in the system, including every test fixture, was created by
// a script directly against the database. A prospective new customer had
// no way to sign themselves up at all.
//
// A second, previously-undiscovered gap this closes as a prerequisite:
// the standard role catalog (organization_owner, system_administrator, ...)
// is only ever seeded for organizations that existed AT THE TIME a role-
// catalog migration ran (migrations 018/027's `CROSS JOIN organizations`
// pattern) -- there is no ongoing mechanism giving a brand-new organization
// ANY roles at all. Confirmed empirically: organizations created by this
// session's own test fixtures (and any org created by this new
// registration flow) start with zero rows in `roles`. bootstrapOrganizationRoles
// below closes that gap by copying the canonical, already-existing
// ROLE_TEMPLATES catalog (packages/permissions/src/roles.js -- the same
// framework-agnostic source migrations 018/027 were manually kept in sync
// with) rather than re-encoding a second, driftable copy of it.
import { randomUUID } from "node:crypto";

import { setTenantContext } from "@vercentlabs/database";

import { ROLE_TEMPLATES } from "@vercentlabs/permissions";

import { hashPassword } from "../auth/session.js";
import { passwordPolicyIssues } from "../auth/password-policy.js";

export class OrganizationRegistrationError extends Error {
  constructor(status, message, code = "ORG_REGISTRATION_ERROR", details) {
    super(message);
    this.name = "OrganizationRegistrationError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function requiredText(value, label, maxLength) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) throw new OrganizationRegistrationError(422, `${label} is required.`, "ORG_REGISTRATION_VALIDATION");
  if (trimmed.length > maxLength) throw new OrganizationRegistrationError(422, `${label} must be ${maxLength} characters or fewer.`, "ORG_REGISTRATION_VALIDATION");
  return trimmed;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function slugify(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// Seeds the full standard role catalog (all 36 templates: organization_owner
// through the per-module manager roles) plus their permission grants for a
// brand-new organization. Idempotent (ON CONFLICT DO NOTHING throughout),
// safe to call more than once, and deliberately NOT installed as a
// blanket database trigger on `organizations` the way the subscription
// auto-provisioning trigger (migration 051/052) is -- unlike subscriptions,
// dozens of existing tests deliberately create their own minimal,
// hand-picked role sets for a fresh org, and a global trigger would
// collide with those on the (organization_id, slug) unique constraint.
// This is called explicitly, only from this module's own registration
// flow, so it never touches any path that doesn't ask for it.
export async function bootstrapOrganizationRoles(client, organizationId) {
  const createdRoleIdBySlug = new Map();
  for (const template of ROLE_TEMPLATES) {
    const roleId = randomUUID();
    const inserted = await client.query(
      `INSERT INTO roles (id, organization_id, name, slug, description, is_system, status, module_key, template_key, assignable, risk_level, version)
       VALUES ($1, $2, $3, $4, $5, true, 'active', $6, $4, $7, $8, 1)
       ON CONFLICT (organization_id, slug) DO NOTHING
       RETURNING id`,
      [roleId, organizationId, template.name, template.slug, template.description, template.moduleKey, template.assignable, template.riskLevel],
    );
    const actualRoleId = inserted.rows[0]?.id
      ?? (await client.query(`SELECT id FROM roles WHERE organization_id = $1 AND slug = $2`, [organizationId, template.slug])).rows[0]?.id;
    createdRoleIdBySlug.set(template.slug, actualRoleId);
    if (template.permissions.length) {
      await client.query(
        `INSERT INTO role_permissions (role_id, permission_key) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING`,
        [actualRoleId, [...template.permissions]],
      );
    }
  }
  return createdRoleIdBySlug;
}

// Full self-serve flow: validate, create the user and organization
// together, bootstrap the role catalog, make the caller the
// organization_owner. Does NOT mark the email verified and does NOT send
// the verification email itself (the caller, at the route layer, does
// that the same way every other auth flow does -- createEmailVerificationToken)
// and does NOT create a session (also a route-layer concern, matching
// acceptOrganizationInvitation's existing split of responsibility).
export async function registerOrganization(client, input) {
  const fullName = requiredText(input.fullName, "Your name", 200);
  const email = requiredText(input.email, "Email", 320).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) throw new OrganizationRegistrationError(422, "Enter a valid email address.", "ORG_REGISTRATION_VALIDATION");
  const password = String(input.password ?? "");
  const passwordIssues = passwordPolicyIssues(password, { email });
  if (passwordIssues.length) throw new OrganizationRegistrationError(422, passwordIssues[0], "ORG_REGISTRATION_PASSWORD_POLICY", { issues: passwordIssues });

  const organizationName = requiredText(input.organizationName, "Organization name", 200);
  const countryCode = requiredText(input.countryCode, "Country code", 2).toUpperCase();
  if (countryCode.length !== 2) throw new OrganizationRegistrationError(422, "Country code must be a 2-letter ISO code.", "ORG_REGISTRATION_VALIDATION");
  const baseCurrency = requiredText(input.baseCurrency, "Base currency", 3).toUpperCase();
  if (baseCurrency.length !== 3) throw new OrganizationRegistrationError(422, "Base currency must be a 3-letter ISO code.", "ORG_REGISTRATION_VALIDATION");
  const timezone = requiredText(input.timezone, "Timezone", 100);

  const existing = await client.query(`SELECT id FROM users WHERE lower(email) = $1`, [email]);
  if (existing.rows[0]) {
    throw new OrganizationRegistrationError(409, "An account with this email already exists. Sign in instead.", "ORG_REGISTRATION_EMAIL_TAKEN");
  }

  const userId = randomUUID();
  const passwordHash = await hashPassword(password);
  await client.query(
    `INSERT INTO users (id, email, full_name, password_hash, status) VALUES ($1, $2, $3, $4, 'active')`,
    [userId, email, fullName, passwordHash],
  );

  const organizationId = randomUUID();
  // Everything below creates the new organisation's own rows: the caller's
  // transaction runs under the new organisation's context from here on
  // (platform and tenant tables are organisation-RLS protected).
  await setTenantContext(client, organizationId);
  const baseSlug = slugify(organizationName) || "organization";
  const existingSlugs = new Set(
    (await client.query(`SELECT slug FROM organizations WHERE slug LIKE $1`, [`${baseSlug}%`])).rows.map((row) => row.slug),
  );
  let slug = baseSlug;
  let suffix = 2;
  while (existingSlugs.has(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }
  await client.query(
    `INSERT INTO organizations (id, name, slug, country_code, timezone, base_currency, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [organizationId, organizationName, slug, countryCode, timezone, baseCurrency, userId],
  );
  // A new organisation starts with a base currency row for accounts to reference (only added when missing). Document
  // numbering needs no seeding: the platform numbering registry supplies every type's default format.
  await client.query("SELECT tenant.ensure_organization_base_currency($1)", [organizationId]);
  // migrations 051/052's organizations_ensure_subscription trigger already
  // provisioned a real trial subscription for this organization at this
  // point -- nothing further to do for billing state here.

  const roleIdBySlug = await bootstrapOrganizationRoles(client, organizationId);
  const ownerRoleId = roleIdBySlug.get("organization_owner");
  if (!ownerRoleId) throw new OrganizationRegistrationError(500, "Could not provision the organization owner role.", "ORG_REGISTRATION_ROLE_BOOTSTRAP_FAILED");

  await client.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`,
    [organizationId, userId],
  );
  await client.query(
    `INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) VALUES ($1, $2, $3, true, 'active')`,
    [organizationId, userId, ownerRoleId],
  );

  return { userId, organizationId, email, fullName };
}
