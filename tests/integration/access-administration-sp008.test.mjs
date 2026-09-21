// Real PostgreSQL integration test — SP008 (role creation/editing/
// permission assignment/role assignment to users/removal/validation/
// reserved-system-role protection/privilege-escalation prevention). Before
// this pass, roles.manage/roles.assign existed only as permission KEYS in
// the catalog and as UNUSED validation helpers (validateRoleSelection,
// recordRoleSnapshot) in access-administration.js -- there was no actual
// createRole/updateRole/archiveRole/setUserRoles mutation, so a role could
// only ever be listed, never created or edited, despite the Settings UI's
// own disclosed placeholder text saying so explicitly. This proves the new
// mutation entry points against a real database, including the two
// specific classes of misuse SP008 requires be prevented: a caller
// escalating privilege by defining/editing a role with permissions they
// don't personally hold (grant-ceiling), and a caller editing or removing
// a reserved system role (organization_owner/system_administrator/etc.).
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";
import {
  createRole,
  updateRole,
  archiveRole,
  setUserRoles,
  listOrganizationRolesDetailed,
  AccessAdministrationError,
} from "../../services/api/src/core/access-administration.js";
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

test("SP008: role CRUD and role assignment against a real database", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const orgId = randomUUID();
  const ownerId = randomUUID();
  const memberId = randomUUID();
  const restrictedAdminId = randomUUID();
  const ownerRoleId = randomUUID();
  const restrictedRoleId = randomUUID();

  try {
    // --- Fixture: one organization, an organization_owner, a plain
    // member (target of role assignment), and a "restricted admin" who
    // holds roles.manage/roles.assign but only a small permission subset
    // (used to prove grant-ceiling enforcement on role DEFINITION, not
    // just assignment).
    await admin.query(
      `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES
         ($1,$2,'SP008 Owner','x','active',now()),
         ($3,$4,'SP008 Member','x','active',now()),
         ($5,$6,'SP008 Restricted Admin','x','active',now())`,
      [ownerId, `sp008-owner-${ownerId}@test.invalid`, memberId, `sp008-member-${memberId}@test.invalid`, restrictedAdminId, `sp008-restricted-${restrictedAdminId}@test.invalid`],
    );
    await admin.query(
      `INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'SP008 Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `sp008-org-${orgId}`, ownerId],
    );
    await admin.query(
      `INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES
         ($1,$2,'owner','active'),($1,$3,'member','active'),($1,$4,'member','active')`,
      [orgId, ownerId, memberId, restrictedAdminId],
    );
    await admin.query(
      `INSERT INTO organization_modules(organization_id,module_key,name,status,enabled_at) VALUES ($1,'sales','Sales','enabled',now()) ON CONFLICT (organization_id,module_key) DO NOTHING`,
      [orgId],
    );
    await admin.query(
      `INSERT INTO roles(id,organization_id,name,slug,description,is_system,status,module_key,assignable,risk_level,version) VALUES
         ($1,$2,'Organization Owner','organization_owner','',true,'active','platform',true,'privileged',1),
         ($3,$2,'Restricted Admin','restricted_admin','',false,'active','platform',true,'standard',1)`,
      [ownerRoleId, orgId, restrictedRoleId],
    );
    await admin.query(
      `INSERT INTO role_permissions(role_id,permission_key) SELECT $1, unnest($2::text[])`,
      [ownerRoleId, ALL_PERMISSIONS],
    );
    await admin.query(`INSERT INTO role_permissions(role_id,permission_key) VALUES ($1,'roles.manage'),($1,'roles.assign'),($1,'roles.view'),($1,'users.view')`, [restrictedRoleId]);
    await admin.query(
      `INSERT INTO user_role_assignments(organization_id,user_id,role_id,is_primary,status) VALUES
         ($1,$2,$3,true,'active'),($1,$4,$5,true,'active')`,
      [orgId, ownerId, ownerRoleId, restrictedAdminId, restrictedRoleId],
    );

    const ownerSession = { organizationId: orgId, userId: ownerId, roleSlugs: ["organization_owner"], permissions: [...ALL_PERMISSIONS] };
    const restrictedSession = { organizationId: orgId, userId: restrictedAdminId, roleSlugs: ["restricted_admin"], permissions: ["roles.manage", "roles.assign", "roles.view", "users.view"] };

    let customRoleId;

    await t.test("createRole: an organization_owner can define a custom role with a real permission set", async () => {
      const role = await createRole(admin, ownerSession, {
        name: "Sales Coordinator",
        description: "Read-only sales visibility.",
        moduleKey: "sales",
        riskLevel: "standard",
        permissionKeys: ["sales.order.create", "workspace.view"],
      });
      customRoleId = role.id;
      assert.equal(role.name, "Sales Coordinator");
      assert.equal(role.slug, "sales_coordinator");
      assert.equal(role.is_system, false);
      assert.equal(role.version, 1);

      const detail = await listOrganizationRolesDetailed(admin, ownerSession);
      const found = detail.find((r) => r.id === customRoleId);
      assert.deepEqual([...found.permission_keys].sort(), ["sales.order.create", "workspace.view"]);

      const snapshot = await admin.query("SELECT version, reason FROM role_version_snapshots WHERE role_id = $1", [customRoleId]);
      assert.equal(snapshot.rows.length, 1, "role creation must leave an append-only audit snapshot");
      assert.equal(snapshot.rows[0].reason, "Role created");

      const auditRow = await admin.query("SELECT event_type FROM audit_events WHERE entity_type = 'role' AND entity_id = $1", [customRoleId]);
      assert.equal(auditRow.rows[0]?.event_type, "role.created");
    });

    await t.test("createRole: rejects an unknown permission key", async () => {
      await assert.rejects(
        () => createRole(admin, ownerSession, { name: "Bad Role", permissionKeys: ["not.a.real.permission"] }),
        (error) => error instanceof AccessAdministrationError && error.status === 422,
      );
    });

    await t.test("createRole: PRIVILEGE ESCALATION PREVENTION -- a restricted admin cannot define a role with a permission they do not themselves hold", async () => {
      await assert.rejects(
        () => createRole(admin, restrictedSession, { name: "Escalated Role", permissionKeys: ["organization.manage"] }),
        (error) => error instanceof AccessAdministrationError && error.status === 403 && error.code === "ACCESS_ADMIN_GRANT_CEILING",
        "a caller holding only roles.manage/roles.assign/roles.view/users.view must never be able to grant organization.manage to a role they define",
      );
    });

    await t.test("createRole: a blocking separation-of-duties conflict is rejected even for an organization_owner", async () => {
      await assert.rejects(
        () => createRole(admin, ownerSession, { name: "Journal Everything", permissionKeys: ["accounting.journal.create", "accounting.journal.approve"] }),
        (error) => error instanceof AccessAdministrationError && error.status === 409 && error.code === "ACCESS_ADMIN_SOD_BLOCKING",
      );
    });

    await t.test("updateRole: editing name/permissions increments version and leaves a new snapshot", async () => {
      const updated = await updateRole(admin, ownerSession, customRoleId, {
        name: "Sales Coordinator (Updated)",
        permissionKeys: ["sales.order.create"],
      });
      assert.equal(updated.name, "Sales Coordinator (Updated)");
      assert.equal(updated.version, 2);
      const perms = await admin.query("SELECT permission_key FROM role_permissions WHERE role_id = $1", [customRoleId]);
      assert.deepEqual(perms.rows.map((r) => r.permission_key), ["sales.order.create"]);
      const snapshots = await admin.query("SELECT version FROM role_version_snapshots WHERE role_id = $1 ORDER BY version", [customRoleId]);
      assert.deepEqual(snapshots.rows.map((r) => r.version), [1, 2]);
    });

    await t.test("updateRole: RESERVED-SYSTEM-ROLE PROTECTION -- a system role cannot be edited, even by an organization_owner", async () => {
      await assert.rejects(
        () => updateRole(admin, ownerSession, ownerRoleId, { name: "Hacked Owner" }),
        (error) => error instanceof AccessAdministrationError && error.status === 403 && error.code === "ACCESS_ADMIN_SYSTEM_ROLE_PROTECTED",
      );
    });

    await t.test("archiveRole: RESERVED-SYSTEM-ROLE PROTECTION -- a system role cannot be archived", async () => {
      await assert.rejects(
        () => archiveRole(admin, ownerSession, ownerRoleId),
        (error) => error instanceof AccessAdministrationError && error.status === 403 && error.code === "ACCESS_ADMIN_SYSTEM_ROLE_PROTECTED",
      );
    });

    await t.test("setUserRoles: assigns a custom role to a member and it appears in their access state", async () => {
      const state = await setUserRoles(admin, ownerSession, {
        targetUserId: memberId,
        roleIds: [customRoleId],
        primaryRoleId: customRoleId,
      });
      assert.equal(state.roles.length, 1);
      assert.equal(state.roles[0].role_id, customRoleId);
    });

    await t.test("archiveRole: VALIDATION -- a role that is still assigned to a user cannot be removed", async () => {
      await assert.rejects(
        () => archiveRole(admin, ownerSession, customRoleId),
        (error) => error instanceof AccessAdministrationError && error.status === 409 && error.code === "ACCESS_ADMIN_ROLE_IN_USE",
      );
    });

    await t.test("setUserRoles: reassigning the member to a different role frees the previous one, then archiveRole succeeds", async () => {
      // validateRoleSelection requires at least one role and a primary
      // among them (an empty set is rejected by design) -- "remove" a
      // custom role the same way a real admin would: reassign the member
      // to a different role instead of assigning an empty set.
      const secondRoleId = randomUUID();
      await admin.query(
        `INSERT INTO roles(id,organization_id,name,slug,is_system,status,module_key,assignable,risk_level,version) VALUES ($1,$2,'Viewer','viewer',false,'active','platform',true,'standard',1)`,
        [secondRoleId, orgId],
      );
      await admin.query(`INSERT INTO role_permissions(role_id,permission_key) VALUES ($1,'workspace.view')`, [secondRoleId]);
      await setUserRoles(admin, ownerSession, { targetUserId: memberId, roleIds: [secondRoleId], primaryRoleId: secondRoleId });

      const revoked = await admin.query(
        "SELECT status FROM user_role_assignments WHERE organization_id=$1 AND user_id=$2 AND role_id=$3",
        [orgId, memberId, customRoleId],
      );
      assert.equal(revoked.rows[0]?.status, "revoked", "the previously-assigned custom role must be revoked, not left dangling, once replaced");

      await archiveRole(admin, ownerSession, customRoleId);
      const archived = await admin.query("SELECT status FROM roles WHERE id = $1", [customRoleId]);
      assert.equal(archived.rows[0]?.status, "inactive");

      await admin.query("DELETE FROM user_role_assignments WHERE role_id=$1", [secondRoleId]).catch(() => undefined);
      await admin.query("DELETE FROM role_permissions WHERE role_id=$1", [secondRoleId]).catch(() => undefined);
      await admin.query("DELETE FROM role_version_snapshots WHERE role_id=$1", [secondRoleId]).catch(() => undefined);
      await admin.query("DELETE FROM roles WHERE id=$1", [secondRoleId]).catch(() => undefined);
    });

    await t.test("setUserRoles: assigning the organization_owner role must use the controlled ownership-transfer flow, not this generic path", async () => {
      await assert.rejects(
        () => setUserRoles(admin, ownerSession, { targetUserId: memberId, roleIds: [ownerRoleId], primaryRoleId: ownerRoleId }),
        (error) => error.status === 403,
      );
    });
  } finally {
    await admin.query("DELETE FROM audit_events WHERE organization_id=$1", [orgId]).catch(() => undefined);
    await admin.query("DELETE FROM role_version_snapshots WHERE organization_id=$1", [orgId]).catch(() => undefined);
    await admin.query("DELETE FROM user_role_assignments WHERE organization_id=$1", [orgId]).catch(() => undefined);
    await admin.query("DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE organization_id=$1)", [orgId]).catch(() => undefined);
    await admin.query("DELETE FROM roles WHERE organization_id=$1", [orgId]).catch(() => undefined);
    await admin.query("DELETE FROM organization_memberships WHERE organization_id=$1", [orgId]).catch(() => undefined);
    await admin.query("DELETE FROM organizations WHERE id=$1", [orgId]).catch(() => undefined);
    await admin.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[ownerId, memberId, restrictedAdminId]]).catch(() => undefined);
    await admin.end();
  }
});
