#!/usr/bin/env node
// `pnpm test:billing:db` — SaaS billing sagas, webhooks, recovery and entitlements against a real PostgreSQL and a local Razorpay stand-in.
// Fails when the database is unreachable or any test is skipped
// (scripts/lib/run-db-suite.mjs).
import { runDbSuite } from "../lib/run-db-suite.mjs";

export const BILLING_DB_TEST_FILES = Object.freeze([
  "tests/integration/billing/billing-commercial-db.test.mjs",
  "tests/integration/billing/billing-checkout-db.test.mjs",
  "tests/integration/billing/billing-webhooks-db.test.mjs",
  "tests/integration/billing/billing-subscription-db.test.mjs",
  "tests/integration/billing-entitlement-sp011.test.mjs",
  "tests/integration/organization-subscription-auto-provision.test.mjs",
]);

await runDbSuite({ name: "Billing", files: BILLING_DB_TEST_FILES });
