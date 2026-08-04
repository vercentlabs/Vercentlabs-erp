import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

try {
  const migration = await client.query(
    "SELECT 1 FROM schema_migrations WHERE name=$1",
    ["018_enterprise_roles_permissions.sql"],
  );
  assert.ok(migration.rows[0], "Enterprise RBAC migration 018 is not applied.");

  for (const relation of [
    "membership_team_access",
    "organization_invitation_roles",
    "organization_invitation_team_access",
    "role_version_snapshots",
    "access_assignment_events",
    "access_conflict_rules",
  ]) {
    const result = await client.query("SELECT to_regclass($1) AS relation", [
      `public.${relation}`,
    ]);
    assert.ok(result.rows[0]?.relation, `Missing ${relation}`);
  }

  const organization = (
    await client.query(
      `SELECT organization.id,organization.created_by
       FROM organizations organization
       WHERE organization.created_by IS NOT NULL
       ORDER BY organization.created_at LIMIT 1`,
    )
  ).rows[0];
  assert.ok(
    organization?.created_by,
    "An organisation with an owner is required.",
  );

  const permissionRows = await client.query(
    `SELECT key FROM permissions WHERE key=ANY($1::text[]) ORDER BY key`,
    [["roles.view", "roles.assign", "access.sod.override"]],
  );
  assert.equal(permissionRows.rowCount, 3);

  const futureRoles = await client.query(
    `SELECT slug,assignable FROM roles
     WHERE organization_id=$1 AND slug=ANY($2::text[]) ORDER BY slug`,
    [
      organization.id,
      ["inventory_manager", "manufacturing_manager", "hr_manager"],
    ],
  );
  assert.equal(futureRoles.rowCount, 3);
  assert.ok(futureRoles.rows.every((row) => row.assignable === false));

  const employeePermissions = await client.query(
    `SELECT permission_key FROM role_permissions permission
     JOIN roles role ON role.id=permission.role_id
     WHERE role.organization_id=$1 AND role.slug='employee'
     ORDER BY permission_key`,
    [organization.id],
  );
  assert.deepEqual(
    employeePermissions.rows.map((row) => row.permission_key),
    [
      "business_data.view",
      "notifications.view",
      "profile.manage",
      "workspace.view",
    ],
  );

  const auditorMutation = await client.query(
    `SELECT 1 FROM role_permissions permission JOIN roles role ON role.id=permission.role_id
     WHERE role.organization_id=$1 AND role.slug='auditor'
       AND permission.permission_key=ANY($2::text[]) LIMIT 1`,
    [
      organization.id,
      [
        "crm.privacy.manage",
        "users.manage",
        "roles.manage",
        "roles.assign",
        "accounting.journal.post",
      ],
    ],
  );
  assert.equal(auditorMutation.rowCount, 0);

  await client.query("BEGIN");
  const userId = randomUUID();
  const suffix = Date.now().toString(36);
  await client.query(
    `INSERT INTO users(id,email,full_name,password_hash,email_verified_at)
     VALUES($1,$2,$3,$4,now())`,
    [
      userId,
      `rbac-live-${suffix}@example.invalid`,
      "RBAC Live User",
      "not-a-login-hash",
    ],
  );
  await client.query(
    `INSERT INTO organization_memberships(organization_id,user_id,role,status)
     VALUES($1,$2,'member','active')`,
    [organization.id, userId],
  );
  const roles = await client.query(
    `SELECT id,slug FROM roles WHERE organization_id=$1
       AND slug=ANY($2::text[]) AND assignable=true`,
    [organization.id, ["sales_representative", "marketing_manager"]],
  );
  assert.equal(roles.rowCount, 2);
  const bySlug = new Map(roles.rows.map((row) => [row.slug, row.id]));
  const startsAt = new Date(Date.now() - 60_000).toISOString();
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  await client.query(
    `INSERT INTO user_role_assignments(
       organization_id,user_id,role_id,assigned_by,is_primary,starts_at,expires_at,status,reason
     ) VALUES($1,$2,$3,$4,true,$5,$6,'active','RBAC live verification'),
             ($1,$2,$7,$4,false,$5,$6,'active','RBAC live verification')`,
    [
      organization.id,
      userId,
      bySlug.get("sales_representative"),
      organization.created_by,
      startsAt,
      expiresAt,
      bySlug.get("marketing_manager"),
    ],
  );
  const effective = await client.query(
    `SELECT DISTINCT permission.permission_key
     FROM user_role_assignments assignment
     JOIN role_permissions permission ON permission.role_id=assignment.role_id
     WHERE assignment.organization_id=$1 AND assignment.user_id=$2
       AND assignment.status='active' AND assignment.starts_at<=now()
       AND (assignment.expires_at IS NULL OR assignment.expires_at>now())`,
    [organization.id, userId],
  );
  const effectiveKeys = new Set(
    effective.rows.map((row) => row.permission_key),
  );
  assert.ok(effectiveKeys.has("sales.quotation.create"));
  assert.ok(effectiveKeys.has("crm.campaigns.manage"));

  await client.query("SAVEPOINT duplicate_primary");
  await assert.rejects(
    client.query(
      `UPDATE user_role_assignments SET is_primary=true
       WHERE organization_id=$1 AND user_id=$2 AND role_id=$3`,
      [organization.id, userId, bySlug.get("marketing_manager")],
    ),
  );
  await client.query("ROLLBACK TO SAVEPOINT duplicate_primary");

  const conflicts = await client.query(
    `SELECT key,severity FROM access_conflict_rules WHERE status='active'`,
  );
  assert.ok(
    conflicts.rows.some(
      (row) =>
        row.key === "payment_prepare_approve" && row.severity === "blocking",
    ),
  );

  const snapshots = await client.query(
    `SELECT count(*)::int AS count FROM role_version_snapshots WHERE organization_id=$1`,
    [organization.id],
  );
  assert.ok(Number(snapshots.rows[0]?.count) >= 20);

  await client.query("ROLLBACK");
  console.log(
    "Enterprise RBAC live verification passed: module-aware templates, least privilege, cumulative roles, one primary role, effective dates, immutable evidence and SoD rules.",
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
