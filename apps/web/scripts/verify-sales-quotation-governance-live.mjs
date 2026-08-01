import path from "node:path";
import assert from "node:assert/strict";

import {
  getQuotationGovernanceDashboard,
  listQuotationSavedViews,
  saveQuotationView,
  deleteQuotationSavedView,
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
    ["020_sales_quotation_governance.sql"],
  );
  assert.ok(migration.rows[0], "Stage 4 tenant migration is not applied.");

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
      "sales.view",
      "sales.quotation.create",
      "sales.settings.manage",
      "sales.margin.view",
    ],
    roleSlugs: ["organization_owner"],
  };

  const dashboard = await getQuotationGovernanceDashboard(client, context);
  assert.ok(
    dashboard.summary,
    "Quotation governance dashboard is unavailable.",
  );

  const saved = await saveQuotationView(client, context, {
    name: "Stage 4 live verification",
    filters: { lifecycleStatus: "draft" },
    columns: ["quotationNumber", "customer", "validUntil", "grandTotal"],
    sort: [{ field: "updatedAt", direction: "desc" }],
  });
  assert.ok(saved.id, "Saved quotation view was not created.");

  const views = await listQuotationSavedViews(client, context);
  assert.ok(
    views.some((view) => view.id === saved.id),
    "Saved quotation view was not returned.",
  );

  const deleted = await deleteQuotationSavedView(client, context, saved.id);
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
        "sales_quotation_governance_policies",
        "sales_quotation_saved_views",
        "sales_quotation_governance_snapshots",
      ],
    ],
  );
  assert.equal(security.rows.length, 3);
  for (const row of security.rows) {
    assert.equal(row.relrowsecurity, true);
    assert.equal(row.relforcerowsecurity, true);
    assert.equal(row.has_policy, true);
  }

  await client.query("ROLLBACK");
  console.log(
    "Stage 4 live verification passed: policy, dashboard, saved views and forced RLS.",
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
