import assert from "node:assert/strict";
import path from "node:path";

import {
  captureCashPositionSnapshot,
  deleteBankingSavedView,
  getBankingGovernanceDashboard,
  listBankingSavedViews,
  saveBankingView,
} from "@vercentlabs/api";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
const client = await pool.connect();

try {
  const migration = await client.query(
    "SELECT 1 FROM tenant_schema_migrations WHERE name=$1",
    ["024_accounting_banking_close_governance.sql"],
  );
  assert.ok(migration.rows[0], "Stage 8 tenant migration is not applied.");

  const organization = (
    await client.query(
      `SELECT organization.id,organization.created_by,
              company.id AS company_id
         FROM public.organizations organization
         LEFT JOIN LATERAL (
           SELECT id
             FROM public.companies
            WHERE organization_id=organization.id
            ORDER BY created_at
            LIMIT 1
         ) company ON true
        WHERE organization.status='active'
          AND organization.created_by IS NOT NULL
        ORDER BY organization.created_at
        LIMIT 1`,
    )
  ).rows[0];
  assert.ok(organization, "An active organisation with an owner is required.");
  assert.ok(
    organization.company_id,
    "A company is required for Stage 8 verification.",
  );

  await client.query("BEGIN");
  await client.query(
    "SELECT set_config('app.current_organization_id',$1,true)",
    [organization.id],
  );

  const context = {
    organizationId: organization.id,
    userId: organization.created_by,
    activeCompanyId: organization.company_id,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: [
      "accounting.view",
      "accounting.reports.view",
      "accounting.bank.manage",
      "accounting.bank.reconcile",
      "accounting.close.manage",
      "accounting.budget.manage",
    ],
    roleSlugs: ["organization_owner"],
  };

  const policy = await client.query(
    `SELECT *
       FROM tenant.accounting_banking_governance_policies
      WHERE organization_id=$1`,
    [organization.id],
  );
  assert.ok(policy.rows[0], "Banking governance policy is unavailable.");

  const dashboard = await getBankingGovernanceDashboard(client, context);
  assert.ok(dashboard.summary, "Banking dashboard is unavailable.");
  assert.ok(Array.isArray(dashboard.statements));
  assert.ok(Array.isArray(dashboard.cashPositions));
  assert.ok(Array.isArray(dashboard.exceptionCases));
  assert.ok(Array.isArray(dashboard.closeReadiness));

  const saved = await saveBankingView(client, context, {
    name: "Stage 8 live verification",
    filters: { status: "reconciling", riskBand: "high" },
    columns: [
      "statementNumber",
      "bankAccount",
      "periodEnd",
      "openLineCount",
      "readiness",
    ],
    sort: [{ field: "periodEnd", direction: "asc" }],
  });
  assert.ok(saved.id, "Saved banking view was not created.");

  const views = await listBankingSavedViews(client, context);
  assert.ok(
    views.some((view) => view.id === saved.id),
    "Saved banking view was not returned.",
  );

  const cashSnapshot = await captureCashPositionSnapshot(client, context, {
    companyId: organization.company_id,
  });
  assert.ok(cashSnapshot.id, "Cash-position snapshot was not created.");

  const deleted = await deleteBankingSavedView(client, context, saved.id);
  assert.equal(deleted.deleted, true);

  const security = await client.query(
    `SELECT relation.relname,relation.relrowsecurity,
            relation.relforcerowsecurity,
            EXISTS (
              SELECT 1 FROM pg_policy policy
               WHERE policy.polrelid=relation.oid
            ) AS has_policy
       FROM pg_class relation
       JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
      WHERE namespace.nspname='tenant'
        AND relation.relname=ANY($1::text[])`,
    [
      [
        "accounting_banking_governance_policies",
        "accounting_banking_saved_views",
        "accounting_banking_governance_snapshots",
        "accounting_reconciliation_exception_cases",
        "accounting_cash_position_snapshots",
        "accounting_close_readiness_snapshots",
      ],
    ],
  );
  assert.equal(security.rows.length, 6);
  for (const row of security.rows) {
    assert.equal(row.relrowsecurity, true);
    assert.equal(row.relforcerowsecurity, true);
    assert.equal(row.has_policy, true);
  }

  await client.query("ROLLBACK");
  console.log(
    "Stage 8 live verification passed: banking policy, dashboard, saved views, cash position and forced RLS.",
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
