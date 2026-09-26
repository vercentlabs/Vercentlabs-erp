// Shared Access administration against a real PostgreSQL database (run by
// `pnpm test:access:db`, which fails rather than skips without a database).
//
// Every test runs inside ONE migration-role transaction that is rolled back;
// domain calls run under `SET LOCAL ROLE <runtime role>` (NOBYPASSRLS) so the
// restricted runtime grants are exercised too. Expected denials run inside a
// SAVEPOINT so a failed statement never poisons the rest of the test.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { Client } from "pg";

import { ALL_PERMISSIONS, COMPANY_ADMINISTRATOR_PERMISSIONS, ROLE_TEMPLATES } from "../../../packages/permissions/src/index.js";
import { listSyncMigrations, MIGRATIONS_DIR } from "../../../scripts/database/generate-canonical-role-sync-migration.mjs";
import {
  archiveRole,
  createRole,
  listGrantableRolesForActor,
  listGrantableScope,
  setUserAccessScope,
  setUserRoles,
  updateRole,
} from "../../../services/api/src/core/access-administration.js";
import { authorize, buildWorkspaceAccessSnapshot } from "../../../services/api/src/core/access/index.js";
import {
  acceptOrganizationInvitation,
  createOrganizationInvitation,
  listOrganizationInvitations,
  resendOrganizationInvitation,
  revokeOrganizationInvitation,
} from "../../../services/api/src/core/auth-lifecycle.js";
import {
  createBranch,
  createCompany,
  listOrganizationBranches,
  listOrganizationCompanies,
  listOrganizationMembers,
  setMemberStatus,
  updateBranch,
  updateCompany,
} from "../../../services/api/src/core/organization-administration.js";
import { bootstrapOrganizationRoles } from "../../../services/api/src/core/organization-registration.js";
import { listModuleAdministration, setOrganizationModuleEnabled } from "../../../services/api/src/core/platform/module-administration.js";
import { tokenHash } from "../../../services/api/src/core/session.js";

const migrationUrl = process.env.MIGRATION_DATABASE_URL || "";
const runtimeUrl = process.env.DATABASE_URL || "";
const runtimeRole = runtimeUrl ? decodeURIComponent(new URL(runtimeUrl).username) : "";
const ENV = { NODE_ENV: "test", BILLING_ENFORCEMENT_MODE: "enforce", AUTH_EMAIL_WEBHOOK_URL: "" };
const BUSINESS_PREFIXES = ["crm.", "sales.", "accounting.", "procurement.", "stock.", "manufacturing.", "projects.", "assets.", "pos.", "quality.", "support.", "hr_payroll.", "billing."];

async function withRolledBackDatabase(work) {
  assert.ok(migrationUrl, "MIGRATION_DATABASE_URL is required — test:access:db needs a real database.");
  assert.ok(runtimeRole, "DATABASE_URL (restricted runtime role) is required.");
  const db = new Client({ connectionString: migrationUrl, application_name: "vercentlabs-access-admin-tests" });
  await db.connect();
  try {
    await db.query("BEGIN");
    await work(db);
  } finally {
    await db.query("ROLLBACK").catch(() => undefined);
    await db.end();
  }
}

// Run domain code as the restricted runtime role, under the organisation
// context the web layer would set from the actor's session (platform tables
// are organisation-RLS protected). Seeding a world makes it the active one;
// pass { organizationId: null } for pre-organisation flows (invitation
// acceptance by token), which must resolve their organisation themselves.
let activeOrganizationId = null;
async function asRuntime(db, work, { organizationId = activeOrganizationId } = {}) {
  await db.query(`SET LOCAL ROLE "${runtimeRole.replaceAll('"', '""')}"`);
  await db.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId ?? ""]);
  try {
    return await work();
  } finally {
    await db.query("SELECT set_config('app.current_organization_id', '', true)").catch(() => undefined);
    await db.query("RESET ROLE").catch(() => undefined);
  }
}

// Expected denial, isolated in a savepoint. Returns the error.
async function denied(db, work, matcher, options) {
  await db.query("SAVEPOINT expected_denial");
  let caught;
  try {
    await asRuntime(db, work, options);
  } catch (error) {
    caught = error;
  }
  await db.query("ROLLBACK TO SAVEPOINT expected_denial");
  assert.ok(caught, "expected the operation to be denied");
  if (matcher) assert.ok(matcher(caught), `unexpected error: ${caught?.status} ${caught?.code} ${caught?.message}`);
  return caught;
}

const forbidden = (error) => error.status === 403;
const notFound = (error) => error.status === 404;

async function insertUser(db, label) {
  const id = randomUUID();
  await db.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES ($1, $2, $3, 'not-a-real-hash', 'active', now())`,
    [id, `${label}-${id}@test.invalid`, label],
  );
  return id;
}

async function seedWorld(db) {
  const ownerId = await insertUser(db, "Owner");
  const organizationId = randomUUID();
  activeOrganizationId = organizationId;
  await db.query(
    `INSERT INTO organizations (id, name, slug, country_code, timezone, base_currency, created_by) VALUES ($1, 'Access Admin Org', $2, 'IN', 'Asia/Kolkata', 'INR', $3)`,
    [organizationId, `access-admin-${organizationId}`, ownerId],
  );
  // Seat enforcement is exercised by billing-seats.test.mjs; this fixture
  // needs room for its members and invitations.
  await db.query(`UPDATE organization_subscriptions SET paid_seats = 100 WHERE organization_id = $1`, [organizationId]);
  const roles = await bootstrapOrganizationRoles(db, organizationId);
  const company = async (code) => {
    const id = randomUUID();
    await db.query(
      `INSERT INTO companies (id, organization_id, name, legal_name, country_code, base_currency, is_primary, code) VALUES ($1, $2, $3, $3, 'IN', 'INR', $4, $5)`,
      [id, organizationId, `Company ${code}`, code === "A", code],
    );
    return id;
  };
  const branch = async (companyId, code) => {
    const id = randomUUID();
    await db.query(`INSERT INTO branches (id, organization_id, company_id, name, code, timezone) VALUES ($1, $2, $3, $4, $4, 'Asia/Kolkata')`, [id, organizationId, companyId, code]);
    return id;
  };
  const A = await company("A");
  const B = await company("B");
  const A1 = await branch(A, "A1");
  const A2 = await branch(A, "A2");
  const B1 = await branch(B, "B1");

  const member = async (label, slugs, companies, branches) => {
    const id = await insertUser(db, label);
    await db.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [organizationId, id]);
    for (const [index, slug] of slugs.entries()) {
      await db.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) VALUES ($1, $2, $3, $4, 'active')`, [organizationId, id, roles.get(slug), index === 0]);
    }
    for (const companyId of companies) await db.query(`INSERT INTO membership_company_access (organization_id, user_id, company_id) VALUES ($1, $2, $3)`, [organizationId, id, companyId]);
    for (const branchId of branches) await db.query(`INSERT INTO membership_branch_access (organization_id, user_id, branch_id) VALUES ($1, $2, $3)`, [organizationId, id, branchId]);
    return id;
  };
  await db.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`, [organizationId, ownerId]);
  await db.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) VALUES ($1, $2, $3, true, 'active')`, [organizationId, ownerId, roles.get("organization_owner")]);

  const adminA = await member("CompanyAdminA", ["company_administrator"], [A], [A1, A2]);
  const userA = await member("UserA", ["employee"], [A], [A1]);
  const userB = await member("UserB", ["employee"], [B], [B1]);
  const sysAdmin = await member("SysAdmin", ["system_administrator"], [A], [A1]);

  const permissionsOf = (slug) => [...ROLE_TEMPLATES.find((role) => role.slug === slug).permissions];
  const session = (userId, slugs) => ({
    organizationId,
    userId,
    roleSlugs: slugs,
    permissions: [...new Set(slugs.flatMap(permissionsOf))],
    activeCompanyId: A,
    activeBranchId: A1,
    emailVerified: true,
  });
  return {
    organizationId,
    roles,
    ownerId,
    ids: { A, B, A1, A2, B1, adminA, userA, userB, sysAdmin },
    owner: session(ownerId, ["organization_owner"]),
    sysAdminSession: session(sysAdmin, ["system_administrator"]),
    adminASession: session(adminA, ["company_administrator"]),
    member,
  };
}

async function inviteWithToken(db, input) {
  const { invitationId } = await createOrganizationInvitation(db, input, ENV);
  const token = `test-token-${randomUUID()}-${randomUUID()}`.replaceAll("-", "");
  await db.query(`UPDATE organization_invitations SET token_hash = $2 WHERE id = $1`, [invitationId, tokenHash(token)]);
  return { invitationId, token };
}

const ownerInviter = (world) => ({ organizationId: world.organizationId, invitedByUserId: world.ownerId, inviter: { roleSlugs: world.owner.roleSlugs, permissions: world.owner.permissions } });
const adminInviter = (world) => ({
  organizationId: world.organizationId,
  invitedByUserId: world.ids.adminA,
  inviter: { roleSlugs: world.adminASession.roleSlugs, permissions: world.adminASession.permissions },
});

test("delegated administration: Company Administrator A reads and writes only inside Company A", async () => {
  await withRolledBackDatabase(async (db) => {
    const world = await seedWorld(db);
    const { A, B, A1, A2, B1, userA, userB, sysAdmin } = world.ids;
    const admin = world.adminASession;

    const invA = await inviteWithToken(db, { ...ownerInviter(world), email: `inv-a-${randomUUID()}@test.invalid`, roleIds: [world.roles.get("employee")], primaryRoleId: world.roles.get("employee"), companyIds: [A], branchIds: [A1] });
    const invB = await inviteWithToken(db, { ...ownerInviter(world), email: `inv-b-${randomUUID()}@test.invalid`, roleIds: [world.roles.get("employee")], primaryRoleId: world.roles.get("employee"), companyIds: [B], branchIds: [B1] });

    await asRuntime(db, async () => {
      // --- Reads -----------------------------------------------------------
      assert.deepEqual((await listOrganizationCompanies(db, admin)).map((row) => row.id), [A]);
      assert.deepEqual((await listOrganizationBranches(db, admin)).map((row) => row.id).sort(), [A1, A2].sort());
      const members = (await listOrganizationMembers(db, admin)).map((row) => row.user_id);
      assert.ok(members.includes(userA), "sees User A");
      for (const hidden of [userB, sysAdmin, world.ownerId]) assert.ok(!members.includes(hidden), "does not see out-of-scope or unrestricted members");
      const invitations = (await listOrganizationInvitations(db, world.organizationId, { userId: admin.userId, roleSlugs: admin.roleSlugs })).map((row) => row.id);
      assert.deepEqual(invitations, [invA.invitationId]);
      const scope = await listGrantableScope(db, admin);
      assert.deepEqual(scope.companies.map((company) => company.id), [A]);
      assert.deepEqual(scope.companies[0].branches.map((branch) => branch.id).sort(), [A1, A2].sort());

      // Owner sees everything, and IDs come back directly (never names).
      const ownerMembers = await listOrganizationMembers(db, world.owner);
      const userARow = ownerMembers.find((row) => row.user_id === userA);
      assert.deepEqual(userARow.company_ids, [A]);
      assert.deepEqual(userARow.branch_ids, [A1]);
      assert.equal(ownerMembers.length, 5);

      // --- Writes inside scope ---------------------------------------------
      const updated = await setUserAccessScope(db, admin, userA, { companyIds: [A], branchIds: [A1, A2] });
      assert.deepEqual(updated.branchIds.sort(), [A1, A2].sort());
      const evidence = await db.query(`SELECT event_type, before_state, after_state FROM access_assignment_events WHERE organization_id = $1 AND user_id = $2`, [world.organizationId, userA]);
      assert.equal(evidence.rows.length, 1);
      assert.equal(evidence.rows[0].event_type, "access_scope_changed");
      assert.deepEqual(evidence.rows[0].before_state.branchIds, [A1]);
      // An unchanged save writes no evidence (and touches no rows).
      await setUserAccessScope(db, admin, userA, { companyIds: [A], branchIds: [A1, A2] });
      assert.equal((await db.query(`SELECT count(*)::int AS n FROM access_assignment_events WHERE user_id = $1`, [userA])).rows[0].n, 1);

      const branch = await createBranch(db, admin, { companyId: A, name: "A3", code: `A3${Date.now() % 100000}`, timezone: "Asia/Kolkata" });
      const granted = await db.query(`SELECT 1 FROM membership_branch_access WHERE user_id = $1 AND branch_id = $2`, [admin.userId, branch.id]);
      assert.equal(granted.rows.length, 1, "creator is granted the branch they created");
      const updatedCompany = await updateCompany(db, admin, A, { name: "Company A renamed" });
      assert.equal(updatedCompany.name, "Company A renamed");
    });

    // --- Writes outside scope ------------------------------------------------
    await denied(db, () => setUserAccessScope(db, admin, userB, { companyIds: [A], branchIds: [] }), forbidden);
    await denied(db, () => setUserAccessScope(db, admin, userA, { companyIds: [A, B], branchIds: [] }), forbidden);
    await denied(db, () => setUserAccessScope(db, admin, userA, { companyIds: [A, B], branchIds: [B1] }), forbidden);
    await denied(db, () => setUserAccessScope(db, admin, userA, { companyIds: [A], branchIds: [B1] }), (error) => error.status === 422 || error.status === 403);
    await denied(db, () => setUserAccessScope(db, admin, sysAdmin, { companyIds: [A], branchIds: [] }), forbidden);
    await denied(db, () => setMemberStatus(db, admin, userB, "disabled"), forbidden);
    await denied(db, () => updateCompany(db, admin, B, { name: "Hijacked" }), notFound);
    await denied(db, () => updateBranch(db, admin, B1, { name: "Hijacked" }), notFound);
    await denied(db, () => createBranch(db, admin, { companyId: B, name: "B2", code: "B2X", timezone: "Asia/Kolkata" }), notFound);
    await denied(db, () => createCompany(db, admin, { name: "New Co", legalName: "New Co", code: "NEWCO", countryCode: "IN", baseCurrency: "INR" }), forbidden);
    await denied(db, () => revokeOrganizationInvitation(db, { organizationId: world.organizationId, invitationId: invB.invitationId, actor: { userId: admin.userId, roleSlugs: admin.roleSlugs } }), forbidden);
    await denied(db, () => resendOrganizationInvitation(db, { organizationId: world.organizationId, invitationId: invB.invitationId, actor: { userId: admin.userId, roleSlugs: admin.roleSlugs } }, ENV), forbidden);

    // --- Role security -----------------------------------------------------
    const role = (slug) => world.roles.get(slug);
    for (const slug of ["finance_manager", "hr_manager", "sales_head", "system_administrator"]) {
      await denied(db, () => setUserRoles(db, admin, { targetUserId: userA, roleIds: [role(slug)], primaryRoleId: role(slug) }), forbidden);
    }
    await denied(db, () => setUserRoles(db, admin, { targetUserId: userA, roleIds: [role("organization_owner")], primaryRoleId: role("organization_owner") }), forbidden);
    await denied(db, () => createRole(db, admin, { name: "Sneaky", permissionKeys: ["users.view"] }), forbidden);
    const custom = await asRuntime(db, () => createRole(db, world.owner, { name: "Custom Viewer", permissionKeys: ["users.view"] }));
    await denied(db, () => updateRole(db, admin, custom.id, { permissionKeys: ["users.view", "roles.view"] }), forbidden);
    await denied(db, () => archiveRole(db, admin, custom.id), forbidden);

    const grantable = await asRuntime(db, () => listGrantableRolesForActor(db, admin));
    const bySlug = new Map(grantable.map((entry) => [entry.slug, entry]));
    assert.equal(bySlug.get("organization_owner").grantable, false);
    assert.equal(bySlug.get("system_administrator").reason, "exceeds_your_access");
    assert.equal(bySlug.get("finance_manager").reason, "exceeds_your_access");
    assert.equal(bySlug.get("company_administrator").grantable, true, "may delegate its own authority");

    // Composition: Company Administrator + Sales Head may assign Sales roles.
    const composed = { ...admin, roleSlugs: ["company_administrator", "sales_head"], permissions: [...new Set([...COMPANY_ADMINISTRATOR_PERMISSIONS, ...ROLE_TEMPLATES.find((entry) => entry.slug === "sales_head").permissions])] };
    await asRuntime(db, () => setUserRoles(db, composed, { targetUserId: userA, roleIds: [role("sales_manager")], primaryRoleId: role("sales_manager") }));
    // ...but still nothing beyond its combined authority.
    await denied(db, () => setUserRoles(db, composed, { targetUserId: userA, roleIds: [role("sales_representative")], primaryRoleId: role("sales_representative") }), forbidden);
    const roleEvidence = await db.query(`SELECT event_type FROM access_assignment_events WHERE user_id = $1 AND event_type = 'roles_changed'`, [userA]);
    assert.equal(roleEvidence.rows.length, 1);

    // System Administrator: organisation-wide administration.
    await asRuntime(db, async () => {
      await setMemberStatus(db, world.sysAdminSession, userB, "disabled");
      const status = await db.query(`SELECT status FROM organization_memberships WHERE user_id = $1`, [userB]);
      assert.equal(status.rows[0].status, "disabled");
      const revoked = await db.query(`SELECT event_type, after_state FROM access_assignment_events WHERE user_id = $1`, [userB]);
      assert.equal(revoked.rows[0].event_type, "member_disabled");
    });
  });
});

test("cross-tenant: organization A administrators can neither see nor change organization B", async () => {
  await withRolledBackDatabase(async (db) => {
    const one = await seedWorld(db);
    const two = await seedWorld(db);
    activeOrganizationId = one.organizationId;
    await asRuntime(db, async () => {
      const members = (await listOrganizationMembers(db, one.owner)).map((row) => row.user_id);
      assert.ok(!members.includes(two.ids.userA));
      assert.ok(!(await listOrganizationCompanies(db, one.owner)).some((row) => row.id === two.ids.A));
    });
    await denied(db, () => setUserAccessScope(db, one.owner, two.ids.userA, { companyIds: [], branchIds: [] }), notFound);
    await denied(db, () => setUserAccessScope(db, one.owner, one.ids.userA, { companyIds: [two.ids.A], branchIds: [] }), (error) => error.status === 422);
    await denied(db, () => updateCompany(db, one.owner, two.ids.A, { name: "x" }), notFound);
    await denied(db, () => setMemberStatus(db, one.owner, two.ids.userA, "disabled"), notFound);
    await denied(db, () => revokeOrganizationInvitation(db, { organizationId: one.organizationId, invitationId: randomUUID(), actor: { userId: one.ownerId, roleSlugs: one.owner.roleSlugs } }), (error) => error.status === 409);
  });
});

test("invitations: normalized multi-role access, delegated scope, acceptance and lifecycle", async () => {
  await withRolledBackDatabase(async (db) => {
    const world = await seedWorld(db);
    const { A, B, A1, B1, userA } = world.ids;
    const role = (slug) => world.roles.get(slug);

    // Legacy backfill: a row written by the pre-normalization code (legacy
    // columns only) is backfilled by migration 060's SQL.
    const legacyId = randomUUID();
    await db.query(
      `INSERT INTO organization_invitations (id, organization_id, email, role, role_id, company_ids, branch_ids, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, 'member', $4, $5, $6, $7, $8, now() + interval '7 days')`,
      [legacyId, world.organizationId, `legacy-${legacyId}@test.invalid`, role("employee"), [A], [A1], `legacy-${legacyId}`, world.ownerId],
    );
    const backfill = fs.readFileSync(path.join(MIGRATIONS_DIR, "060_invitation_access_normalization.sql"), "utf8").replace(/^BEGIN;|^COMMIT;/gm, "");
    await db.query(backfill);
    assert.deepEqual((await db.query(`SELECT role_id, is_primary FROM organization_invitation_roles WHERE invitation_id = $1`, [legacyId])).rows, [{ role_id: role("employee"), is_primary: true }]);
    assert.deepEqual((await db.query(`SELECT company_id FROM organization_invitation_company_access WHERE invitation_id = $1`, [legacyId])).rows.map((row) => row.company_id), [A]);
    assert.deepEqual((await db.query(`SELECT branch_id FROM organization_invitation_branch_access WHERE invitation_id = $1`, [legacyId])).rows.map((row) => row.branch_id), [A1]);

    // Multiple roles, exactly one primary, company/branch scope.
    const email = `multi-${randomUUID()}@test.invalid`;
    const multi = await asRuntime(db, () =>
      inviteWithToken(db, { ...ownerInviter(world), email, roleIds: [role("sales_representative"), role("marketing_manager")], primaryRoleId: role("sales_representative"), companyIds: [A], branchIds: [A1] }),
    );
    const stored = await db.query(`SELECT role_id, is_primary FROM organization_invitation_roles WHERE invitation_id = $1 ORDER BY is_primary DESC`, [multi.invitationId]);
    assert.equal(stored.rows.length, 2);
    assert.equal(stored.rows.filter((row) => row.is_primary).length, 1);
    assert.equal(stored.rows[0].role_id, role("sales_representative"));
    const legacyMirror = (await db.query(`SELECT role_id FROM organization_invitations WHERE id = $1`, [multi.invitationId])).rows[0];
    assert.equal(legacyMirror.role_id, null, "the deprecated legacy mirror is no longer written (contract migration drops it)");

    // Departments and teams: normalized, validated against the organisation
    // and the rest of the selection, and applied on acceptance.
    const department = async (companyId, code) => {
      const id = randomUUID();
      await db.query(`INSERT INTO departments (id, organization_id, company_id, name, code, status) VALUES ($1, $2, $3, $4, $4, 'active')`, [id, world.organizationId, companyId, code]);
      return id;
    };
    const team = async (departmentId, code) => {
      const id = randomUUID();
      await db.query(`INSERT INTO teams (id, organization_id, department_id, name, code, status) VALUES ($1, $2, $3, $4, $4, 'active')`, [id, world.organizationId, departmentId, code]);
      return id;
    };
    const salesA = await department(A, "SALES-A");
    const salesB = await department(B, "SALES-B");
    const fieldTeam = await team(salesA, "FIELD-A");
    const scoped = await asRuntime(db, () =>
      inviteWithToken(db, { ...ownerInviter(world), email: `dept-${randomUUID()}@test.invalid`, roleIds: [role("employee")], primaryRoleId: role("employee"), companyIds: [A], branchIds: [A1], departmentIds: [salesA], teamIds: [fieldTeam] }),
    );
    assert.deepEqual((await db.query(`SELECT department_id FROM organization_invitation_department_access WHERE invitation_id = $1`, [scoped.invitationId])).rows.map((row) => row.department_id), [salesA]);
    assert.deepEqual((await db.query(`SELECT team_id FROM organization_invitation_team_access WHERE invitation_id = $1`, [scoped.invitationId])).rows.map((row) => row.team_id), [fieldTeam]);
    const invite = (extra) => createOrganizationInvitation(db, { ...ownerInviter(world), email: `bad-${randomUUID()}@test.invalid`, roleIds: [role("employee")], primaryRoleId: role("employee"), companyIds: [A], ...extra }, ENV);
    await denied(db, () => invite({ departmentIds: [salesB] }), (error) => error.code === "ACCESS_ADMIN_DEPARTMENT_OUTSIDE_COMPANY");
    await denied(db, () => invite({ teamIds: [fieldTeam] }), (error) => error.code === "ACCESS_ADMIN_TEAM_OUTSIDE_DEPARTMENT");
    await denied(db, () => invite({ departmentIds: [randomUUID()] }), (error) => error.code === "ACCESS_ADMIN_DEPARTMENT_INVALID");
    await denied(db, () => createOrganizationInvitation(db, { ...adminInviter(world), email: `dept-ceiling-${randomUUID()}@test.invalid`, roleIds: [role("employee")], primaryRoleId: role("employee"), companyIds: [A], departmentIds: [salesA] }, ENV), forbidden);
    const joinedScope = await asRuntime(db, () => acceptOrganizationInvitation(db, scoped.token, { fullName: "Dept Person", password: "Correct-Horse-Battery-9!" }, null), { organizationId: null });
    assert.deepEqual((await db.query(`SELECT department_id FROM membership_department_access WHERE user_id = $1`, [joinedScope.userId])).rows.map((row) => row.department_id), [salesA]);
    assert.deepEqual((await db.query(`SELECT team_id FROM membership_team_access WHERE user_id = $1`, [joinedScope.userId])).rows.map((row) => row.team_id), [fieldTeam]);

    // The same rules on direct access administration.
    await asRuntime(db, () => setUserAccessScope(db, world.owner, userA, { companyIds: [A], branchIds: [A1], departmentIds: [salesA], teamIds: [fieldTeam] }));
    assert.deepEqual((await db.query(`SELECT team_id FROM membership_team_access WHERE user_id = $1`, [userA])).rows.map((row) => row.team_id), [fieldTeam]);
    await denied(db, () => setUserAccessScope(db, world.owner, userA, { companyIds: [A], branchIds: [A1], departmentIds: [], teamIds: [fieldTeam] }), (error) => error.code === "ACCESS_ADMIN_TEAM_OUTSIDE_DEPARTMENT");
    await denied(db, () => setUserAccessScope(db, world.owner, userA, { companyIds: [A], branchIds: [A1], departmentIds: [salesB], teamIds: [] }), (error) => error.code === "ACCESS_ADMIN_DEPARTMENT_OUTSIDE_COMPANY");
    await denied(db, () => setUserAccessScope(db, world.owner, userA, { companyIds: [A], branchIds: [A1], departmentIds: [randomUUID()], teamIds: [] }), (error) => error.code === "ACCESS_ADMIN_DEPARTMENT_INVALID");

    // Validation: SoD, grant ceiling, scope ceiling, branch↔company, required scope.
    await denied(db, () => createOrganizationInvitation(db, { ...ownerInviter(world), email: `sod-${randomUUID()}@test.invalid`, roleIds: [role("accountant"), role("finance_manager")], primaryRoleId: role("accountant"), companyIds: [A] }, ENV), (error) => error.status === 409);
    await denied(db, () => createOrganizationInvitation(db, { ...adminInviter(world), email: `ceiling-${randomUUID()}@test.invalid`, roleIds: [role("finance_manager")], primaryRoleId: role("finance_manager"), companyIds: [A] }, ENV), forbidden);
    await denied(db, () => createOrganizationInvitation(db, { ...adminInviter(world), email: `scope-${randomUUID()}@test.invalid`, roleIds: [role("company_administrator")], primaryRoleId: role("company_administrator"), companyIds: [B] }, ENV), forbidden);
    await denied(db, () => createOrganizationInvitation(db, { ...adminInviter(world), email: `noscope-${randomUUID()}@test.invalid`, roleIds: [role("company_administrator")], primaryRoleId: role("company_administrator"), companyIds: [] }, ENV), (error) => error.status === 422);
    await denied(db, () => createOrganizationInvitation(db, { ...ownerInviter(world), email: `branch-${randomUUID()}@test.invalid`, roleIds: [role("employee")], primaryRoleId: role("employee"), companyIds: [A], branchIds: [B1] }, ENV), (error) => error.status === 422);
    await denied(db, () => createOrganizationInvitation(db, { ...ownerInviter(world), email: `owner-${randomUUID()}@test.invalid`, roleIds: [role("organization_owner")], primaryRoleId: role("organization_owner"), companyIds: [A] }, ENV), forbidden);
    // A delegated admin may invite inside their scope with a role they can grant.
    const delegated = await asRuntime(db, () => createOrganizationInvitation(db, { ...adminInviter(world), email: `delegated-${randomUUID()}@test.invalid`, roleIds: [role("company_administrator")], primaryRoleId: role("company_administrator"), companyIds: [A], branchIds: [A1] }, ENV));
    assert.ok(delegated.invitationId);

    // Acceptance assigns every role, one primary, the scope, consumes the
    // invitation and records evidence — as the restricted runtime role.
    const accepted = await asRuntime(db, () => acceptOrganizationInvitation(db, multi.token, { fullName: "Multi Role", password: "Correct-Horse-Battery-9!" }, null), { organizationId: null });
    const assignments = await db.query(`SELECT role_id, is_primary FROM user_role_assignments WHERE organization_id = $1 AND user_id = $2 AND status = 'active'`, [world.organizationId, accepted.userId]);
    assert.deepEqual(assignments.rows.map((row) => row.role_id).sort(), [role("sales_representative"), role("marketing_manager")].sort());
    assert.equal(assignments.rows.filter((row) => row.is_primary).length, 1);
    assert.equal(assignments.rows.find((row) => row.is_primary).role_id, role("sales_representative"));
    assert.deepEqual((await db.query(`SELECT company_id FROM membership_company_access WHERE user_id = $1`, [accepted.userId])).rows.map((row) => row.company_id), [A]);
    assert.deepEqual((await db.query(`SELECT branch_id FROM membership_branch_access WHERE user_id = $1`, [accepted.userId])).rows.map((row) => row.branch_id), [A1]);
    assert.ok((await db.query(`SELECT accepted_at FROM organization_invitations WHERE id = $1`, [multi.invitationId])).rows[0].accepted_at);
    assert.equal((await db.query(`SELECT event_type FROM access_assignment_events WHERE user_id = $1`, [accepted.userId])).rows[0].event_type, "invitation_accepted");

    await denied(db, () => acceptOrganizationInvitation(db, multi.token, { fullName: "Again", password: "Correct-Horse-Battery-9!" }, null), (error) => error.status === 409, { organizationId: null });

    const revoked = await asRuntime(db, () => inviteWithToken(db, { ...ownerInviter(world), email: `revoked-${randomUUID()}@test.invalid`, roleIds: [role("employee")], primaryRoleId: role("employee"), companyIds: [A] }));
    await asRuntime(db, () => revokeOrganizationInvitation(db, { organizationId: world.organizationId, invitationId: revoked.invitationId, actor: { userId: world.ownerId, roleSlugs: world.owner.roleSlugs } }));
    await denied(db, () => acceptOrganizationInvitation(db, revoked.token, { fullName: "R", password: "Correct-Horse-Battery-9!" }, null), (error) => error.status === 410, { organizationId: null });

    const expired = await asRuntime(db, () => inviteWithToken(db, { ...ownerInviter(world), email: `expired-${randomUUID()}@test.invalid`, roleIds: [role("employee")], primaryRoleId: role("employee"), companyIds: [A] }));
    await db.query(`UPDATE organization_invitations SET expires_at = now() - interval '1 minute' WHERE id = $1`, [expired.invitationId]);
    await denied(db, () => acceptOrganizationInvitation(db, expired.token, { fullName: "E", password: "Correct-Horse-Battery-9!" }, null), (error) => error.status === 410, { organizationId: null });

    // Existing account: the link alone never joins it.
    const existingEmail = `existing-${randomUUID()}@test.invalid`;
    const existingId = randomUUID();
    await db.query(`INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES ($1, $2, 'Existing', 'hash', 'active', now())`, [existingId, existingEmail]);
    const forExisting = await asRuntime(db, () => inviteWithToken(db, { ...ownerInviter(world), email: existingEmail, roleIds: [role("employee")], primaryRoleId: role("employee"), companyIds: [A] }));
    await denied(db, () => acceptOrganizationInvitation(db, forExisting.token, { fullName: "x", password: "Correct-Horse-Battery-9!" }, null), (error) => error.status === 401, { organizationId: null });
    const joined = await asRuntime(db, () => acceptOrganizationInvitation(db, forExisting.token, {}, existingId), { organizationId: null });
    assert.equal(joined.mintNewSession, false);
    assert.equal((await db.query(`SELECT password_hash FROM users WHERE id = $1`, [existingId])).rows[0].password_hash, "hash", "password never overwritten");

    // The lazy legacy fallback is gone (every deployed version writes the
    // normalized tables; the contract migration backfills anything older).
    // A legacy-only row is refused, never silently accepted with no access.
    const lateId = randomUUID();
    const lateToken = `late${randomUUID().replaceAll("-", "")}`;
    await db.query(
      `INSERT INTO organization_invitations (id, organization_id, email, role, role_id, company_ids, branch_ids, token_hash, invited_by, expires_at)
       VALUES ($1, $2, $3, 'member', $4, $5, $6, $7, $8, now() + interval '7 days')`,
      [lateId, world.organizationId, `late-${lateId}@test.invalid`, role("employee"), [A], [A1], tokenHash(lateToken), world.ownerId],
    );
    await denied(db, () => acceptOrganizationInvitation(db, lateToken, { fullName: "Late", password: "Correct-Horse-Battery-9!" }, null), (error) => error.status === 409, { organizationId: null });
  });
});

test("module administration: organisation-wide, independent of billing, non-destructive", async () => {
  await withRolledBackDatabase(async (db) => {
    const world = await seedWorld(db);
    const stockUser = await world.member("StockUser", ["inventory_manager"], [world.ids.A], [world.ids.A1]);
    const stockSession = {
      organizationId: world.organizationId,
      userId: stockUser,
      roleSlugs: ["inventory_manager"],
      permissions: [...ROLE_TEMPLATES.find((entry) => entry.slug === "inventory_manager").permissions],
      emailVerified: true,
    };
    // A business-data row that must survive every toggle.
    await db.query(`INSERT INTO tenant.crm_lead_stages (organization_id, code, name) VALUES ($1, 'access_toggle_probe', 'Probe')`, [world.organizationId]);
    const assignmentsBefore = (await db.query(`SELECT count(*)::int AS n FROM user_role_assignments WHERE organization_id = $1 AND status = 'active'`, [world.organizationId])).rows[0].n;
    const snapshot = () => asRuntime(db, () => buildWorkspaceAccessSnapshot(db, stockSession, { env: ENV }));

    assert.equal(authorize({ snapshot: await snapshot(), module: "stock" }).allowed, true);

    const listed = await asRuntime(db, () => listModuleAdministration(db, world.owner, ENV));
    assert.equal(listed.length, 12);
    assert.ok(listed.every((entry) => typeof entry.planIncluded === "boolean" && typeof entry.enabled === "boolean"));

    // Owner disables; the module disappears and direct authorization fails.
    const disabled = await asRuntime(db, () => setOrganizationModuleEnabled(db, world.owner, "stock", false, { env: ENV }));
    assert.equal(disabled.module.enabled, false);
    const afterDisable = await snapshot();
    assert.ok(!afterDisable.accessibleModules.includes("stock"));
    assert.equal(authorize({ snapshot: afterDisable, module: "stock" }).code, "MODULE_DISABLED");
    // Idempotent: a second disable changes nothing and audits nothing new.
    assert.equal((await asRuntime(db, () => setOrganizationModuleEnabled(db, world.owner, "stock", false, { env: ENV }))).changed, false);
    const audits = await db.query(`SELECT event_type, before_data, after_data FROM audit_events WHERE organization_id = $1 AND event_type LIKE 'module.%'`, [world.organizationId]);
    assert.equal(audits.rows.length, 1);
    assert.deepEqual(audits.rows[0].before_data, { moduleKey: "stock", enabled: true });
    assert.deepEqual(audits.rows[0].after_data, { moduleKey: "stock", enabled: false });

    // Plan entitlement does not bypass disabled state (plan includes stock here).
    const plan = (await db.query(`SELECT modules_snapshot FROM organization_subscriptions WHERE organization_id = $1`, [world.organizationId])).rows[0];
    assert.ok(plan, "new organizations are provisioned with a subscription");

    // System Administrator re-enables; eligibility is restored.
    await asRuntime(db, () => setOrganizationModuleEnabled(db, world.sysAdminSession, "stock", true, { env: ENV }));
    assert.equal(authorize({ snapshot: await snapshot(), module: "stock" }).allowed, true);

    // Enablement does not bypass the plan.
    await db.query(`UPDATE organization_subscriptions SET modules_snapshot = $2::jsonb WHERE organization_id = $1`, [world.organizationId, JSON.stringify(["crm", "sales"])]);
    const notEntitled = await snapshot();
    assert.equal(authorize({ snapshot: notEntitled, module: "stock" }).code, "MODULE_NOT_ENTITLED");
    const entry = (await asRuntime(db, () => listModuleAdministration(db, world.owner, ENV))).find((module) => module.key === "stock");
    assert.equal(entry.enabled, true);
    assert.equal(entry.planIncluded, false);
    assert.equal(entry.availableToWorkspace, false);

    // Company Administrator cannot manage modules; unknown modules are refused.
    await denied(db, () => setOrganizationModuleEnabled(db, world.adminASession, "stock", false, { env: ENV }), forbidden);
    await denied(db, () => listModuleAdministration(db, world.adminASession, ENV), forbidden);
    await denied(db, () => setOrganizationModuleEnabled(db, world.owner, "not-a-module", false, { env: ENV }), notFound);

    // Nothing was deleted.
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM user_role_assignments WHERE organization_id = $1 AND status = 'active'`, [world.organizationId])).rows[0].n, assignmentsBefore);
    await db.query(`SELECT set_config('app.current_organization_id', $1, true)`, [world.organizationId]);
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM tenant.crm_lead_stages WHERE organization_id = $1 AND code = 'access_toggle_probe'`, [world.organizationId])).rows[0].n, 1);
  });
});

test("canonical role sync reconciles drifted built-in roles and leaves custom roles untouched", async () => {
  await withRolledBackDatabase(async (db) => {
    const world = await seedWorld(db);
    const roleId = (slug) => world.roles.get(slug);
    // Drift: an old over-privileged Company Administrator, a stripped Sales Head.
    await db.query(`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, 'crm.leads.manage'), ($1, 'modules.manage') ON CONFLICT DO NOTHING`, [roleId("company_administrator")]);
    await db.query(`DELETE FROM role_permissions WHERE role_id = $1 AND permission_key = 'crm.view'`, [roleId("sales_head")]);
    const customId = randomUUID();
    await db.query(`INSERT INTO roles (id, organization_id, name, slug, is_system, module_key) VALUES ($1, $2, 'Custom', 'custom_probe', false, 'platform')`, [customId, world.organizationId]);
    await db.query(`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1, 'crm.leads.manage'), ($1, 'users.view')`, [customId]);
    const assignmentsBefore = (await db.query(`SELECT user_id, role_id, is_primary, status FROM user_role_assignments WHERE organization_id = $1 ORDER BY user_id, role_id`, [world.organizationId])).rows;
    const versionBefore = (await db.query(`SELECT slug, version FROM roles WHERE organization_id = $1`, [world.organizationId])).rows;

    const latest = listSyncMigrations().at(-1);
    const sync = fs.readFileSync(path.join(MIGRATIONS_DIR, latest), "utf8").replace(/^BEGIN;|^COMMIT;/gm, "");
    await db.query(sync);

    const matrix = (await db.query(
      `SELECT role.id, role.slug, role.is_system, COALESCE(array_agg(grant_row.permission_key ORDER BY grant_row.permission_key) FILTER (WHERE grant_row.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
         FROM roles role LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
        WHERE role.organization_id = $1 GROUP BY role.id`,
      [world.organizationId],
    )).rows;
    for (const template of ROLE_TEMPLATES) {
      const row = matrix.find((entry) => entry.slug === template.slug);
      assert.equal(row.id, roleId(template.slug), "role ids are preserved");
      assert.deepEqual(row.permissions, [...template.permissions].sort(), `${template.slug} matches ROLE_TEMPLATES`);
    }
    const companyAdmin = matrix.find((entry) => entry.slug === "company_administrator").permissions;
    assert.deepEqual(companyAdmin.filter((key) => BUSINESS_PREFIXES.some((prefix) => key.startsWith(prefix)) || ["modules.manage", "roles.manage", "organization.manage"].includes(key)), []);
    assert.deepEqual(matrix.find((entry) => entry.slug === "organization_owner").permissions, [...ALL_PERMISSIONS].sort());
    assert.deepEqual(matrix.find((entry) => entry.slug === "system_administrator").permissions, [...ALL_PERMISSIONS].sort());
    assert.deepEqual(matrix.find((entry) => entry.id === customId).permissions, ["crm.leads.manage", "users.view"], "custom roles are never touched");

    const assignmentsAfter = (await db.query(`SELECT user_id, role_id, is_primary, status FROM user_role_assignments WHERE organization_id = $1 ORDER BY user_id, role_id`, [world.organizationId])).rows;
    assert.deepEqual(assignmentsAfter, assignmentsBefore, "assignments are preserved");
    const versionAfter = new Map((await db.query(`SELECT slug, version FROM roles WHERE organization_id = $1`, [world.organizationId])).rows.map((row) => [row.slug, row.version]));
    const before = new Map(versionBefore.map((row) => [row.slug, row.version]));
    assert.equal(versionAfter.get("company_administrator"), before.get("company_administrator") + 1);
    assert.equal(versionAfter.get("sales_head"), before.get("sales_head") + 1);
    assert.equal(versionAfter.get("accountant"), before.get("accountant"), "unchanged roles keep their version");
    const snapshots = await db.query(`SELECT version, reason FROM role_version_snapshots WHERE role_id = $1 ORDER BY version`, [roleId("company_administrator")]);
    assert.deepEqual(snapshots.rows.map((row) => row.reason), ["Before canonical system role synchronization", "Canonical system role synchronization"]);

    // Idempotent: a second run changes nothing. (ON COMMIT DROP temp tables
    // outlive statements inside this single test transaction.)
    await db.query("DROP TABLE canonical_system_roles, canonical_system_role_permissions, canonical_sync_targets, canonical_sync_changed");
    await db.query(sync);
    const versionAgain = new Map((await db.query(`SELECT slug, version FROM roles WHERE organization_id = $1`, [world.organizationId])).rows.map((row) => [row.slug, row.version]));
    assert.deepEqual([...versionAgain.entries()].sort(), [...versionAfter.entries()].sort());
  });
});

test("durable denial evidence is writable by the restricted runtime role and carries only safe fields", async () => {
  const { recordAccessDenial, createAccessPrincipal } = await import("../../../services/api/src/core/access/index.js");
  await withRolledBackDatabase(async (db) => {
    const world = await seedWorld(db);
    // Writing on a separate connection after the request rolled back is
    // workspace-route.ts wiring (withClient) and is proven in
    // secure-route.test.ts; this proves the write itself works under the
    // restricted role.
    const principal = createAccessPrincipal(world.adminASession);
    await asRuntime(db, () =>
      recordAccessDenial(db, {
        decision: { allowed: false, code: "SCOPE_DENIED", status: 403, module: null, permission: "users.manage", action: "settings.user_access.update", reason: null, conceal: false },
        principal,
        env: ENV,
        requestId: "req-denied-1",
      }),
    );
    const rows = await db.query(`SELECT event_type, actor_user_id, metadata FROM audit_events WHERE organization_id = $1 AND event_type = 'access.denied'`, [world.organizationId]);
    assert.equal(rows.rows.length, 1);
    assert.equal(rows.rows[0].actor_user_id, world.ids.adminA);
    assert.equal(rows.rows[0].metadata.action, "settings.user_access.update");
    assert.equal(rows.rows[0].metadata.requestId, "req-denied-1");
    assert.equal(JSON.stringify(rows.rows[0].metadata).includes("password"), false);
  });
});
