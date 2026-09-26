#!/usr/bin/env node
// `pnpm test:platform-services:db` — the Shared Platform services against a real PostgreSQL.
// Fails when the database is unreachable or any test is skipped
// (scripts/lib/run-db-suite.mjs).
import { runDbSuite } from "../lib/run-db-suite.mjs";

export const PLATFORM_SERVICES_DB_TEST_FILES = Object.freeze([
  "tests/integration/platform-services/numbering-db.test.mjs",
  "tests/integration/platform-services/files-db.test.mjs",
  "tests/integration/platform-services/integrations-db.test.mjs",
  "tests/integration/platform-services/governance-db.test.mjs",
  "tests/integration/platform-services/automation-reporting-db.test.mjs",
  "tests/integration/platform-services/operations-db.test.mjs",
]);

await runDbSuite({ name: "Platform services", files: PLATFORM_SERVICES_DB_TEST_FILES });
