// Shared Access against a real PostgreSQL 16 database — run by
// `pnpm test:access:db` (scripts/access/run-db-tests.mjs), which FAILS rather
// than skips when the database is unreachable.
//
// Invariants that only PostgreSQL can prove: the canonical role templates are
// what the database actually grants, a principal/snapshot resolved from a
// real session reflects role/module/scope changes on the very next
// resolution, and the tenant transaction boundary isolates tenants under the
// restricted runtime role (NOBYPASSRLS), not the migration superuser.
//
// Fixture strategy: tests 1–2 run inside ONE migration-role transaction that
// is always rolled back; reads that must be subject to the runtime role run
// under `SET LOCAL ROLE <runtime role>`. Test 3 needs committed data seen
// from a second, genuinely separate runtime connection and cleans up after
// itself.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { Client } from "pg";

import { ALL_PERMISSIONS, ROLE_TEMPLATES } from "../../../packages/permissions/src/index.js";
import { ERP_MODULE_CATALOG } from "../../../packages/shared-types/src/modules.js";
import { runTenantTransaction } from "../../../packages/database/src/index.js";
import { bootstrapOrganizationRoles } from "../../../services/api/src/core/organization-registration.js";
import { createSession, resolveSessionContext } from "../../../services/api/src/core/session.js";
import { authorize, buildWorkspaceAccessSnapshot } from "../../../services/api/src/core/access/index.js";

const migrationUrl = process.env.MIGRATION_DATABASE_URL || "";
const runtimeUrl = process.env.DATABASE_URL || "";
const runtimeRole = runtimeUrl ? decodeURIComponent(new URL(runtimeUrl).username) : "";
const ENV = { NODE_ENV: "test", BILLING_ENFORCEMENT_MODE: "enforce" };

async function connect(connectionString, label) {
  assert.ok(connectionString, `${label} is not configured — test:access:db requires a real database (pnpm infra:up && pnpm db:setup).`);
  const client = new Client({ connectionString, application_name: "vercentlabs-access-db-tests" });
  await client.connect();
  return client;
}

async function asRuntimeRole(client, work) {
  await client.query(`SET LOCAL ROLE "${runtimeRole.replaceAll('"', '""')}"`);
  try {
    return await work();
  } finally {
    await client.query("RESET ROLE");
  }
}

async function seedOrganization(client, { name }) {
  const ownerId = randomUUID();
  const organizationId = randomUUID();
  await client.query(
    `INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES ($1, $2, $3, 'not-a-real-hash', 'active', now())`,
    [ownerId, `access-owner-${ownerId}@test.invalid`, `${name} Owner`],
  );
  await client.query(
    `INSERT INTO organizations (id, name, slug, country_code, timezone, base_currency, created_by) VALUES ($1, $2, $3, 'IN', 'Asia/Kolkata', 'INR', $4)`,
    [organizationId, name, `access-test-${organizationId}`, ownerId],
  );
  return { ownerId, organizationId };
}

test("canonical role templates and module catalogue are exactly what the database provisions", async () => {
  const admin = await connect(migrationUrl, "MIGRATION_DATABASE_URL");
  try {
    await admin.query("BEGIN");
    const registered = new Set((await admin.query("SELECT key FROM permissions")).rows.map((row) => row.key));
    assert.deepEqual(ALL_PERMISSIONS.filter((key) => !registered.has(key)), [], "canonical permission keys missing from the permissions table");

    const { organizationId } = await seedOrganization(admin, { name: "Access Catalogue Org" });
    await bootstrapOrganizationRoles(admin, organizationId);
    const rows = (
      await admin.query(
        `SELECT role.slug, role.is_system, role.module_key, role.assignable, role.risk_level,
                COALESCE(array_agg(permission.permission_key ORDER BY permission.permission_key) FILTER (WHERE permission.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
           FROM roles AS role
           LEFT JOIN role_permissions AS permission ON permission.role_id = role.id
          WHERE role.organization_id = $1
          GROUP BY role.slug, role.is_system, role.module_key, role.assignable, role.risk_level`,
        [organizationId],
      )
    ).rows;
    const bySlug = new Map(rows.map((row) => [row.slug, row]));
    assert.equal(bySlug.size, ROLE_TEMPLATES.length);
    for (const template of ROLE_TEMPLATES) {
      const row = bySlug.get(template.slug);
      assert.ok(row, `missing built-in role ${template.slug}`);
      assert.equal(row.is_system, true, template.slug);
      assert.equal(row.module_key, template.moduleKey, template.slug);
      assert.equal(row.assignable, template.assignable, template.slug);
      assert.equal(row.risk_level, template.riskLevel, template.slug);
      assert.deepEqual(row.permissions, [...template.permissions].sort(), `${template.slug} grants drifted from ROLE_TEMPLATES`);
    }

    const modules = (await admin.query("SELECT module_key FROM organization_modules WHERE organization_id = $1 AND status = 'enabled' ORDER BY module_key", [organizationId])).rows.map((row) => row.module_key);
    assert.deepEqual(modules, ERP_MODULE_CATALOG.map((module) => module.key).sort(), "new organizations must be enabled for exactly the module catalogue");
  } finally {
    await admin.query("ROLLBACK").catch(() => undefined);
    await admin.end();
  }
});

test("a real session resolves to a principal/snapshot whose roles, modules and company scope change on the next resolution", async () => {
  const admin = await connect(migrationUrl, "MIGRATION_DATABASE_URL");
  assert.ok(runtimeRole, "DATABASE_URL (restricted runtime role) is not configured");
  try {
    await admin.query("BEGIN");
    const { organizationId } = await seedOrganization(admin, { name: "Access Snapshot Org" });
    const roleIds = await bootstrapOrganizationRoles(admin, organizationId);
    const companyA = randomUUID();
    const companyB = randomUUID();
    const branchA = randomUUID();
    const branchB = randomUUID();
    for (const [id, code, primary] of [[companyA, "A", true], [companyB, "B", false]]) {
      await admin.query(
        `INSERT INTO companies (id, organization_id, name, legal_name, country_code, base_currency, is_primary, code) VALUES ($1, $2, $3, $3, 'IN', 'INR', $4, $5)`,
        [id, organizationId, `Company ${code}`, primary, code],
      );
    }
    await admin.query(
      `INSERT INTO branches (id, organization_id, company_id, name, code, timezone, is_primary) VALUES ($1, $2, $3, 'Branch A', 'BA', 'Asia/Kolkata', true), ($4, $2, $5, 'Branch B', 'BB', 'Asia/Kolkata', true)`,
      [branchA, organizationId, companyA, branchB, companyB],
    );

    const userId = randomUUID();
    await admin.query(
      `INSERT INTO users (id, email, full_name, password_hash, status, email_verified_at) VALUES ($1, $2, 'Access Member', 'not-a-real-hash', 'active', now())`,
      [userId, `access-member-${userId}@test.invalid`],
    );
    await admin.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [organizationId, userId]);
    for (const [slug, primary] of [["sales_representative", true], ["marketing_manager", false]]) {
      assert.ok(roleIds.get(slug), `template ${slug} must exist for this test`);
      await admin.query(
        `INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) VALUES ($1, $2, $3, $4, 'active')`,
        [organizationId, userId, roleIds.get(slug), primary],
      );
    }
    await admin.query(`INSERT INTO membership_company_access (organization_id, user_id, company_id) VALUES ($1, $2, $3)`, [organizationId, userId, companyA]);
    await admin.query(`INSERT INTO membership_branch_access (organization_id, user_id, branch_id) VALUES ($1, $2, $3)`, [organizationId, userId, branchA]);
    let { token } = await createSession(admin, { userId, organizationId, env: ENV });

    const resolve = () =>
      asRuntimeRole(admin, async () => {
        const session = await resolveSessionContext(admin, token, "browser", ENV);
        return { session, snapshot: session ? await buildWorkspaceAccessSnapshot(admin, session, { env: ENV }) : null };
      });

    const first = await resolve();
    const expectedUnion = [
      ...new Set(ROLE_TEMPLATES.filter((role) => ["sales_representative", "marketing_manager"].includes(role.slug)).flatMap((role) => role.permissions)),
    ].sort();
    assert.equal(first.snapshot.principal.organizationId, organizationId);
    assert.deepEqual([...first.snapshot.principal.roleSlugs], ["marketing_manager", "sales_representative"]);
    assert.deepEqual([...first.snapshot.principal.permissions], expectedUnion, "principal permissions are the union of every active role");
    assert.deepEqual([...first.snapshot.principal.companyScope.companyIds], [companyA]);
    assert.deepEqual([...first.snapshot.principal.companyScope.branchIds], [branchA]);
    assert.equal(first.snapshot.principal.activeCompanyId, companyA);
    assert.ok(first.snapshot.accessibleModules.includes("crm"));
    assert.equal(authorize({ snapshot: first.snapshot, module: "crm" }).allowed, true);
    assert.equal(authorize({ snapshot: first.snapshot, context: { companyId: companyB } }).code, "SCOPE_DENIED");
    assert.equal(authorize({ snapshot: first.snapshot, context: { companyId: companyA, branchId: branchB } }).code, "SCOPE_DENIED");
    assert.equal(authorize({ snapshot: first.snapshot, module: "hr-payroll" }).code, "PERMISSION_DENIED");

    // Changes take effect on the very next resolution — nothing is cached.
    await admin.query(`UPDATE organization_modules SET status = 'disabled' WHERE organization_id = $1 AND module_key = 'crm'`, [organizationId]);
    const second = await resolve();
    assert.equal(authorize({ snapshot: second.snapshot, module: "crm" }).code, "MODULE_DISABLED");

    // Revoking a role assignment revokes the member's existing sessions
    // (existing session-revocation behavior, preserved); the next session
    // carries only the remaining role's permissions.
    await admin.query(`UPDATE user_role_assignments SET status = 'revoked' WHERE organization_id = $1 AND user_id = $2 AND role_id = $3`, [organizationId, userId, roleIds.get("marketing_manager")]);
    assert.equal((await resolve()).session, null, "a role change must invalidate the previous session");
    ({ token } = await createSession(admin, { userId, organizationId, env: ENV }));
    const third = await resolve();
    assert.deepEqual([...third.snapshot.principal.roleSlugs], ["sales_representative"]);
    const salesRep = ROLE_TEMPLATES.find((role) => role.slug === "sales_representative").permissions;
    assert.deepEqual([...third.snapshot.principal.permissions], [...salesRep].sort());
  } finally {
    await admin.query("ROLLBACK").catch(() => undefined);
    await admin.end();
  }
});

test("runTenantTransaction isolates tenants under the restricted runtime role, rolls back on failure and never leaks context", async () => {
  const admin = await connect(migrationUrl, "MIGRATION_DATABASE_URL");
  const app = await connect(runtimeUrl, "DATABASE_URL");
  const orgA = await seedOrganization(admin, { name: "Access Tenant A" });
  const orgB = await seedOrganization(admin, { name: "Access Tenant B" });
  try {
    const role = await app.query("SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user");
    assert.deepEqual(role.rows[0], { rolsuper: false, rolbypassrls: false }, "runtime role must not bypass RLS");

    const stageCode = `access_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    await runTenantTransaction(app, orgA.organizationId, (client) =>
      client.query(`INSERT INTO tenant.crm_lead_stages (organization_id, code, name) VALUES ($1, $2, 'Access A')`, [orgA.organizationId, stageCode]),
    );
    const context = await app.query("SELECT current_setting('app.current_organization_id', true) AS value");
    assert.ok(!context.rows[0].value, "tenant context must not survive the transaction on a pooled connection");

    const fromA = await runTenantTransaction(app, orgA.organizationId, (client) => client.query(`SELECT code FROM tenant.crm_lead_stages WHERE code = $1`, [stageCode]));
    assert.equal(fromA.rows.length, 1);
    const fromB = await runTenantTransaction(app, orgB.organizationId, (client) => client.query(`SELECT code FROM tenant.crm_lead_stages WHERE code = $1`, [stageCode]));
    assert.equal(fromB.rows.length, 0, "another tenant's context must not see the row");
    // Outside a tenant transaction the context is empty: the query either
    // matches nothing or is refused outright — it can never see the row.
    const bare = await app.query(`SELECT code FROM tenant.crm_lead_stages WHERE code = $1`, [stageCode]).catch((error) => ({ rows: [], error }));
    assert.equal(bare.rows.length, 0, "a query outside a tenant transaction sees nothing");

    await assert.rejects(
      runTenantTransaction(app, orgB.organizationId, (client) =>
        client.query(`INSERT INTO tenant.crm_lead_stages (organization_id, code, name) VALUES ($1, $2, 'Spoofed')`, [orgA.organizationId, `${stageCode}_x`]),
      ),
      /row-level security/i,
      "writing another tenant's organization_id is refused by RLS WITH CHECK",
    );

    const rolledBack = `${stageCode}_rb`;
    await assert.rejects(
      runTenantTransaction(app, orgA.organizationId, async (client) => {
        await client.query(`INSERT INTO tenant.crm_lead_stages (organization_id, code, name) VALUES ($1, $2, 'Rolled back')`, [orgA.organizationId, rolledBack]);
        throw new Error("handler failed");
      }),
      /handler failed/,
    );
    const afterRollback = await runTenantTransaction(app, orgA.organizationId, (client) => client.query(`SELECT 1 FROM tenant.crm_lead_stages WHERE code = $1`, [rolledBack]));
    assert.equal(afterRollback.rows.length, 0, "a failed handler rolls the whole transaction back");

    await assert.rejects(runTenantTransaction(app, "not-a-uuid", async () => undefined), /valid organizationId/);
    const idle = await app.query("SELECT 1 AS alive");
    assert.equal(idle.rows[0].alive, 1, "an invalid tenant id is refused before BEGIN, leaving the connection usable");
  } finally {
    for (const { organizationId, ownerId } of [orgA, orgB]) {
      await admin.query("DELETE FROM tenant.crm_lead_stages WHERE organization_id = $1", [organizationId]).catch(() => undefined);
      await admin.query("DELETE FROM organization_modules WHERE organization_id = $1", [organizationId]).catch(() => undefined);
      await admin.query("DELETE FROM organization_subscriptions WHERE organization_id = $1", [organizationId]).catch(() => undefined);
      await admin.query("DELETE FROM organizations WHERE id = $1", [organizationId]).catch(() => undefined);
      await admin.query("DELETE FROM users WHERE id = $1", [ownerId]).catch(() => undefined);
    }
    await app.end();
    await admin.end();
  }
});
