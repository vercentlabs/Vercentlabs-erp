// Readiness for the web deployable (GET /api/readiness). Bounded and cheap:
// configuration, the restricted database connection, migration level, and
// object storage reachability. Never calls payment, OAuth or mail providers,
// and never iterates tenants: a provider outage must not take pods out of
// the load balancer. Results name failed checks only (no configuration
// details or error text leave the process; those go to the logs).
import { validateRuntimeEnvironment } from "@vercentlabs/config";
import { readMigrationStatus, restrictedRoleRequired, verifyRestrictedRuntimeRole } from "@vercentlabs/database";

import { resolveObjectStorage } from "../files/storage.js";

const withTimeout = (promise, milliseconds) =>
  Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timed out")), milliseconds).unref?.())]);

// Stable facts are cached once proven; storage is re-probed at most once a minute.
const memo = { role: false, storageUntil: 0 };

export function resetReadinessCacheForTests() {
  memo.role = false;
  memo.storageUntil = 0;
}

export async function checkReadiness({ queryable, env = process.env, target = "web", timeoutMs = 2_000, storage } = {}) {
  const checks = {};
  const failures = [];
  const run = async (name, check) => {
    try {
      await withTimeout(check(), timeoutMs);
      checks[name] = "ok";
    } catch (error) {
      checks[name] = "failed";
      failures.push({ check: name, error: String(error?.message || error).slice(0, 300) });
    }
  };
  await run("configuration", async () => validateRuntimeEnvironment(target, env));
  await run("database", async () => queryable.query("SELECT 1"));
  if (checks.database === "ok") {
    await run("databaseRole", async () => {
      if (memo.role || !restrictedRoleRequired(env)) return;
      await verifyRestrictedRuntimeRole(queryable);
      memo.role = true;
    });
    await run("migrations", async () => {
      const status = await readMigrationStatus(queryable);
      if (!status.ready) throw new Error(`database is behind this build (${status.missing.length} migration(s) missing)`);
    });
  }
  const storageConfigured = env.NODE_ENV === "production" || Boolean(String(env.FILE_STORAGE_DRIVER || "").trim());
  if (storageConfigured) {
    await run("objectStorage", async () => {
      if (Date.now() < memo.storageUntil) return;
      await (storage || (await resolveObjectStorage(env))).probe();
      memo.storageUntil = Date.now() + 60_000;
    });
  }
  return { ready: failures.length === 0, checks, failures };
}
