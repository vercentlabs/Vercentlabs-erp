import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const read = (relativePath) =>
  fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");

const database = read("apps/mobile/src/core/database/database.ts");
const recoveryMigration = read(
  "apps/mobile/src/core/database/migrations/002-mutation-recovery.ts",
);
const hardening = read("apps/mobile/src/modules/crm/data/offline-hardening.ts");
const sync = read("apps/mobile/src/modules/crm/data/sync.ts");
const serverRoute = read(
  "apps/web/src/app/api/mobile/v1/crm/offline-sync/route.ts",
);
const serverService = read("services/api/src/crm/offline-sync.js");

test("offline CRM storage uses the hardened local database and recovery migration", () => {
  assert.match(database, /mutation_queue/i);
  assert.match(database, /mutation_dead_letters/i);
  assert.match(database, /conflict/i);
  assert.match(database, /encrypted|cipher|secure/i);
  assert.match(recoveryMigration, /mutation_dead_letters/i);
});

test("offline CRM retries are bounded, backed off and dead-lettered", () => {
  assert.match(database, /attempts < 5/);
  assert.match(
    database,
    /Math\.min\(60 \* 60 \* 1000, 2 \*\* attempts \* 5_000\)/,
  );
  assert.match(database, /INSERT OR REPLACE INTO mutation_dead_letters/);
  assert.match(recoveryMigration, /attempts < 5/);
  assert.match(hardening, /retryable/i);
});

test("offline CRM sync is cursor based, idempotent and conflict aware", () => {
  assert.match(sync, /idempotencyKey/i);
  assert.match(hardening, /conflict/i);
  assert.match(serverRoute, /cursor/i);
  assert.match(serverRoute, /resolve-conflict/i);
  assert.match(serverService, /idempotency_key/i);
  assert.match(serverService, /crm_mobile_conflicts/i);
  assert.match(serverService, /const cursor/i);
});
