#!/usr/bin/env node
// `pnpm test:production:db` — production-readiness invariants against a real
// PostgreSQL with the migration owner AND both restricted runtime roles
// (web: DATABASE_URL, worker: WORKER_DATABASE_URL): platform/tenant RLS,
// the table classification, runtime-role privileges, definer functions,
// migration level and the security-negative cases. Zero skips allowed.
import { runDbSuite } from "../lib/run-db-suite.mjs";

export const PRODUCTION_DB_TEST_FILES = Object.freeze([
  "tests/integration/production/platform-rls-db.test.mjs",
  "tests/integration/production/runtime-roles-db.test.mjs",
  "tests/integration/production/contracts-db.test.mjs",
  "tests/integration/production/restore-verify-db.test.mjs",
  "tests/integration/production/field-security-db.test.mjs",
  "tests/integration/production/organization-connection-db.test.mjs",
]);

await runDbSuite({ name: "Production", files: PRODUCTION_DB_TEST_FILES, requiredUrls: ["MIGRATION_DATABASE_URL", "DATABASE_URL", "WORKER_DATABASE_URL"] });
