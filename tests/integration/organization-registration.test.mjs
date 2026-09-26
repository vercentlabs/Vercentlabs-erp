// Real PostgreSQL integration test — self-serve organization registration
// (the "create your own account" flow, apps/web's /register page ->
// POST /api/auth/register -> registerOrganization). Closes two real gaps:
// (1) there was previously no self-serve organization-creation path at
// all (SP004's invite-only model, by design, per the onboarding page's
// own prior copy); (2) a brand-new organization had no role catalog at
// all -- migrations 018/027 only ever seeded roles for organizations that
// existed AT MIGRATION TIME (a CROSS JOIN against organizations, no
// ongoing trigger), so any organization created after those migrations
// ran -- including every one created by this session's own test fixtures
// -- started with zero rows in `roles`. bootstrapOrganizationRoles fixes
// this by copying the canonical ROLE_TEMPLATES catalog
// (packages/permissions/src/roles.js), the same source those migrations
// were manually kept in sync with, rather than re-deriving a second copy.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";
import { registerOrganization, bootstrapOrganizationRoles, OrganizationRegistrationError } from "../../services/api/src/core/organization-registration.js";
import { ROLE_TEMPLATES } from "../../packages/permissions/src/roles.js";
import { hasSessionPermission } from "../../services/api/src/core/access-control-runtime.js";

const adminConnectionString = process.env.MIGRATION_DATABASE_URL || "";

async function connectOrNull(connectionString) {
  if (!connectionString) return null;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

test("SP004: self-serve organization registration against a real database", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  async function cleanup(organizationId, userId) {
    await admin.query(`DELETE FROM user_role_assignments WHERE organization_id=$1`, [organizationId]).catch(() => undefined);
    await admin.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE organization_id=$1)`, [organizationId]).catch(() => undefined);
    await admin.query(`DELETE FROM roles WHERE organization_id=$1`, [organizationId]).catch(() => undefined);
    await admin.query(`DELETE FROM organization_memberships WHERE organization_id=$1`, [organizationId]).catch(() => undefined);
    await admin.query(`DELETE FROM organization_subscriptions WHERE organization_id=$1`, [organizationId]).catch(() => undefined);
    await admin.query(`DELETE FROM organizations WHERE id=$1`, [organizationId]).catch(() => undefined);
    await admin.query(`DELETE FROM users WHERE id=$1`, [userId]).catch(() => undefined);
  }

  try {
    let firstOrgId;
    let firstUserId;
    const email = `sp004-register-${randomUUID()}@test.invalid`;

    await t.test("registerOrganization creates a real, immediately-usable organization: user, org, real trial subscription, and the FULL role catalog", async () => {
      const result = await registerOrganization(admin, {
        fullName: "New Customer Owner",
        email,
        password: "RealSignupP@ssw0rd1",
        organizationName: `SP004 Register Co ${randomUUID().slice(0, 8)}`,
        countryCode: "IN",
        baseCurrency: "INR",
        timezone: "Asia/Kolkata",
      });
      firstOrgId = result.organizationId;
      firstUserId = result.userId;

      const user = await admin.query(`SELECT email, status, password_hash, email_verified_at FROM users WHERE id=$1`, [firstUserId]);
      assert.equal(user.rows[0].email, email);
      assert.equal(user.rows[0].status, "active");
      assert.ok(user.rows[0].password_hash, "a real password hash must be stored");
      assert.equal(user.rows[0].email_verified_at, null, "signup must NOT auto-verify the email -- the real verify-email flow still applies");

      const org = await admin.query(`SELECT name, slug, created_by FROM organizations WHERE id=$1`, [firstOrgId]);
      assert.equal(org.rows[0].created_by, firstUserId);
      assert.ok(org.rows[0].slug, "a real, non-empty slug must be generated");

      // REGRESSION GUARD for the role-bootstrap gap: every one of the 36
      // canonical role templates must exist for this brand-new org, not
      // just an ad-hoc "organization_owner" row.
      const roles = await admin.query(`SELECT slug FROM roles WHERE organization_id=$1 AND is_system=true`, [firstOrgId]);
      const roleSlugs = new Set(roles.rows.map((r) => r.slug));
      assert.equal(roleSlugs.size, ROLE_TEMPLATES.length, `expected all ${ROLE_TEMPLATES.length} role templates, got ${roleSlugs.size}`);
      for (const template of ROLE_TEMPLATES) {
        assert.ok(roleSlugs.has(template.slug), `missing role template: ${template.slug}`);
      }

      // The owner's role assignment must carry the FULL organization_owner
      // permission set (ALL_PERMISSIONS per the template), not a partial
      // one -- confirmed via the same hasSessionPermission the rest of the
      // app uses, not just a raw row count.
      const ownerRole = await admin.query(`SELECT id FROM roles WHERE organization_id=$1 AND slug='organization_owner'`, [firstOrgId]);
      const grantedPermissions = await admin.query(`SELECT permission_key FROM role_permissions WHERE role_id=$1`, [ownerRole.rows[0].id]);
      const ownerTemplate = ROLE_TEMPLATES.find((t) => t.slug === "organization_owner");
      assert.equal(grantedPermissions.rows.length, ownerTemplate.permissions.length);
      const fakeSession = { roleSlugs: ["organization_owner"], permissions: grantedPermissions.rows.map((r) => r.permission_key) };
      assert.equal(hasSessionPermission(fakeSession, "organization.manage"), true);
      assert.equal(hasSessionPermission(fakeSession, "roles.manage"), true);

      const membership = await admin.query(`SELECT role, status FROM organization_memberships WHERE organization_id=$1 AND user_id=$2`, [firstOrgId, firstUserId]);
      assert.equal(membership.rows[0].role, "owner");
      assert.equal(membership.rows[0].status, "active");

      const assignment = await admin.query(`SELECT is_primary, status FROM user_role_assignments WHERE organization_id=$1 AND user_id=$2 AND role_id=$3`, [firstOrgId, firstUserId, ownerRole.rows[0].id]);
      assert.equal(assignment.rows[0].is_primary, true);
      assert.equal(assignment.rows[0].status, "active");

      // migrations 051/052's trigger must have fired: a REAL trial, never
      // Founder Preview, for a self-serve signup -- same regression guard
      // as organization-subscription-auto-provision.test.mjs.
      const sub = await admin.query(`SELECT status, included_users_snapshot FROM organization_subscriptions WHERE organization_id=$1`, [firstOrgId]);
      assert.equal(sub.rows[0].status, "active");
      assert.notEqual(sub.rows[0].status, "internal");
      assert.equal(sub.rows[0].included_users_snapshot, 1, "a self-serve signup starts on Free with 1 user (migration 061)");
    });

    await t.test("a new organization can create its first account: numbering series and the base currency exist from the start", async () => {
      const numbering = await admin.query(`SELECT entity_type FROM numbering_series WHERE organization_id=$1`, [firstOrgId]);
      const types = new Set(numbering.rows.map((r) => r.entity_type));
      for (const needed of ["business_party", "contact", "crm_lead", "crm_opportunity", "crm_activity", "customer_invoice", "journal_entry"]) {
        assert.ok(types.has(needed), `numbering series for ${needed} must exist for a new organization`);
      }
      await admin.query("BEGIN");
      try {
        await admin.query(`SELECT set_config('app.current_organization_id', $1, true)`, [firstOrgId]);
        const currencies = await admin.query(`SELECT code, is_base, status FROM tenant.currencies WHERE organization_id=$1`, [firstOrgId]);
        assert.deepEqual(currencies.rows.map((r) => [r.code.trim(), r.is_base, r.status]), [["INR", true, "active"]]);
        // The exact failure a new customer hit: an account carrying the organisation's own currency.
        const party = await admin.query(
          `INSERT INTO tenant.business_parties (organization_id, code, party_type, display_name, currency_code) VALUES ($1, 'PTY-CHECK', 'customer', 'First account', 'INR') RETURNING id`,
          [firstOrgId],
        );
        assert.ok(party.rows[0].id);
        await admin.query("ROLLBACK");
      } catch (error) {
        await admin.query("ROLLBACK");
        throw error;
      }
    });

    await t.test("registering again with the SAME email is rejected, not silently creating a second account", async () => {
      await assert.rejects(
        () =>
          registerOrganization(admin, {
            fullName: "Duplicate Attempt",
            email,
            password: "AnotherRealP@ss1234",
            organizationName: "Duplicate Co",
            countryCode: "IN",
            baseCurrency: "INR",
            timezone: "Asia/Kolkata",
          }),
        (error) => error instanceof OrganizationRegistrationError && error.status === 409 && error.code === "ORG_REGISTRATION_EMAIL_TAKEN",
      );
    });

    await t.test("a weak password is rejected by the real password policy, not a client-side-only check", async () => {
      await assert.rejects(
        () =>
          registerOrganization(admin, {
            fullName: "Weak Password",
            email: `sp004-weak-${randomUUID()}@test.invalid`,
            password: "short1",
            organizationName: "Weak Password Co",
            countryCode: "IN",
            baseCurrency: "INR",
            timezone: "Asia/Kolkata",
          }),
        (error) => error instanceof OrganizationRegistrationError && error.status === 422 && error.code === "ORG_REGISTRATION_PASSWORD_POLICY",
      );
    });

    await t.test("two different organizations registering with a colliding organization-name slug both get real, distinct slugs", async () => {
      const name = `Collision Co ${randomUUID().slice(0, 6)}`;
      const first = await registerOrganization(admin, {
        fullName: "First Owner",
        email: `sp004-collide-a-${randomUUID()}@test.invalid`,
        password: "CollisionP@ss1234",
        organizationName: name,
        countryCode: "IN",
        baseCurrency: "INR",
        timezone: "Asia/Kolkata",
      });
      const second = await registerOrganization(admin, {
        fullName: "Second Owner",
        email: `sp004-collide-b-${randomUUID()}@test.invalid`,
        password: "CollisionP@ss1234",
        organizationName: name,
        countryCode: "IN",
        baseCurrency: "INR",
        timezone: "Asia/Kolkata",
      });
      try {
        const slugs = await admin.query(`SELECT id, slug FROM organizations WHERE id = ANY($1::uuid[])`, [[first.organizationId, second.organizationId]]);
        const distinctSlugs = new Set(slugs.rows.map((r) => r.slug));
        assert.equal(distinctSlugs.size, 2, "colliding organization names must never produce the same slug");
      } finally {
        await cleanup(first.organizationId, first.userId);
        await cleanup(second.organizationId, second.userId);
      }
    });

    await t.test("bootstrapOrganizationRoles is idempotent -- calling it twice never duplicates roles or errors", async () => {
      await bootstrapOrganizationRoles(admin, firstOrgId);
      const roles = await admin.query(`SELECT count(*)::int AS n FROM roles WHERE organization_id=$1 AND is_system=true`, [firstOrgId]);
      assert.equal(roles.rows[0].n, ROLE_TEMPLATES.length);
    });

    if (firstOrgId) await cleanup(firstOrgId, firstUserId);
  } finally {
    await admin.end();
  }
});
