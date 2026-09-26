#!/usr/bin/env node
// `pnpm test:access:db` — Shared Access, tenant isolation and authentication against a real PostgreSQL.
// Fails when the database is unreachable or any test is skipped
// (scripts/lib/run-db-suite.mjs).
import { runDbSuite } from "../lib/run-db-suite.mjs";

export const ACCESS_DB_TEST_FILES = Object.freeze([
  "tests/integration/access/shared-access-db.test.mjs",
  "tests/integration/access/administration-db.test.mjs",
  "tests/integration/auth-lifecycle.test.mjs",
  "tests/integration/cross-organization-isolation-sp009.test.mjs",
  "tests/integration/crm-tenant-rls-context.test.mjs",
  "tests/integration/access-administration-sp008.test.mjs",
  "tests/integration/module-entitlements-sp010.test.mjs",
  "tests/integration/organization-administration-sp001-sp003.test.mjs",
  "tests/integration/session-revocation-inactive-approver.test.mjs",
  "tests/integration/mfa-sp007.test.mjs",
  "tests/integration/billing-entitlement-sp011.test.mjs",
  "services/api/tests/crm-access-matrix-db.test.mjs",
]);

// CRM_ACCESS_DB_REQUIRED=1: the CRM access matrix must run here, never skip.
await runDbSuite({ name: "Access", files: ACCESS_DB_TEST_FILES, env: { CRM_ACCESS_DB_REQUIRED: "1" } });
