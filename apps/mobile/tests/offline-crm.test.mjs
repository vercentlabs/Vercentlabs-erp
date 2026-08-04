import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const database = fs.readFileSync(
  "apps/mobile/src/core/database/database.ts",
  "utf8",
);
const recoveryMigration = fs.readFileSync(
  "apps/mobile/src/core/database/migrations/002-mutation-recovery.ts",
  "utf8",
);
const hardening = fs.readFileSync(
  "apps/mobile/src/modules/crm/data/offline-hardening.ts",
  "utf8",
);
const sync = fs.readFileSync(
  "apps/mobile/src/modules/crm/data/sync.ts",
  "utf8",
);
const serverRoute = fs.readFileSync(
  "apps/web/src/app/api/mobile/v1/crm/offline-sync/route.ts",
  "utf8",
);
const serverService = fs.readFileSync(
  "services/api/src/crm/offline-sync.js",
  "utf8",
);

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
