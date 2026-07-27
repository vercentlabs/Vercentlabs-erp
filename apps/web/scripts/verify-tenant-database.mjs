import path from "node:path";

import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

const databaseUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required.");
}

const requiredTables = [
  "addresses",
  "business_parties",
  "contacts",
  "currencies",
  "exchange_rates",
  "fiscal_periods",
  "item_groups",
  "item_uom_conversions",
  "items",
  "master_data_external_ids",
  "master_data_import_jobs",
  "payment_term_lines",
  "payment_terms",
  "price_list_items",
  "price_lists",
  "tax_categories",
  "tax_rates",
  "units_of_measure",
  "warehouse_locations",
  "warehouses",
];

const requiredPermissions = [
  "business_data.view",
  "parties.manage",
  "items.manage",
  "inventory_setup.manage",
  "finance_setup.manage",
  "business_data.import",
];

const pool = new pg.Pool({
  connectionString: databaseUrl,
});

try {
  const tableResult = await pool.query(
    `
      SELECT
        expected.name,
        to_regclass('tenant.' || expected.name) AS relation
      FROM unnest($1::text[]) AS expected(name)
      ORDER BY expected.name
    `,
    [requiredTables],
  );

  const missingTables = tableResult.rows
    .filter((row) => !row.relation)
    .map((row) => row.name);

  if (missingTables.length) {
    throw new Error(`Missing tenant tables: ${missingTables.join(", ")}`);
  }

  const rowSecurityResult = await pool.query(
    `
      SELECT
        c.relname,
        c.relrowsecurity,
        c.relforcerowsecurity
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'tenant'
        AND c.relkind = 'r'
      ORDER BY c.relname
    `,
  );

  const unprotected = rowSecurityResult.rows.filter(
    (row) => !row.relrowsecurity || !row.relforcerowsecurity,
  );

  if (unprotected.length) {
    throw new Error(
      `Tenant row security is incomplete: ${unprotected
        .map((row) => row.relname)
        .join(", ")}`,
    );
  }

  const policyResult = await pool.query(
    `
      SELECT count(*)::int AS count
      FROM pg_policies
      WHERE schemaname = 'tenant'
        AND policyname = 'tenant_organization_isolation'
    `,
  );

  if (Number(policyResult.rows[0]?.count || 0) < requiredTables.length) {
    throw new Error(
      "Not every tenant table has an organization-isolation policy.",
    );
  }

  const permissionResult = await pool.query(
    `
      SELECT key
      FROM permissions
      WHERE key = ANY($1::text[])
      ORDER BY key
    `,
    [requiredPermissions],
  );

  if (permissionResult.rows.length !== requiredPermissions.length) {
    throw new Error("The Business Data permission catalog is incomplete.");
  }

  const organizationResult = await pool.query(
    "SELECT id FROM organizations ORDER BY created_at",
  );
  const seedRows = [];

  for (const organization of organizationResult.rows) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, true)",
        [organization.id],
      );
      const result = await client.query(
        `
          SELECT
            $1::uuid AS id,
            (
              SELECT count(*)::int
              FROM tenant.units_of_measure
              WHERE organization_id = $1
            ) AS uoms,
            (
              SELECT count(*)::int
              FROM tenant.currencies
              WHERE organization_id = $1
            ) AS currencies,
            (
              SELECT count(*)::int
              FROM tenant.payment_terms
              WHERE organization_id = $1
            ) AS payment_terms
        `,
        [organization.id],
      );
      seedRows.push(result.rows[0]);
      await client.query("ROLLBACK");
    } finally {
      client.release();
    }
  }

  const incompleteSeeds = seedRows.filter(
    (row) =>
      Number(row.uoms) < 8 ||
      Number(row.currencies) < 3 ||
      Number(row.payment_terms) < 4,
  );

  if (incompleteSeeds.length) {
    throw new Error(
      "One or more organisations are missing required business-data seeds.",
    );
  }

  console.log(
    `Tenant Business Data verified: ${requiredTables.length} tables, ` +
      `${rowSecurityResult.rows.length} forced-RLS tables and ` +
      `${requiredPermissions.length} permissions.`,
  );
} finally {
  await pool.end();
}
