import assert from "node:assert/strict";
import path from "node:path";

import {
  captureProcurementGovernanceSnapshot,
  deleteProcurementSavedView,
  getProcurementGovernanceDashboard,
  getProcurementGovernanceTimeline,
  listProcurementSavedViews,
  saveProcurementView,
  upsertProcurementExceptionCase,
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
    ["026_procurement_supplier_lifecycle_governance.sql"],
  );
  assert.ok(migration.rows[0], "Stage 10 tenant migration is not applied.");
  const organization = (
    await client.query(`SELECT organization.id,organization.created_by,company.id AS company_id
    FROM public.organizations organization LEFT JOIN LATERAL (SELECT id FROM public.companies WHERE organization_id=organization.id ORDER BY created_at LIMIT 1) company ON true
    WHERE organization.status='active' AND organization.created_by IS NOT NULL ORDER BY organization.created_at LIMIT 1`)
  ).rows[0];
  assert.ok(
    organization?.company_id,
    "An active organisation with a company and owner is required.",
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
      "procurement.view",
      "procurement.suppliers.view",
      "procurement.suppliers.qualify",
      "procurement.po.manage",
      "procurement.settings.manage",
    ],
    roleSlugs: ["organization_owner"],
  };
  const supplier = (
    await client.query(
      `INSERT INTO tenant.procurement_suppliers (organization_id,company_id,status,search_text,data,content_hash,created_by,updated_by)
    VALUES ($1,$2,'active','Stage 10 verification supplier',$3::jsonb,$4,$5,$5) RETURNING *`,
      [
        organization.id,
        organization.company_id,
        JSON.stringify({
          legalName: "Stage 10 verification supplier",
          currencyCode: "INR",
        }),
        "stage10-live-verification",
        organization.created_by,
      ],
    )
  ).rows[0];
  await client.query(
    `INSERT INTO tenant.procurement_supplier_qualifications (organization_id,company_id,parent_id,status,data) VALUES ($1,$2,$3,'active',$4::jsonb)`,
    [
      organization.id,
      organization.company_id,
      supplier.id,
      JSON.stringify({ result: "approved" }),
    ],
  );
  await client.query(
    `INSERT INTO tenant.procurement_supplier_certifications (organization_id,company_id,parent_id,status,data) VALUES ($1,$2,$3,'active',$4::jsonb)`,
    [
      organization.id,
      organization.company_id,
      supplier.id,
      JSON.stringify({ name: "GST registration", expiryDate: "2027-08-03" }),
    ],
  );
  const dashboard = await getProcurementGovernanceDashboard(client, context);
  assert.ok(dashboard.summary);
  assert.ok(Array.isArray(dashboard.suppliers));
  assert.ok(Array.isArray(dashboard.purchaseOrders));
  const saved = await saveProcurementView(client, context, {
    entityType: "purchase-orders",
    name: "Stage 10 live verification",
    filters: { readiness: "blocked" },
    columns: ["purchaseOrderNumber", "supplier", "status", "readiness"],
    sort: [{ field: "updatedAt", direction: "desc" }],
  });
  assert.ok(saved.id);
  assert.ok(
    (await listProcurementSavedViews(client, context)).some(
      (view) => view.id === saved.id,
    ),
  );
  const snapshot = await captureProcurementGovernanceSnapshot(
    client,
    context,
    "suppliers",
    supplier.id,
    "stage-10-live",
  );
  assert.ok(snapshot.id);
  assert.equal(snapshot.readiness_status, "ready");
  const exceptionCase = await upsertProcurementExceptionCase(
    client,
    context,
    "suppliers",
    supplier.id,
    {
      status: "under_review",
      priority: "high",
      reasonCode: "supplier_compliance",
      note: "Live verification case",
    },
  );
  assert.ok(exceptionCase.id);
  const timeline = await getProcurementGovernanceTimeline(
    client,
    context,
    "suppliers",
    supplier.id,
  );
  assert.ok(timeline.some((entry) => entry.entry_type === "snapshot"));
  assert.ok(timeline.some((entry) => entry.entry_type === "exception"));
  assert.equal(
    (await deleteProcurementSavedView(client, context, saved.id)).deleted,
    true,
  );
  const tables = [
    "procurement_governance_policies",
    "procurement_governance_saved_views",
    "procurement_governance_exception_cases",
    "procurement_governance_snapshots",
  ];
  const security = await client.query(
    `SELECT relation.relname,relation.relrowsecurity,relation.relforcerowsecurity,EXISTS(SELECT 1 FROM pg_policy policy WHERE policy.polrelid=relation.oid) AS has_policy FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace WHERE namespace.nspname='tenant' AND relation.relname=ANY($1::text[])`,
    [tables],
  );
  assert.equal(security.rows.length, tables.length);
  for (const row of security.rows) {
    assert.equal(row.relrowsecurity, true);
    assert.equal(row.relforcerowsecurity, true);
    assert.equal(row.has_policy, true);
  }
  await client.query("ROLLBACK");
  console.log(
    "Stage 10 live verification passed: supplier qualification, dashboard, saved views, snapshots, exceptions, timeline and forced RLS.",
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
