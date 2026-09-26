// Database-level organisation isolation for the organisation-scoped platform
// tables (migration 068), proven adversarially for BOTH runtime roles.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import { createProductionKit, expectPostgresError } from "./production-kit.mjs";

const RLS_DENIED = /row-level security|42501/i;

// One representative row per family of organisation-scoped platform service.
const FAMILIES = [
  { table: "companies", insert: (org) => ({ sql: `INSERT INTO companies(id,organization_id,name,legal_name,code,base_currency,country_code,status) VALUES($1,$2,'Co','Co',$3,'INR','IN','active')`, values: (id) => [id, org, `C${id.slice(0, 6)}`] }) },
  { table: "roles", insert: (org) => ({ sql: `INSERT INTO roles(id,organization_id,name,slug) VALUES($1,$2,'Role',$3)`, values: (id) => [id, org, `r-${id.slice(0, 8)}`] }) },
  { table: "developer_apps", insert: (org) => ({ sql: `INSERT INTO developer_apps(id,organization_id,name) VALUES($1,$2,'App')`, values: (id) => [id, org] }) },
  { table: "tag_definitions", insert: (org) => ({ sql: `INSERT INTO tag_definitions(id,organization_id,entity_type,name) VALUES($1,$2,'crm.lead',$3)`, values: (id) => [id, org, `tag-${id.slice(0, 6)}`] }) },
  { table: "feature_flags", insert: (org) => ({ sql: `INSERT INTO feature_flags(id,organization_id,flag_key) VALUES($1,$2,$3)`, values: (id) => [id, org, `flag.${id.slice(0, 6)}`] }) },
  { table: "workflow_definitions", insert: (org) => ({ sql: `INSERT INTO workflow_definitions(id,organization_id,name,entity_type) VALUES($1,$2,'Flow','crm.lead')`, values: (id) => [id, org] }) },
];

test("platform RLS: organisations cannot see, change, delete or forge each other's rows (web and worker roles)", async (t) => {
  const kit = await createProductionKit();
  try {
    const a = await kit.organization("A");
    const b = await kit.organization("B");
    for (const family of FAMILIES) {
      const rowA = randomUUID();
      const rowB = randomUUID();
      const insertA = family.insert(a.organizationId);
      const insertB = family.insert(b.organizationId);
      await kit.owner.query(insertA.sql, insertA.values(rowA));
      await kit.owner.query(insertB.sql, insertB.values(rowB));
      for (const [roleName, pool] of [["web", kit.web], ["worker", kit.worker]]) {
        await t.test(`${family.table} as ${roleName}`, async () => {
          const inA = { organizationId: a.organizationId };
          assert.equal((await kit.as(pool, inA, (client) => client.query(`SELECT id FROM ${family.table} WHERE id=$1`, [rowA]))).rowCount, 1, "own row visible");
          assert.equal((await kit.as(pool, inA, (client) => client.query(`SELECT id FROM ${family.table} WHERE id=$1`, [rowB]))).rowCount, 0, "other org's row invisible");
          assert.equal((await kit.as(pool, inA, (client) => client.query(`SELECT count(*)::int AS n FROM ${family.table} WHERE organization_id=$1`, [b.organizationId]))).rows[0].n, 0);
          assert.equal((await kit.as(pool, inA, (client) => client.query(`UPDATE ${family.table} SET organization_id=organization_id WHERE id=$1`, [rowB]))).rowCount, 0, "cannot update across orgs");
          assert.equal((await kit.as(pool, inA, (client) => client.query(`DELETE FROM ${family.table} WHERE id=$1`, [rowB]))).rowCount, 0, "cannot delete across orgs");
          const forged = family.insert(b.organizationId);
          await assert.rejects(kit.as(pool, inA, (client) => client.query(forged.sql, forged.values(randomUUID()))), expectPostgresError(RLS_DENIED), "cannot insert a row tagged with another org");
          await assert.rejects(kit.as(pool, inA, (client) => client.query(`UPDATE ${family.table} SET organization_id=$2 WHERE id=$1`, [rowA, b.organizationId])), expectPostgresError(RLS_DENIED), "cannot move a row to another org");
          // No context at all: nothing is visible and nothing can be written.
          assert.equal((await kit.as(pool, {}, (client) => client.query(`SELECT count(*)::int AS n FROM ${family.table} WHERE id = ANY($1::uuid[])`, [[rowA, rowB]]))).rows[0].n, 0, "missing context reads nothing");
          const own = family.insert(a.organizationId);
          await assert.rejects(kit.as(pool, {}, (client) => client.query(own.sql, own.values(randomUUID()))), expectPostgresError(RLS_DENIED), "missing context writes nothing");
          // row_security=off cannot be used to bypass policies.
          await assert.rejects(
            kit.as(pool, inA, async (client) => {
              await client.query("SET LOCAL row_security = off");
              return client.query(`SELECT id FROM ${family.table} WHERE id=$1`, [rowB]);
            }),
            expectPostgresError(/row-level security|row_security/i),
          );
        });
      }
    }

    await t.test("the migration owner (BYPASSRLS) sees both organisations; runtime roles never do", async () => {
      const both = await kit.owner.query(`SELECT count(DISTINCT organization_id)::int AS n FROM companies WHERE organization_id = ANY($1::uuid[])`, [[a.organizationId, b.organizationId]]);
      assert.equal(both.rows[0].n, 2);
      const role = await kit.owner.query(`SELECT rolsuper OR rolbypassrls AS bypass FROM pg_roles WHERE rolname=current_user`);
      assert.equal(role.rows[0].bypass, true, "the migration role must hold BYPASSRLS (FORCE RLS applies to table owners)");
    });
  } finally {
    await kit.close();
  }
});

test("platform RLS: users read only their own memberships across organisations; child rows follow their parent", async () => {
  const kit = await createProductionKit();
  try {
    const a = await kit.organization("A");
    const b = await kit.organization("B");
    const shared = await kit.user("shared");
    for (const org of [a, b]) await kit.owner.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'member','active')`, [org.organizationId, shared]);
    const identityOnly = await kit.as(kit.web, { userId: shared }, (client) => client.query(`SELECT organization_id, user_id FROM organization_memberships WHERE organization_id = ANY($1::uuid[])`, [[a.organizationId, b.organizationId]]));
    assert.equal(identityOnly.rowCount, 2, "own memberships in both organisations");
    assert.ok(identityOnly.rows.every((row) => row.user_id === shared), "no other member is visible without organisation context");
    const inA = await kit.as(kit.web, { userId: shared, organizationId: a.organizationId }, (client) => client.query(`SELECT user_id, organization_id FROM organization_memberships WHERE organization_id = ANY($1::uuid[])`, [[a.organizationId, b.organizationId]]));
    assert.ok(inA.rows.some((row) => row.user_id === a.ownerId), "the organisation's members are visible in its context");
    assert.ok(!inA.rows.some((row) => row.user_id === b.ownerId), "another organisation's members are not");
    const selfWrite = await kit.as(kit.web, { userId: shared }, (client) => client.query(`UPDATE organization_memberships SET role='owner' WHERE user_id=$1`, [shared]));
    assert.equal(selfWrite.rowCount, 0, "the self-read policy grants reading only, never writing");

    const roleA = randomUUID();
    const roleB = randomUUID();
    await kit.owner.query(`INSERT INTO roles(id,organization_id,name,slug) VALUES($1,$2,'A role',$3),($4,$5,'B role',$6)`, [roleA, a.organizationId, `a-${roleA.slice(0, 8)}`, roleB, b.organizationId, `b-${roleB.slice(0, 8)}`]);
    await kit.owner.query(`INSERT INTO role_permissions(role_id, permission_key) VALUES($1,'users.view'),($2,'users.view')`, [roleA, roleB]);
    const perms = await kit.as(kit.web, { organizationId: a.organizationId }, (client) => client.query(`SELECT role_id FROM role_permissions WHERE role_id = ANY($1::uuid[])`, [[roleA, roleB]]));
    assert.deepEqual(perms.rows.map((row) => row.role_id), [roleA]);
    await assert.rejects(kit.as(kit.web, { organizationId: a.organizationId }, (client) => client.query(`INSERT INTO role_permissions(role_id, permission_key) VALUES($1,'roles.manage')`, [roleB])), expectPostgresError(RLS_DENIED));
  } finally {
    await kit.close();
  }
});

test("organisation context never leaks across pooled connections, rollbacks or prepared statements", async () => {
  const kit = await createProductionKit();
  const single = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1, application_name: "production-tests-leak" });
  try {
    const a = await kit.organization("A");
    const b = await kit.organization("B");
    const current = async () => (await single.query("SELECT current_setting('app.current_organization_id', true) AS value")).rows[0].value || "";
    await kit.as(single, { organizationId: a.organizationId }, async (client) => client.query("SELECT 1"));
    assert.equal(await current(), "", "cleared after COMMIT on the reused connection");
    await assert.rejects(kit.as(single, { organizationId: a.organizationId }, async (client) => { await client.query("SELECT 1/0"); }));
    assert.equal(await current(), "", "cleared after ROLLBACK");
    assert.equal((await single.query("SELECT count(*)::int AS n FROM companies WHERE organization_id = ANY($1::uuid[])", [[a.organizationId, b.organizationId]])).rows[0].n, 0, "a reused connection sees no organisation data");
    // The same named prepared statement returns each context's own rows.
    await kit.owner.query(`INSERT INTO developer_apps(organization_id,name) VALUES($1,'A app'),($2,'B app')`, [a.organizationId, b.organizationId]);
    const prepared = { name: "production-tests-apps", text: "SELECT name FROM developer_apps WHERE organization_id = ANY($1::uuid[]) ORDER BY name" };
    const ids = [[a.organizationId, b.organizationId]];
    const inA = await kit.as(single, { organizationId: a.organizationId }, (client) => client.query({ ...prepared, values: ids }));
    const inB = await kit.as(single, { organizationId: b.organizationId }, (client) => client.query({ ...prepared, values: ids }));
    assert.deepEqual(inA.rows.map((row) => row.name), ["A app"]);
    assert.deepEqual(inB.rows.map((row) => row.name), ["B app"]);
  } finally {
    await single.end().catch(() => undefined);
    await kit.close();
  }
});

test("audit events are append-only and organisation-private for runtime roles", async () => {
  const kit = await createProductionKit();
  try {
    const a = await kit.organization("A");
    const b = await kit.organization("B");
    const eventA = randomUUID();
    await kit.as(kit.web, { organizationId: a.organizationId }, (client) => client.query(`INSERT INTO audit_events(id,organization_id,event_type,entity_type) VALUES($1,$2,'test.event','test')`, [eventA, a.organizationId]));
    await assert.rejects(kit.as(kit.web, { organizationId: a.organizationId }, (client) => client.query(`INSERT INTO audit_events(id,organization_id,event_type,entity_type) VALUES($1,$2,'test.event','test')`, [randomUUID(), b.organizationId])), expectPostgresError(RLS_DENIED));
    await assert.rejects(kit.as(kit.web, { organizationId: a.organizationId }, (client) => client.query(`UPDATE audit_events SET event_type='tampered' WHERE id=$1`, [eventA])), expectPostgresError(/permission denied|42501/i));
    await assert.rejects(kit.as(kit.worker, { organizationId: a.organizationId }, (client) => client.query(`DELETE FROM audit_events WHERE id=$1`, [eventA])), expectPostgresError(/permission denied|42501/i));
    assert.equal((await kit.as(kit.web, { organizationId: b.organizationId }, (client) => client.query(`SELECT 1 FROM audit_events WHERE id=$1`, [eventA]))).rowCount, 0);
  } finally {
    await kit.close();
  }
});
