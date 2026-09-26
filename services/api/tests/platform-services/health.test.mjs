import assert from "node:assert/strict";
import test from "node:test";

import { EXPECTED_MIGRATIONS } from "../../../../packages/database/src/index.js";
import { checkReadiness, resetReadinessCacheForTests } from "../../src/core/platform/health/index.js";

const applied = [...EXPECTED_MIGRATIONS.platform.map((filename) => ({ scope: "platform", filename })), ...EXPECTED_MIGRATIONS.tenant.map((filename) => ({ scope: "tenant", filename }))];
const restrictedRole = { role_name: "vercent_web", is_superuser: false, bypasses_rls: false, inherits_roles: false, can_create_database: false, can_create_roles: false, can_replicate: false, owns_relations: false, owns_functions: false, can_create_schema_objects: false, has_dangerous_membership: false };

function fakeDatabase({ migrations = applied, role = restrictedRole, down = false } = {}) {
  return {
    async query(text) {
      if (down) throw new Error("connect ECONNREFUSED");
      if (/schema_migrations/.test(text)) return { rows: migrations };
      if (/pg_roles/.test(text)) return { rows: [role] };
      return { rows: [{ "?column?": 1 }] };
    },
  };
}
const ENV = { NODE_ENV: "test", DATABASE_URL: "postgresql://u:p@localhost/x", ENFORCE_RESTRICTED_DB_ROLE: "true" };

test.beforeEach(() => resetReadinessCacheForTests());

test("ready when configuration, restricted role, migrations and storage are all good", async () => {
  const result = await checkReadiness({ queryable: fakeDatabase(), env: { ...ENV, FILE_STORAGE_DRIVER: "memory" }, storage: { probe: async () => true } });
  assert.deepEqual(result.checks, { configuration: "ok", database: "ok", databaseRole: "ok", migrations: "ok", objectStorage: "ok" });
  assert.equal(result.ready, true);
});

test("not ready: database down, database behind this build, privileged role, storage unreachable", async () => {
  assert.equal((await checkReadiness({ queryable: fakeDatabase({ down: true }), env: ENV })).checks.database, "failed");
  const behind = await checkReadiness({ queryable: fakeDatabase({ migrations: applied.slice(0, -1) }), env: ENV });
  assert.equal(behind.checks.migrations, "failed");
  assert.match(behind.failures[0].error, /behind this build/);
  resetReadinessCacheForTests();
  const superuser = await checkReadiness({ queryable: fakeDatabase({ role: { ...restrictedRole, bypasses_rls: true } }), env: ENV });
  assert.equal(superuser.checks.databaseRole, "failed");
  const storage = await checkReadiness({ queryable: fakeDatabase(), env: { ...ENV, FILE_STORAGE_DRIVER: "memory" }, storage: { probe: async () => { throw new Error("403"); } } });
  assert.equal(storage.checks.objectStorage, "failed");
  assert.equal(storage.ready, false);
});

test("a hung dependency is bounded by the timeout", async () => {
  const hung = { query: () => new Promise(() => {}) };
  const started = Date.now();
  const result = await checkReadiness({ queryable: hung, env: ENV, timeoutMs: 50 });
  assert.equal(result.checks.database, "failed");
  assert.ok(Date.now() - started < 2_000);
});
