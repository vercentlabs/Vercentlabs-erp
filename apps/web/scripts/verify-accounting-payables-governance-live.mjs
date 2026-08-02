import assert from "node:assert/strict";
import path from "node:path";

import {
  deletePayablesSavedView,
  getPayablesGovernanceDashboard,
  listPayablesSavedViews,
  listVendorPaymentProposals,
  savePayablesView,
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
    ["023_accounting_payables_governance.sql"],
  );
  assert.ok(migration.rows[0], "Stage 7 tenant migration is not applied.");

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

  await client.query("BEGIN");
  await client.query(
    "SELECT set_config('app.current_organization_id',$1,true)",
    [organization.id],
  );

  const context = {
    organizationId: organization.id,
    userId: organization.created_by,
    activeCompanyId: organization.company_id || null,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: [
      "accounting.view",
      "accounting.payables.manage",
      "accounting.payables.approve",
      "accounting.payments.manage",
      "accounting.payments.approve",
    ],
    roleSlugs: ["organization_owner"],
  };

  const policy = await client.query(
    `SELECT *
       FROM tenant.accounting_payables_governance_policies
      WHERE organization_id=$1`,
    [organization.id],
  );
  assert.ok(policy.rows[0], "Payables governance policy is unavailable.");

  const dashboard = await getPayablesGovernanceDashboard(client, context);
  assert.ok(dashboard.summary, "Payables dashboard is unavailable.");
  assert.ok(Array.isArray(dashboard.bills));
  assert.ok(Array.isArray(dashboard.exceptionCases));
  assert.ok(Array.isArray(dashboard.paymentProposals));
  assert.ok(Array.isArray(dashboard.importQueue));

  const proposals = await listVendorPaymentProposals(client, context);
  assert.ok(Array.isArray(proposals));

  const saved = await savePayablesView(client, context, {
    name: "Stage 7 live verification",
    filters: { status: "overdue", matchingStatus: "exception" },
    columns: [
      "billNumber",
      "supplier",
      "dueDate",
      "outstandingAmount",
      "matchingStatus",
    ],
    sort: [{ field: "dueDate", direction: "asc" }],
  });
  assert.ok(saved.id, "Saved payables view was not created.");

  const views = await listPayablesSavedViews(client, context);
  assert.ok(
    views.some((view) => view.id === saved.id),
    "Saved payables view was not returned.",
  );

  const deleted = await deletePayablesSavedView(client, context, saved.id);
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
        "accounting_payables_governance_policies",
        "accounting_payables_saved_views",
        "accounting_payables_governance_snapshots",
        "accounting_payables_exception_cases",
        "accounting_vendor_payment_proposals",
        "accounting_vendor_payment_proposal_items",
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
    "Stage 7 live verification passed: payables policy, dashboard, saved views, payment proposals and forced RLS.",
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
