// The live database matches the one classification: every public table is
// classified, organisation-scoped tables carry FORCE RLS and the canonical
// policy, runtime roles hold exactly the classified privileges, definer
// functions are callable only by the roles registered for them, and the
// database is at this build's migration level.
import assert from "node:assert/strict";
import test from "node:test";

import { DEFINER_FUNCTIONS, EXPECTED_MIGRATIONS, PUBLIC_TABLES, readMigrationStatus, runtimePrivileges, verifyRestrictedRuntimeRole } from "../../../packages/database/src/index.js";
import { createProductionKit, expectPostgresError } from "./production-kit.mjs";

const PERMISSION_DENIED = /permission denied|42501/i;

test("every public table is classified; organisation-scoped ones are FORCE-RLS isolated", async () => {
  const kit = await createProductionKit();
  try {
    const { rows } = await kit.owner.query(
      `SELECT c.relname, c.relrowsecurity AS rls, c.relforcerowsecurity AS force,
              EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=c.relname AND column_name='organization_id') AS has_org,
              (SELECT pg_get_expr(p.polqual, p.polrelid) FROM pg_policy p WHERE p.polrelid=c.oid AND p.polname='organization_isolation') AS isolation
         FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY 1`,
    );
    const live = new Set(rows.map((row) => row.relname));
    const unclassified = rows.filter((row) => !PUBLIC_TABLES[row.relname]).map((row) => row.relname);
    assert.deepEqual(unclassified, [], "every public table has a class");
    const stale = Object.keys(PUBLIC_TABLES).filter((name) => !live.has(name) && PUBLIC_TABLES[name].class !== "RETIRED");
    assert.deepEqual(stale, [], "no classification for a table that does not exist");
    for (const row of rows) {
      const entry = PUBLIC_TABLES[row.relname];
      if (entry.class === "ORGANIZATION_SCOPED") {
        assert.ok(row.has_org && row.rls && row.force, `${row.relname}: organization_id + ENABLE + FORCE`);
        assert.equal(row.isolation, "(organization_id = current_organization_id())", `${row.relname}: canonical policy`);
      } else if (entry.class === "ORGANIZATION_CHILD") {
        assert.ok(row.rls && row.force && row.isolation, `${row.relname}: parent-based isolation`);
      } else {
        assert.ok(entry.reason, `${row.relname}: a non-scoped class needs a reason`);
      }
    }
    const tenant = await kit.owner.query(`SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='tenant' AND c.relkind IN ('r','p') AND NOT (c.relrowsecurity AND c.relforcerowsecurity)`);
    assert.deepEqual(tenant.rows.map((row) => row.relname), [], "every tenant table has FORCE row-level security");
  } finally {
    await kit.close();
  }
});

test("web and worker are distinct restricted roles with exactly the classified privileges", async () => {
  const kit = await createProductionKit();
  try {
    const names = {};
    for (const [kind, pool] of [["web", kit.web], ["worker", kit.worker]]) {
      const client = await pool.connect();
      try {
        names[kind] = await verifyRestrictedRuntimeRole(client, kind);
      } finally {
        client.release();
      }
    }
    assert.notEqual(names.web, names.worker, "web and worker use different database authorities");
    for (const kind of ["web", "worker"]) {
      const { rows } = await kit.owner.query(
        `SELECT table_name, array_agg(privilege_type::text ORDER BY privilege_type::text) AS privileges
           FROM information_schema.role_table_grants WHERE table_schema='public' AND grantee=$1 GROUP BY table_name`,
        [names[kind]],
      );
      const granted = new Map(rows.map((row) => [row.table_name, [...row.privileges].sort()]));
      for (const [table, entry] of Object.entries(PUBLIC_TABLES)) {
        if (entry.class === "RETIRED" && !granted.has(table)) continue;
        const expected = [...runtimePrivileges(kind, table, entry)].sort();
        assert.deepEqual(granted.get(table) ?? [], expected, `${kind} privileges on public.${table}`);
      }
    }
  } finally {
    await kit.close();
  }
});

test("least privilege holds in practice", async () => {
  const kit = await createProductionKit();
  try {
    const a = await kit.organization("A");
    const inA = { organizationId: a.organizationId };
    await assert.rejects(kit.as(kit.worker, inA, (client) => client.query("SELECT 1 FROM sessions LIMIT 1")), expectPostgresError(PERMISSION_DENIED), "the worker cannot read sessions");
    await assert.rejects(kit.as(kit.worker, inA, (client) => client.query("SELECT 1 FROM password_reset_tokens LIMIT 1")), expectPostgresError(PERMISSION_DENIED));
    await assert.rejects(kit.as(kit.worker, inA, (client) => client.query("UPDATE organizations SET name=name WHERE id=$1", [a.organizationId])), expectPostgresError(PERMISSION_DENIED), "the worker cannot change the organisation register");
    assert.equal((await kit.as(kit.worker, inA, (client) => client.query("SELECT id FROM users WHERE id=$1", [a.ownerId]))).rowCount, 1, "the worker may read users (notification recipients)");
    for (const pool of [kit.web, kit.worker]) {
      await assert.rejects(kit.as(pool, inA, (client) => client.query("INSERT INTO schema_migrations(scope,filename) VALUES('platform','999_forged.sql')")), expectPostgresError(PERMISSION_DENIED));
      await assert.rejects(kit.as(pool, inA, (client) => client.query("UPDATE permissions SET key=key")), expectPostgresError(PERMISSION_DENIED), "catalogues are read-only at runtime");
      await assert.rejects(kit.as(pool, inA, (client) => client.query("SELECT 1 FROM mobile_idempotency_keys LIMIT 1")), expectPostgresError(PERMISSION_DENIED), "retired tables are closed");
      await assert.rejects(kit.as(pool, inA, (client) => client.query("CREATE TABLE public.intruder(id int)")), expectPostgresError(PERMISSION_DENIED), "no CREATE on schemas");
    }
  } finally {
    await kit.close();
  }
});

test("definer functions: nobody by default; each runtime role only what is registered", async () => {
  const kit = await createProductionKit();
  try {
    const { rows } = await kit.owner.query(
      `SELECT n.nspname||'.'||p.proname AS name, p.oid::regprocedure::text AS signature,
              has_function_privilege('public', p.oid, 'EXECUTE') AS public_execute
         FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname IN ('public','tenant') AND p.prosecdef`,
    );
    for (const row of rows) {
      const entry = DEFINER_FUNCTIONS[row.name];
      assert.ok(entry, `${row.name} is registered`);
      assert.equal(row.public_execute, false, `${row.name}: EXECUTE revoked from PUBLIC`);
    }
    const roles = {};
    for (const [kind, pool] of [["web", kit.web], ["worker", kit.worker]]) roles[kind] = (await pool.query("SELECT current_user AS name")).rows[0].name;
    for (const row of rows) {
      const entry = DEFINER_FUNCTIONS[row.name];
      for (const kind of ["web", "worker"]) {
        const allowed = (await kit.owner.query("SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok", [roles[kind], row.signature])).rows[0].ok;
        assert.equal(allowed, Boolean(entry[kind]), `${kind} EXECUTE on ${row.name}`);
      }
    }
  } finally {
    await kit.close();
  }
});

test("the database is at this build's migration level", async () => {
  const kit = await createProductionKit();
  try {
    const status = await readMigrationStatus(kit.web);
    assert.deepEqual(status.missing, [], "the web role can read migration history and nothing is missing");
    assert.equal(status.latest.platform, EXPECTED_MIGRATIONS.platform.at(-1));
  } finally {
    await kit.close();
  }
});
