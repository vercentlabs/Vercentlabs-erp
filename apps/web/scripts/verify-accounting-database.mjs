import fs from "node:fs";
import path from "node:path";

import { ACCOUNTING_PERMISSIONS } from "@vercentlabs/permissions";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required.");

const migrationDirectory = path.resolve(process.cwd(), "../../database/tenant/migrations");
const requiredTables = [...new Set(
  fs.readdirSync(migrationDirectory)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .flatMap((name) => {
      const source = fs.readFileSync(path.join(migrationDirectory, name), "utf8");
      return [...source.matchAll(/CREATE TABLE IF NOT EXISTS tenant\.(accounting_[a-z0-9_]+)/gi)]
        .map((match) => match[1]);
    }),
)].sort();

if (!requiredTables.length) throw new Error("No Accounting table contracts were discovered.");
const criticalTables = [
  "accounting_settings",
  "accounting_journal_entries",
  "accounting_customer_invoices",
  "accounting_vendor_bills",
  "accounting_vendor_bill_matches",
  "accounting_bank_statements",
  "accounting_tax_ledger",
  "accounting_compliance_requests",
  "accounting_assets",
  "accounting_cash_forecast_scenarios",
  "accounting_cash_forecast_lines",
  "accounting_close_runs",
];
for (const table of criticalTables) {
  if (!requiredTables.includes(table)) throw new Error(`Critical Accounting table contract is missing: ${table}`);
}

const requiredNumbering = [
  "journal_entry", "customer_invoice", "customer_credit_note", "customer_receipt",
  "vendor_bill", "vendor_credit_note", "vendor_payment", "bank_statement",
  "accounting_close_run", "accounting_revaluation_run", "fixed_asset",
  "accounting_tax_return", "accounting_consolidation_run",
  "accounting_compliance_request", "accounting_cash_forecast",
];
const requiredTriggers = [
  "accounting_customer_invoice_posted_immutable",
  "accounting_vendor_bill_posted_immutable",
  "accounting_customer_invoice_line_immutable",
  "accounting_vendor_bill_line_immutable",
  "accounting_customer_allocations_append_only",
  "accounting_vendor_allocations_append_only",
];
const requiredIndexes = [
  "accounting_customer_receipt_allocation_identity_uidx",
  "accounting_vendor_payment_allocation_identity_uidx",
  "accounting_bank_statement_source_uidx",
];

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();
try {
  const applied = await client.query(
    "SELECT name FROM tenant_schema_migrations WHERE name=$1",
    ["011_accounting_integrity_and_compliance.sql"],
  );
  if (!applied.rows[0]) throw new Error("Latest Accounting tenant migration is not applied.");

  const tables = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema='tenant' AND table_name = ANY($1::text[])`,
    [requiredTables],
  );
  const found = new Set(tables.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((name) => !found.has(name));
  if (missingTables.length) throw new Error(`Missing Accounting tables: ${missingTables.join(", ")}`);

  const policies = await client.query(
    `SELECT relation.relname,relation.relrowsecurity,relation.relforcerowsecurity,
       EXISTS (SELECT 1 FROM pg_policy policy WHERE policy.polrelid=relation.oid) AS has_policy
       FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname='tenant' AND relation.relname=ANY($1::text[])`,
    [requiredTables],
  );
  const insecure = policies.rows
    .filter((row) => !row.relrowsecurity || !row.relforcerowsecurity || !row.has_policy)
    .map((row) => row.relname);
  if (insecure.length) throw new Error(`Accounting tables without complete forced RLS: ${insecure.join(", ")}`);

  const triggerRows = await client.query(
    `SELECT trigger.tgname
       FROM pg_trigger trigger
       JOIN pg_class relation ON relation.oid=trigger.tgrelid
       JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname='tenant' AND NOT trigger.tgisinternal AND trigger.tgname=ANY($1::text[])`,
    [requiredTriggers],
  );
  const triggerSet = new Set(triggerRows.rows.map((row) => row.tgname));
  const missingTriggers = requiredTriggers.filter((name) => !triggerSet.has(name));
  if (missingTriggers.length) throw new Error(`Accounting immutability triggers are missing: ${missingTriggers.join(", ")}`);

  const indexRows = await client.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname='tenant' AND indexname=ANY($1::text[])`,
    [requiredIndexes],
  );
  const indexSet = new Set(indexRows.rows.map((row) => row.indexname));
  const missingIndexes = requiredIndexes.filter((name) => !indexSet.has(name));
  if (missingIndexes.length) throw new Error(`Accounting idempotency indexes are missing: ${missingIndexes.join(", ")}`);

  const journalConstraint = await client.query(
    `SELECT pg_get_constraintdef(constraint_row.oid) AS definition
       FROM pg_constraint constraint_row
       JOIN pg_class relation ON relation.oid=constraint_row.conrelid
       JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname='tenant' AND relation.relname='accounting_journal_entries'
        AND constraint_row.conname='accounting_journal_entries_entry_type_check'`,
  );
  const journalDefinition = journalConstraint.rows[0]?.definition || "";
  for (const type of ["recurring", "asset", "subledger", "intercompany", "revaluation"]) {
    if (!journalDefinition.includes(type)) throw new Error(`Journal entry classification constraint is missing ${type}.`);
  }

  const expectedPermissions = Object.values(ACCOUNTING_PERMISSIONS).sort();
  const permissions = await client.query("SELECT key FROM permissions WHERE key=ANY($1::text[])", [expectedPermissions]);
  const permissionSet = new Set(permissions.rows.map((row) => row.key));
  const missingPermissions = expectedPermissions.filter((key) => !permissionSet.has(key));
  if (missingPermissions.length) throw new Error(`Accounting permission catalog is incomplete: ${missingPermissions.join(", ")}`);

  const released = await client.query(
    `SELECT organization.id,organization.name,module.status
       FROM organizations organization
       LEFT JOIN organization_modules module
         ON module.organization_id=organization.id AND module.module_key='accounting'
      WHERE organization.status='active' ORDER BY organization.created_at`,
  );

  for (const organization of released.rows) {
    if (organization.status !== "enabled") {
      throw new Error(`Accounting is not enabled for ${organization.name} (${organization.id}).`);
    }
    await client.query("BEGIN");
    try {
      await client.query("SELECT set_config('app.current_organization_id',$1,true)", [organization.id]);
      const foundation = await client.query(
        `SELECT company.id,company.name,
          (SELECT count(*)::int FROM tenant.accounting_settings settings
            WHERE settings.organization_id=$1 AND settings.company_id=company.id) AS settings,
          (SELECT count(*)::int FROM tenant.accounting_ledgers ledger
            WHERE ledger.organization_id=$1 AND ledger.company_id=company.id AND ledger.ledger_type='primary' AND ledger.status='active') AS primary_ledgers,
          (SELECT count(*)::int FROM tenant.accounting_accounts account
            WHERE account.organization_id=$1 AND account.company_id=company.id AND account.status='active') AS accounts,
          (SELECT count(*)::int FROM tenant.accounting_journals journal
            WHERE journal.organization_id=$1 AND journal.company_id=company.id AND journal.status='active') AS journals
         FROM public.companies company
        WHERE company.organization_id=$1 AND company.status='active'`,
        [organization.id],
      );
      for (const company of foundation.rows) {
        if (Number(company.settings) !== 1 || Number(company.primary_ledgers) < 1 ||
            Number(company.accounts) < 40 || Number(company.journals) < 9) {
          throw new Error(`Accounting foundation is incomplete for ${company.name} (${company.id}).`);
        }
      }
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    const numbering = await client.query(
      `SELECT entity_type FROM numbering_series
        WHERE organization_id=$1 AND status='active' AND entity_type=ANY($2::text[])`,
      [organization.id, requiredNumbering],
    );
    const numberingSet = new Set(numbering.rows.map((row) => row.entity_type));
    const missingNumbering = requiredNumbering.filter((key) => !numberingSet.has(key));
    if (missingNumbering.length) {
      throw new Error(`Accounting numbering is incomplete for ${organization.name}: ${missingNumbering.join(", ")}.`);
    }
  }

  console.log(
    `Accounting database verified: ${requiredTables.length} tables, ${policies.rows.length} forced-RLS contracts, ` +
    `${expectedPermissions.length} permissions, ${requiredTriggers.length} immutability triggers, ` +
    `${requiredIndexes.length} idempotency indexes and ${released.rows.length} organization foundations.`,
  );
} finally {
  client.release();
  await pool.end();
}
