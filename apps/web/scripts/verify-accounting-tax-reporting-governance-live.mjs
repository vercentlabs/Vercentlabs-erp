import assert from "node:assert/strict";
import path from "node:path";

import {
  captureFinancialReportingSnapshot,
  deleteTaxSavedView,
  getTaxReportingGovernanceDashboard,
  listTaxSavedViews,
  saveTaxView,
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
    ["025_accounting_tax_reporting_governance.sql"],
  );
  assert.ok(migration.rows[0], "Stage 9 tenant migration is not applied.");

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
    "A company is required for Stage 9 verification.",
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
      "accounting.tax.manage",
      "accounting.reports.view",
      "accounting.close.manage",
    ],
    roleSlugs: ["organization_owner"],
  };

  const policy = await client.query(
    `SELECT *
       FROM tenant.accounting_tax_reporting_policies
      WHERE organization_id=$1 AND company_id=$2`,
    [organization.id, organization.company_id],
  );
  assert.ok(policy.rows[0], "Tax reporting policy is unavailable.");

  const dashboard = await getTaxReportingGovernanceDashboard(client, context);
  assert.ok(dashboard.summary, "Tax reporting dashboard is unavailable.");
  assert.ok(Array.isArray(dashboard.returns));
  assert.ok(Array.isArray(dashboard.exceptionCases));
  assert.ok(Array.isArray(dashboard.complianceRequests));
  assert.ok(Array.isArray(dashboard.reportingSnapshots));

  const saved = await saveTaxView(client, context, {
    name: "Stage 9 live verification",
    filters: { readiness: "blocked", filingStatus: "review" },
    columns: [
      "returnType",
      "periodEnd",
      "filingDueDate",
      "readiness",
      "riskBand",
    ],
    sort: [{ field: "filingDueDate", direction: "asc" }],
  });
  assert.ok(saved.id, "Saved tax view was not created.");

  const views = await listTaxSavedViews(client, context);
  assert.ok(
    views.some((view) => view.id === saved.id),
    "Saved tax view was not returned.",
  );

  const reportingSnapshot = await captureFinancialReportingSnapshot(
    client,
    context,
    {
      companyId: organization.company_id,
      reportType: "trial-balance",
    },
  );
  assert.ok(
    reportingSnapshot.id,
    "Financial reporting snapshot was not created.",
  );
  assert.ok(reportingSnapshot.content_hash);

  const deleted = await deleteTaxSavedView(client, context, saved.id);
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
        "accounting_tax_reporting_policies",
        "accounting_tax_saved_views",
        "accounting_tax_exception_cases",
        "accounting_tax_governance_snapshots",
        "accounting_financial_reporting_snapshots",
      ],
    ],
  );
  assert.equal(security.rows.length, 5);
  for (const row of security.rows) {
    assert.equal(row.relrowsecurity, true);
    assert.equal(row.relforcerowsecurity, true);
    assert.equal(row.has_policy, true);
  }

  await client.query("ROLLBACK");
  console.log(
    "Stage 9 live verification passed: tax policy, dashboard, saved views, reporting snapshot and forced RLS.",
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
