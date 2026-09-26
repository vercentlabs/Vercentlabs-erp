#!/usr/bin/env node
// `pnpm test:shared-runtime:db` — notifications, approvals, audit, search and background jobs against a real PostgreSQL.
// Fails when the database is unreachable or any test is skipped
// (scripts/lib/run-db-suite.mjs).
import { runDbSuite } from "../lib/run-db-suite.mjs";

export const SHARED_RUNTIME_DB_TEST_FILES = Object.freeze([
  "tests/integration/shared-runtime/notifications-db.test.mjs",
  "tests/integration/shared-runtime/approvals-db.test.mjs",
  "tests/integration/shared-runtime/audit-db.test.mjs",
  "tests/integration/shared-runtime/search-jobs-db.test.mjs",
  "tests/integration/pos-cart-tax-promotions-coupons-f277-f281.test.mjs",
]);

await runDbSuite({ name: "Shared runtime", files: SHARED_RUNTIME_DB_TEST_FILES });
