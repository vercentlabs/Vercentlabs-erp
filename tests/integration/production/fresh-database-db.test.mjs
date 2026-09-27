// `pnpm db:setup` on a brand-new database whose runtime roles do not exist
// yet — the path every new environment (and CI) takes. Immutable historical
// migrations GRANT to the legacy `vercent_app` role; the setup must create it
// only as a temporary NOLOGIN compatibility role and remove it afterwards,
// unless it IS the configured web role (then it becomes that runtime role).
//
// Runs the exact `db:setup` script against throwaway databases in the same
// cluster (the migration role needs CREATEDB, as it has in CI and locally)
// and removes the databases and roles it created.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import pg from "pg";

import { EXPECTED_MIGRATIONS, readMigrationStatus, verifyRestrictedRuntimeRole } from "../../../packages/database/src/index.js";
import { COMPATIBILITY_MARK } from "../../../scripts/database/historical-roles.mjs";
import { requireProductionDatabases } from "./production-kit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const LEGACY = "vercent_app";

requireProductionDatabases();
const ownerUrl = new URL(process.env.MIGRATION_DATABASE_URL);
const ownerRole = decodeURIComponent(ownerUrl.username);

function urlFor(database, role, password) {
  const url = new URL(ownerUrl.href);
  url.pathname = `/${database}`;
  if (role) {
    url.username = role;
    url.password = password;
  }
  return url.href;
}

function runDbSetup(env) {
  // The same `pnpm db:setup` a new environment runs (through the pnpm that
  // launched this suite when there is one).
  const pnpm = process.env.npm_execpath;
  const [command, args, shell] = pnpm && /\.c?js$/.test(pnpm) ? [process.execPath, [pnpm, "db:setup"], false] : ["npx --yes pnpm@11.21.0 db:setup", [], true];
  const result = spawnSync(command, args, { cwd: root, env: { ...process.env, ...env }, encoding: "utf8", shell, timeout: 15 * 60_000 });
  return { status: result.status, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

async function roleRow(client, name) {
  const { rows } = await client.query(
    `SELECT rolname, rolcanlogin, rolinherit, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolreplication, shobj_description(oid,'pg_authid') AS mark
       FROM pg_roles WHERE rolname=$1`,
    [name],
  );
  return rows[0] ?? null;
}

async function withClient(connectionString, work) {
  const client = new pg.Client({ connectionString, application_name: "fresh-database-test" });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function assertRestrictedRuntimeRoles(database, roles, migrationRole) {
  for (const { name, password } of roles) {
    await withClient(urlFor(database, name, password), async (client) => {
      assert.equal(await verifyRestrictedRuntimeRole(client, name), name, `${name} is restricted (NOSUPERUSER NOBYPASSRLS NOINHERIT, owns nothing, cannot create)`);
    });
  }
  await withClient(urlFor(database), async (owner) => {
    const names = roles.map((role) => role.name);
    const attributes = (await owner.query(`SELECT rolname, rolcanlogin, rolbypassrls, rolinherit FROM pg_roles WHERE rolname = ANY($1::text[]) ORDER BY 1`, [names])).rows;
    assert.equal(attributes.length, names.length, "web and worker roles exist");
    for (const row of attributes) assert.deepEqual([row.rolcanlogin, row.rolbypassrls, row.rolinherit], [true, false, false], `${row.rolname}: LOGIN NOBYPASSRLS NOINHERIT`);
    const memberships = (await owner.query(
      `SELECT member.rolname AS member, parent.rolname AS parent FROM pg_auth_members m JOIN pg_roles parent ON parent.oid=m.roleid JOIN pg_roles member ON member.oid=m.member WHERE member.rolname = ANY($1::text[])`,
      [names],
    )).rows;
    assert.deepEqual(memberships, [], "runtime roles are members of nothing");
    assert.ok(!names.includes(migrationRole), "the migration role is separate from both runtime roles");
    const owned = (await owner.query(
      `SELECT count(*)::int AS count FROM pg_shdepend d JOIN pg_roles r ON r.oid=d.refobjid
        WHERE r.rolname = ANY($1::text[]) AND d.deptype='o' AND d.dbid=(SELECT oid FROM pg_database WHERE datname=current_database())`,
      [names],
    )).rows[0].count;
    assert.equal(owned, 0, "runtime roles own no objects");
    const status = await readMigrationStatus(owner);
    assert.deepEqual(status.missing, [], "every expand migration is recorded");
    const recorded = (await owner.query(`SELECT scope, count(*)::int AS count FROM public.schema_migrations WHERE filename NOT LIKE 'contracts/%' GROUP BY scope ORDER BY scope`)).rows;
    assert.deepEqual(recorded, [
      { scope: "platform", count: EXPECTED_MIGRATIONS.platform.length },
      { scope: "tenant", count: EXPECTED_MIGRATIONS.tenant.length },
    ]);
  });
}

async function createFreshDatabase(admin, label) {
  const suffix = randomUUID().replaceAll("-", "").slice(0, 10);
  const database = `vercent_fresh_${label}_${suffix}`;
  await admin.query(`CREATE DATABASE "${database}"`);
  return { database, suffix };
}

async function dropFresh(admin, database, roleNames) {
  await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
  for (const role of roleNames) await admin.query(`DROP ROLE IF EXISTS "${role}"`);
}

test("db:setup succeeds on a brand-new database and leaves only the restricted runtime roles", { timeout: 40 * 60_000 }, async (t) => {
  const admin = new pg.Client({ connectionString: ownerUrl.href, application_name: "fresh-database-test-admin" });
  await admin.connect();
  t.after(() => admin.end().catch(() => undefined));
  const legacyBefore = await roleRow(admin, LEGACY);

  await t.test("web and worker are new roles; the legacy role is only a temporary compatibility role", async () => {
    const { database, suffix } = await createFreshDatabase(admin, "a");
    const web = { name: `vercent_fresh_web_${suffix}`, password: randomUUID() };
    const worker = { name: `vercent_fresh_worker_${suffix}`, password: randomUUID() };
    try {
      assert.equal(await roleRow(admin, web.name), null);
      assert.equal(await roleRow(admin, worker.name), null);
      const setup = runDbSetup({
        MIGRATION_DATABASE_URL: urlFor(database),
        DATABASE_URL: urlFor(database, web.name, web.password),
        WORKER_DATABASE_URL: urlFor(database, worker.name, worker.password),
      });
      assert.equal(setup.status, 0, setup.output.slice(-4000));
      await assertRestrictedRuntimeRoles(database, [web, worker], ownerRole);
      if (legacyBefore) {
        // A role someone created (e.g. a developer's configured web role) is
        // never altered or dropped by the bootstrap.
        assert.deepEqual(await roleRow(admin, LEGACY), legacyBefore, "a pre-existing vercent_app role is left exactly as it was");
      } else {
        assert.match(setup.output, /BOOTSTRAP historical grant role vercent_app/);
        assert.match(setup.output, /Removed historical compatibility role vercent_app/);
        assert.equal(await roleRow(admin, LEGACY), null, "the compatibility role is gone after setup");
      }
    } finally {
      await dropFresh(admin, database, [web.name, worker.name]);
    }
  });

  await t.test("when vercent_app IS the configured web role it becomes that restricted runtime role", async () => {
    if (legacyBefore) {
      // This cluster already has a real vercent_app (a developer database):
      // provisioning it against a throwaway database would reset its
      // password. Assert instead that it is an ordinary, unmarked role.
      assert.notEqual(legacyBefore.mark, COMPATIBILITY_MARK, "a configured vercent_app never carries the compatibility mark");
      return;
    }
    const { database, suffix } = await createFreshDatabase(admin, "b");
    const web = { name: LEGACY, password: randomUUID() };
    const worker = { name: `vercent_fresh_worker_${suffix}`, password: randomUUID() };
    try {
      const setup = runDbSetup({
        MIGRATION_DATABASE_URL: urlFor(database),
        DATABASE_URL: urlFor(database, web.name, web.password),
        WORKER_DATABASE_URL: urlFor(database, worker.name, worker.password),
      });
      assert.equal(setup.status, 0, setup.output.slice(-4000));
      await assertRestrictedRuntimeRoles(database, [web, worker], ownerRole);
      const legacy = await roleRow(admin, LEGACY);
      assert.equal(legacy.mark, null, "the adopted role no longer carries the compatibility mark");
      assert.doesNotMatch(setup.output, /Removed historical compatibility role/);
    } finally {
      await dropFresh(admin, database, [LEGACY, worker.name]);
    }
  });
});
