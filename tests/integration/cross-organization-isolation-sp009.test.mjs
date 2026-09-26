// Real PostgreSQL integration test — SP009 (record/field/contextual
// access control), adversarial pass. The `tenant` Postgres schema (511
// tables: leads, sales, invoices, and all other real business data) has
// database-ENFORCED row-level security as defense in depth (verified
// separately this pass: 511/511 tables, ENABLE + FORCE, a real per-org
// USING policy). The `platform` schema tables this file targets --
// roles, role_permissions, companies, branches, organization_memberships,
// user_role_assignments -- do NOT have RLS (confirmed: 0/79 public-schema
// tables). Isolation for those tables relies ENTIRELY on an explicit
// `WHERE organization_id = $1` in every query inside access-
// administration.js/organization-administration.js -- there is no
// database-level safety net if one of those WHERE clauses is ever wrong.
// That makes this the single highest-risk surface for a cross-tenant data
// leak or cross-tenant mutation in the whole SP001/SP008 feature set this
// session built, and it had zero adversarial test coverage before this
// file: neither organization-administration-sp001-sp003.test.mjs nor
// access-administration-sp008.test.mjs tests a caller from one
// organization attempting to read or mutate another organization's role/
// company/branch/member records by guessing or reusing a real id.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";
import {
  createRole,
  updateRole,
  archiveRole,
  setUserRoles,
  setUserAccessScope,
  AccessAdministrationError,
} from "../../services/api/src/core/access/administration-service.js";
import {
  createCompany,
  updateCompany,
  createBranch,
  updateBranch,
  setMemberStatus,
  OrganizationAdministrationError,
} from "../../services/api/src/core/organization/administration.js";
import { ALL_PERMISSIONS } from "../../packages/permissions/src/catalog.js";

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

test("SP009 adversarial: cross-organization isolation for role/company/branch/member administration (no-RLS platform schema)", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  // Two fully independent organizations, each with its own owner, so
  // "org A's owner acting against org B's resource id" is a real,
  // representative attack: a legitimate, authenticated, highly-privileged
  // actor in THEIR OWN organization, targeting a real id that happens to
  // belong to someone else's.
  async function makeOrg(label) {
    const orgId = randomUUID();
    const ownerId = randomUUID();
    const ownerRoleId = randomUUID();
    await admin.query(
      `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,$3,'x','active',now())`,
      [ownerId, `sp009-owner-${ownerId}@test.invalid`, `SP009 ${label} Owner`],
    );
    await admin.query(
      `INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,$2,$3,'IN','Asia/Kolkata','INR',$4)`,
      [orgId, `SP009 ${label} Org`, `sp009-org-${orgId}`, ownerId],
    );
    await admin.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')`, [orgId, ownerId]);
    await admin.query(
      `INSERT INTO roles(id,organization_id,name,slug,is_system,status,module_key,assignable,risk_level,version) VALUES($1,$2,'Organization Owner','organization_owner',true,'active','platform',true,'privileged',1)`,
      [ownerRoleId, orgId],
    );
    await admin.query(`INSERT INTO role_permissions(role_id,permission_key) SELECT $1, unnest($2::text[])`, [ownerRoleId, ALL_PERMISSIONS]);
    await admin.query(`INSERT INTO user_role_assignments(organization_id,user_id,role_id,is_primary,status) VALUES($1,$2,$3,true,'active')`, [orgId, ownerId, ownerRoleId]);
    const session = { organizationId: orgId, userId: ownerId, roleSlugs: ["organization_owner"], permissions: [...ALL_PERMISSIONS] };
    return { orgId, ownerId, ownerRoleId, session };
  }

  async function cleanup(org) {
    await admin.query(`DELETE FROM user_role_assignments WHERE organization_id=$1`, [org.orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE organization_id=$1)`, [org.orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM role_version_snapshots WHERE organization_id=$1`, [org.orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM roles WHERE organization_id=$1`, [org.orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM membership_company_access WHERE organization_id=$1`, [org.orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM membership_branch_access WHERE organization_id=$1`, [org.orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM branches WHERE organization_id=$1`, [org.orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM companies WHERE organization_id=$1`, [org.orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM organization_memberships WHERE organization_id=$1`, [org.orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM audit_events WHERE organization_id=$1`, [org.orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM organizations WHERE id=$1`, [org.orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM users WHERE id=$1`, [org.ownerId]).catch(() => undefined);
  }

  const orgA = await makeOrg("A");
  const orgB = await makeOrg("B");

  try {
    let orgBRoleId;
    await t.test("setup: org B creates its own custom role", async () => {
      const role = await createRole(admin, orgB.session, { name: "B Only Role", permissionKeys: ["workspace.view"] });
      orgBRoleId = role.id;
    });

    await t.test("CROSS-ORG: org A's owner cannot update org B's role by id", async () => {
      await assert.rejects(
        () => updateRole(admin, orgA.session, orgBRoleId, { name: "Hijacked" }),
        (error) => error instanceof AccessAdministrationError && error.status === 404,
        "the WHERE organization_id=$1 scoping in loadRoleForOrganization must make org B's role id simply not found from org A's session, not merely permission-denied",
      );
    });

    await t.test("CROSS-ORG: org A's owner cannot archive org B's role by id", async () => {
      await assert.rejects(
        () => archiveRole(admin, orgA.session, orgBRoleId),
        (error) => error instanceof AccessAdministrationError && error.status === 404,
      );
      const stillActive = await admin.query(`SELECT status FROM roles WHERE id=$1`, [orgBRoleId]);
      assert.equal(stillActive.rows[0]?.status, "active", "org B's role must be completely unaffected by org A's attempt");
    });

    await t.test("CROSS-ORG: org A's owner cannot assign org B's role to an org A user", async () => {
      await assert.rejects(
        () => setUserRoles(admin, orgA.session, { targetUserId: orgA.ownerId, roleIds: [orgBRoleId], primaryRoleId: orgBRoleId }),
        (error) => error.status === 400 || error.status === 404,
        "validateRoleSelection's own organization_id=$1 filter must make org B's role id resolve as unavailable, never silently assignable across tenants",
      );
    });

    let orgBCompanyId;
    await t.test("setup: org B creates its own company", async () => {
      const company = await createCompany(admin, orgB.session, { name: "B Co", legalName: "B Co Ltd", code: "BCO", countryCode: "IN", baseCurrency: "INR" });
      orgBCompanyId = company.id;
    });

    await t.test("CROSS-ORG: org A's owner cannot update org B's company by id", async () => {
      await assert.rejects(
        () => updateCompany(admin, orgA.session, orgBCompanyId, { name: "Hijacked Co" }),
        (error) => error instanceof OrganizationAdministrationError && error.status === 404,
      );
    });

    let orgBBranchId;
    await t.test("setup: org B creates its own branch", async () => {
      const branch = await createBranch(admin, orgB.session, { companyId: orgBCompanyId, name: "B Branch", code: "BB1", timezone: "Asia/Kolkata" });
      orgBBranchId = branch.id;
    });

    await t.test("CROSS-ORG: org A's owner cannot update org B's branch by id", async () => {
      await assert.rejects(
        () => updateBranch(admin, orgA.session, orgBBranchId, { name: "Hijacked Branch" }),
        (error) => error instanceof OrganizationAdministrationError && error.status === 404,
      );
    });

    await t.test("CROSS-ORG: org A's owner cannot grant an org A user access to org B's company (scope-outside-tenant rejection, not silent success)", async () => {
      await assert.rejects(
        () => setUserAccessScope(admin, orgA.session, orgA.ownerId, { companyIds: [orgBCompanyId], branchIds: [] }),
        (error) => error instanceof AccessAdministrationError && error.code === "ACCESS_ADMIN_COMPANY_INVALID",
        "granting access to a company id that does not belong to the caller's own organization must be rejected, never silently create a cross-tenant membership_company_access row",
      );
      const leaked = await admin.query(`SELECT 1 FROM membership_company_access WHERE user_id=$1 AND company_id=$2`, [orgA.ownerId, orgBCompanyId]);
      assert.equal(leaked.rows.length, 0, "no cross-tenant access-grant row must ever be created");
    });

    await t.test("CROSS-ORG: org A's owner cannot disable a member of org B (setMemberStatus)", async () => {
      await assert.rejects(
        () => setMemberStatus(admin, orgA.session, orgB.ownerId, "disabled"),
        (error) => error instanceof OrganizationAdministrationError && error.status === 404,
      );
      const stillActive = await admin.query(`SELECT status FROM organization_memberships WHERE organization_id=$1 AND user_id=$2`, [orgB.orgId, orgB.ownerId]);
      assert.equal(stillActive.rows[0]?.status, "active", "org B's owner membership must be completely unaffected");
    });
  } finally {
    await cleanup(orgA);
    await cleanup(orgB);
    await admin.end();
  }
});
