// Restore rehearsal verification (scripts/operations/restore-verify.mjs)
// against a FRESH database built exactly like a restored one: migrated by the
// real migration scripts, runtime roles provisioned, two organisations with
// data. The verifier must pass on it, and must catch an orphaned tenant row
// (the consistency class of failure a bad restore produces). The throwaway
// database is dropped afterwards.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";

import pg from "pg";

import { verifyRestoredDatabase } from "../../../scripts/operations/restore-verify.mjs";
import { requireProductionDatabases } from "./production-kit.mjs";

const withDatabase = (raw, database) => {
  const url = new URL(raw);
  url.pathname = `/${database}`;
  return url.toString();
};

function run(script, args, env) {
  const result = spawnSync(process.execPath, [script, ...args], { env: { ...process.env, ...env }, encoding: "utf8" });
  assert.equal(result.status, 0, `${script} ${args.join(" ")} failed:\n${(result.stderr || result.stdout).slice(-2000)}`);
}

test("restore verification passes on a clean restored database and catches orphaned tenant rows", { timeout: 600_000 }, async () => {
  requireProductionDatabases();
  const database = `vercent_restore_${randomBytes(4).toString("hex")}`;
  const admin = new pg.Client({ connectionString: process.env.MIGRATION_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);
  const urls = {
    MIGRATION_DATABASE_URL: withDatabase(process.env.MIGRATION_DATABASE_URL, database),
    DATABASE_URL: withDatabase(process.env.DATABASE_URL, database),
    WORKER_DATABASE_URL: withDatabase(process.env.WORKER_DATABASE_URL, database),
  };
  try {
    run("scripts/database/migrate.mjs", ["platform"], urls);
    run("scripts/database/migrate.mjs", ["tenant"], urls);
    run("scripts/database/provision-runtime-role.mjs", [], urls);

    const owner = new pg.Client({ connectionString: urls.MIGRATION_DATABASE_URL });
    await owner.connect();
    try {
      for (const name of ["Restore A", "Restore B"]) {
        const organizationId = randomUUID();
        const userId = randomUUID();
        await owner.query(`INSERT INTO public.users (id, email, full_name, password_hash, email_verified_at) VALUES ($1, $2, $3, 'x', now())`, [userId, `${userId}@restore.test`, name]);
        await owner.query(`INSERT INTO public.organizations (id, name, slug, country_code, timezone, base_currency, created_by) VALUES ($1, $2, $3, 'IN', 'Asia/Kolkata', 'INR', $4)`, [organizationId, name, `restore-${organizationId.slice(0, 8)}`, userId]);
        await owner.query(`INSERT INTO public.organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')`, [organizationId, userId]);
        await owner.query(`INSERT INTO public.audit_events (id, organization_id, actor_user_id, event_type, entity_type, metadata) VALUES ($1, $2, $3, 'restore.test', 'organization', '{}'::jsonb)`, [randomUUID(), organizationId, userId]);
      }

      const clean = await verifyRestoredDatabase({ ownerUrl: urls.MIGRATION_DATABASE_URL, runtimeUrl: urls.DATABASE_URL });
      assert.equal(clean.ok, true, JSON.stringify(clean.checks.filter((entry) => !entry.ok), null, 2));
      assert.ok(clean.checks.some((entry) => /sees only its own rows/.test(entry.name) && entry.ok));

      // A tenant row whose organisation is missing (what a partial or
      // mismatched restore leaves behind) must fail the rehearsal.
      const orphanOrganization = randomUUID();
      await owner.query("BEGIN");
      await owner.query("SELECT set_config('app.current_organization_id', $1, true)", [orphanOrganization]);
      await owner.query(`INSERT INTO tenant.platform_events (id, organization_id, module_key, event_type, entity_type, entity_id, payload) VALUES ($1, $2, 'platform', 'restore.orphan', 'test', 'orphan', '{}'::jsonb)`, [randomUUID(), orphanOrganization]);
      await owner.query("COMMIT");
      const broken = await verifyRestoredDatabase({ ownerUrl: urls.MIGRATION_DATABASE_URL, runtimeUrl: urls.DATABASE_URL });
      assert.equal(broken.ok, false);
      const consistency = broken.checks.find((entry) => /missing organisation/.test(entry.name));
      assert.equal(consistency.ok, false);
      assert.ok(consistency.detail.orphans.some((orphan) => orphan.table === "tenant.platform_events"));
    } finally {
      await owner.end().catch(() => undefined);
    }
  } finally {
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
});
