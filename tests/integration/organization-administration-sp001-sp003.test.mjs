// Real PostgreSQL integration test — SP001/SP002/SP003 (organization,
// company and branch administration). Proves the real gap this pass
// closed: companies/branches tables existed since migration 001 with no
// create/update path anywhere in the codebase before
// services/api/src/core/organization-administration.js.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";
import {
  OrganizationAdministrationError,
  getOrganizationProfile,
  updateOrganizationProfile,
  listOrganizationCompanies,
  createCompany,
  updateCompany,
  listOrganizationBranches,
  createBranch,
  updateBranch,
  setUserCompanyAccess,
  setUserBranchAccess,
  listOrganizationMembers,
  setMemberStatus,
} from "../../services/api/src/core/organization-administration.js";
import { PermissionDeniedError } from "../../services/api/src/core/access-control-runtime.js";

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

test("SP001/SP002/SP003: organization/company/branch administration against a real database", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const orgId = randomUUID();
  const ownerId = randomUUID();
  const memberId = randomUUID();
  let companyId;
  let secondCompanyId;
  let branchId;

  try {
    await admin.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,'Org Admin Owner','x','active',now())`, [
      ownerId,
      `org-admin-owner-${ownerId}@test.invalid`,
    ]);
    await admin.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,'Org Admin Member','x','active',now())`, [
      memberId,
      `org-admin-member-${memberId}@test.invalid`,
    ]);
    await admin.query(
      `INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'Org Admin Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `org-admin-test-${orgId}`, ownerId],
    );
    await admin.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'owner','active')`, [orgId, ownerId]);
    await admin.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'member','active')`, [orgId, memberId]);

    const owner = { organizationId: orgId, userId: ownerId, roleSlugs: ["organization_owner"], permissions: [] };
    const unprivileged = { organizationId: orgId, userId: memberId, roleSlugs: [], permissions: [] };

    await t.test("getOrganizationProfile/updateOrganizationProfile", async () => {
      const profile = await getOrganizationProfile(admin, orgId);
      assert.equal(profile.name, "Org Admin Test Org");

      await assert.rejects(() => updateOrganizationProfile(admin, unprivileged, { name: "Hacked" }), (e) => e instanceof PermissionDeniedError);

      const updated = await updateOrganizationProfile(admin, owner, { name: "Renamed Org", fiscalYearStartMonth: 1 });
      assert.equal(updated.name, "Renamed Org");
      assert.equal(updated.fiscal_year_start_month, 1);

      await assert.rejects(
        () => updateOrganizationProfile(admin, owner, { fiscalYearStartMonth: 13 }),
        (e) => e instanceof OrganizationAdministrationError && e.code === "ORG_ADMIN_VALIDATION",
      );
    });

    await t.test("createCompany / updateCompany: real backend where none existed before", async () => {
      await assert.rejects(
        () => createCompany(admin, unprivileged, { name: "X", legalName: "X", code: "X", countryCode: "IN", baseCurrency: "INR" }),
        (e) => e instanceof PermissionDeniedError,
      );

      const company = await createCompany(admin, owner, {
        name: "Primary Co",
        legalName: "Primary Co Pvt Ltd",
        code: "primary",
        countryCode: "in",
        baseCurrency: "inr",
        isPrimary: true,
      });
      companyId = company.id;
      assert.equal(company.code, "PRIMARY", "code is normalized uppercase");
      assert.equal(company.country_code, "IN");
      assert.equal(company.status, "active");

      await assert.rejects(
        () => createCompany(admin, owner, { name: "Dup", legalName: "Dup", code: "PRIMARY", countryCode: "IN", baseCurrency: "INR" }),
        (e) => e instanceof OrganizationAdministrationError && e.code === "ORG_ADMIN_DUPLICATE_CODE",
      );

      const listed = await listOrganizationCompanies(admin, owner);
      assert.ok(listed.some((row) => row.id === companyId));

      const renamed = await updateCompany(admin, owner, companyId, { name: "Primary Co Renamed" });
      assert.equal(renamed.name, "Primary Co Renamed");

      await assert.rejects(
        () => updateCompany(admin, owner, randomUUID(), { name: "Ghost" }),
        (e) => e instanceof OrganizationAdministrationError && e.code === "ORG_ADMIN_COMPANY_NOT_FOUND",
      );

      // Cross-tenant: a company id that's real but belongs to ANOTHER
      // organization must be rejected as not-found, never leaked or edited.
      const foreignOrgId = randomUUID();
      const foreignOwnerId = randomUUID();
      await admin.query(`INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,'Foreign','x','active',now())`, [
        foreignOwnerId,
        `foreign-${foreignOwnerId}@test.invalid`,
      ]);
      await admin.query(`INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'Foreign',$2,'IN','Asia/Kolkata','INR',$3)`, [
        foreignOrgId,
        `foreign-org-${foreignOrgId}`,
        foreignOwnerId,
      ]);
      const foreignCompany = await createCompany({ query: admin.query.bind(admin) }, { organizationId: foreignOrgId, roleSlugs: ["organization_owner"], permissions: [] }, {
        name: "Foreign Co",
        legalName: "Foreign Co",
        code: "FOREIGN",
        countryCode: "IN",
        baseCurrency: "INR",
      });
      await assert.rejects(
        () => updateCompany(admin, owner, foreignCompany.id, { name: "Stolen" }),
        (e) => e instanceof OrganizationAdministrationError && e.code === "ORG_ADMIN_COMPANY_NOT_FOUND",
      );
      await admin.query(`DELETE FROM companies WHERE id=$1`, [foreignCompany.id]);
      await admin.query(`DELETE FROM organizations WHERE id=$1`, [foreignOrgId]);
      await admin.query(`DELETE FROM users WHERE id=$1`, [foreignOwnerId]);

      const secondCompany = await createCompany(admin, owner, { name: "Second Co", legalName: "Second Co", code: "SECOND", countryCode: "IN", baseCurrency: "INR" });
      secondCompanyId = secondCompany.id;
    });

    await t.test("createBranch / updateBranch: real backend where none existed before", async () => {
      await assert.rejects(
        () => createBranch(admin, owner, { name: "X", code: "X", timezone: "Asia/Kolkata", companyId: randomUUID() }),
        (e) => e instanceof OrganizationAdministrationError && e.code === "ORG_ADMIN_COMPANY_INVALID",
      );

      const branch = await createBranch(admin, owner, { name: "HQ", code: "hq", timezone: "Asia/Kolkata", companyId, isPrimary: true });
      branchId = branch.id;
      assert.equal(branch.code, "HQ");
      assert.equal(branch.company_id, companyId);

      await assert.rejects(
        () => createBranch(admin, owner, { name: "Dup", code: "HQ", timezone: "Asia/Kolkata", companyId }),
        (e) => e instanceof OrganizationAdministrationError && e.code === "ORG_ADMIN_DUPLICATE_CODE",
      );

      const listedAll = await listOrganizationBranches(admin, owner);
      assert.ok(listedAll.some((row) => row.id === branchId));
      const listedForCompany = await listOrganizationBranches(admin, owner, companyId);
      assert.equal(listedForCompany.length, 1);

      const renamed = await updateBranch(admin, owner, branchId, { name: "Head Office" });
      assert.equal(renamed.name, "Head Office");
    });

    await t.test("setUserCompanyAccess / setUserBranchAccess: the missing grant-management surface", async () => {
      await assert.rejects(() => setUserCompanyAccess(admin, unprivileged, memberId, [companyId]), (e) => e instanceof PermissionDeniedError);

      await setUserCompanyAccess(admin, owner, memberId, [companyId, secondCompanyId]);
      const companyGrants = await admin.query(`SELECT company_id FROM membership_company_access WHERE organization_id=$1 AND user_id=$2`, [orgId, memberId]);
      assert.equal(companyGrants.rows.length, 2);

      // Re-setting to a SMALLER set must remove the dropped grant, not just add.
      await setUserCompanyAccess(admin, owner, memberId, [companyId]);
      const companyGrantsAfter = await admin.query(`SELECT company_id FROM membership_company_access WHERE organization_id=$1 AND user_id=$2`, [orgId, memberId]);
      assert.equal(companyGrantsAfter.rows.length, 1);
      assert.equal(companyGrantsAfter.rows[0].company_id, companyId);

      await setUserBranchAccess(admin, owner, memberId, [branchId]);
      const branchGrants = await admin.query(`SELECT branch_id FROM membership_branch_access WHERE organization_id=$1 AND user_id=$2`, [orgId, memberId]);
      assert.equal(branchGrants.rows.length, 1);

      await assert.rejects(
        () => setUserCompanyAccess(admin, owner, memberId, [randomUUID()]),
        (e) => e instanceof OrganizationAdministrationError && e.code === "ORG_ADMIN_COMPANY_INVALID",
      );
    });

    await t.test("listOrganizationMembers reflects real role/company/branch state", async () => {
      const members = await listOrganizationMembers(admin, owner);
      const memberRow = members.find((row) => row.user_id === memberId);
      assert.ok(memberRow);
      assert.ok(memberRow.company_names.includes("Primary Co Renamed"));
      assert.ok(memberRow.branch_names.includes("Head Office"));
    });

    await t.test("setMemberStatus: disabling revokes live sessions and blocks self-targeting", async () => {
      const { createSession } = await import("../../services/api/src/core/session.js");
      const memberSession = await createSession(admin, { userId: memberId, ipAddress: "127.0.0.1", userAgent: "test", env: {} });

      await assert.rejects(
        () => setMemberStatus(admin, owner, ownerId, "disabled"),
        (e) => e instanceof OrganizationAdministrationError && e.code === "ORG_ADMIN_SELF_TARGET",
        "an admin cannot disable their own membership through this path",
      );

      const result = await setMemberStatus(admin, owner, memberId, "disabled");
      assert.equal(result.status, "disabled");
      const membership = await admin.query(`SELECT status FROM organization_memberships WHERE organization_id=$1 AND user_id=$2`, [orgId, memberId]);
      assert.equal(membership.rows[0].status, "disabled");
      const sessionAfter = await admin.query(`SELECT revoked_at FROM sessions WHERE id=$1`, [memberSession.sessionId]);
      assert.ok(sessionAfter.rows[0].revoked_at, "disabling membership must revoke the member's live session, not leave it usable");

      await setMemberStatus(admin, owner, memberId, "active");
    });
  } finally {
    await admin.query(`DELETE FROM membership_company_access WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM membership_branch_access WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM sessions WHERE user_id = ANY($1)`, [[ownerId, memberId]]).catch(() => undefined);
    await admin.query(`DELETE FROM organization_memberships WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM branches WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM companies WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM users WHERE id = ANY($1)`, [[ownerId, memberId]]).catch(() => undefined);
    await admin.end();
  }
});
