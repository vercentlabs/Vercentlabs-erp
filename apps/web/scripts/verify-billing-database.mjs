import path from "node:path";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });
const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: databaseUrl });
const tables = [
  "billing_plans",
  "billing_plan_prices",
  "billing_customers",
  "organization_subscriptions",
  "billing_checkout_sessions",
  "billing_payments",
  "billing_invoices",
  "billing_webhook_events",
  "billing_usage_monthly",
  "billing_entitlement_overrides",
];
const permissions = [
  "billing.view",
  "billing.manage",
  "billing.checkout",
  "billing.audit",
];
try {
  const migration = await pool.query(
    "SELECT state FROM schema_migrations WHERE name=$1",
    ["017_billing_state_machine_and_recovery.sql"],
  );
  if (migration.rows[0]?.state !== "applied") {
    throw new Error("Billing recovery migration 017 is not applied.");
  }
  const relations = await pool.query(
    `SELECT name, to_regclass('public.' || name) AS relation FROM unnest($1::text[]) AS name ORDER BY name`,
    [tables],
  );
  const missing = relations.rows
    .filter((row) => !row.relation)
    .map((row) => row.name);
  if (missing.length)
    throw new Error(`Missing billing tables: ${missing.join(", ")}`);
  const columnRows = await pool.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (
        ('billing_plans', 'modules'),
        ('organization_subscriptions', 'modules_snapshot'),
        ('billing_checkout_sessions', 'provider_created_at'),
        ('billing_checkout_sessions', 'provider_linked_at'),
        ('billing_checkout_sessions', 'next_recovery_at'),
        ('billing_webhook_events', 'signature_value'),
        ('billing_webhook_events', 'next_attempt_at'),
        ('billing_webhook_events', 'dead_lettered_at')
      )
  `);
  if (columnRows.rowCount !== 8) {
    throw new Error("Billing recovery and entitlement columns are incomplete.");
  }
  const webhookConstraint = await pool.query(`
    SELECT pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE conname = 'billing_webhook_events_processing_status_check'
  `);
  if (!webhookConstraint.rows[0]?.definition?.includes("processing")) {
    throw new Error("Retryable webhook processing constraint is missing.");
  }
  const recoveryIndexes = await pool.query(`
    SELECT indexname FROM pg_indexes WHERE schemaname='public' AND indexname=ANY($1::text[])
  `, [[
    'billing_checkout_one_live_per_org_uidx',
    'billing_checkout_recovery_due_idx',
    'billing_webhook_recovery_idx'
  ]]);
  if (recoveryIndexes.rowCount !== 3) throw new Error("Billing recovery indexes are incomplete.");
  const permissionRows = await pool.query(
    `SELECT key FROM permissions WHERE key = ANY($1::text[])`,
    [permissions],
  );
  if (permissionRows.rowCount !== permissions.length)
    throw new Error("Billing permission catalog is incomplete.");
  const plans = await pool.query(
    `
    SELECT plan.code, count(price.id)::int AS prices
    FROM billing_plans plan LEFT JOIN billing_plan_prices price ON price.plan_id = plan.id AND price.active
    WHERE plan.code = ANY($1::text[])
    GROUP BY plan.code ORDER BY plan.code
  `,
    [["founder-preview", "launch", "growth", "scale", "enterprise"]],
  );
  if (plans.rowCount !== 5)
    throw new Error("Billing plan catalog is incomplete.");
  const missingSubscriptions = await pool.query(`
    SELECT count(*)::int AS count FROM organizations organization
    WHERE NOT EXISTS (SELECT 1 FROM organization_subscriptions subscription WHERE subscription.organization_id = organization.id)
  `);
  if (missingSubscriptions.rows[0].count !== 0)
    throw new Error("Some organisations do not have a subscription record.");
  console.log(
    `Billing database verified: ${tables.length} tables, ${permissions.length} permissions and ${plans.rowCount} plans.`,
  );
} finally {
  await pool.end();
}
