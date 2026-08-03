import fs from "node:fs";
import path from "node:path";

import { PROCUREMENT_PERMISSIONS } from "@vercentlabs/permissions";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });
const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!databaseUrl)
  throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required.");

const baseMigration = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "../../database/tenant/migrations/012_procurement_module.sql",
  ),
  "utf8",
);
const completionMigration = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "../../database/tenant/migrations/013_procurement_enterprise_completion.sql",
  ),
  "utf8",
);
const integrityMigration = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "../../database/tenant/migrations/014_procurement_integrity_hardening.sql",
  ),
  "utf8",
);
const governanceMigration = fs.readFileSync(
  path.resolve(
    process.cwd(),
    "../../database/tenant/migrations/026_procurement_supplier_lifecycle_governance.sql",
  ),
  "utf8",
);
const migration = `${baseMigration}\n${completionMigration}\n${integrityMigration}\n${governanceMigration}`;
const requiredTables = [
  ...new Set(
    [
      ...migration.matchAll(
        /CREATE TABLE IF NOT EXISTS tenant\.(procurement_[a-z0-9_]+)/gi,
      ),
    ].map((match) => match[1]),
  ),
].sort();
if (requiredTables.length < 31)
  throw new Error("Procurement table contract is incomplete.");
const requiredNumbering = [
  "purchase_requisition",
  "sourcing_event",
  "procurement_agreement",
  "purchase_order",
  "advance_shipping_notice",
  "goods_receipt",
  "service_entry",
  "return_to_vendor",
  "procurement_match_exception",
];
const expectedPermissions = Object.values(PROCUREMENT_PERMISSIONS).sort();

const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  const requiredMigrations = [
    "012_procurement_module.sql",
    "013_procurement_enterprise_completion.sql",
    "014_procurement_integrity_hardening.sql",
    "026_procurement_supplier_lifecycle_governance.sql",
  ];
  const applied = await pool.query(
    "SELECT name,state FROM tenant_schema_migrations WHERE name=ANY($1::text[])",
    [requiredMigrations],
  );
  const appliedSet = new Map(applied.rows.map((row) => [row.name, row.state]));
  for (const name of requiredMigrations) {
    if (appliedSet.get(name) !== "applied")
      throw new Error(`Procurement tenant migration ${name} is not applied.`);
  }

  const tables = await pool.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema='tenant' AND table_name=ANY($1::text[])`,
    [requiredTables],
  );
  const tableSet = new Set(tables.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((name) => !tableSet.has(name));
  if (missingTables.length)
    throw new Error(`Missing Procurement tables: ${missingTables.join(", ")}`);

  const security = await pool.query(
    `SELECT relation.relname,relation.relrowsecurity,relation.relforcerowsecurity,
    EXISTS (SELECT 1 FROM pg_policy policy WHERE policy.polrelid=relation.oid) AS has_policy
    FROM pg_class relation JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
    WHERE namespace.nspname='tenant' AND relation.relname=ANY($1::text[])`,
    [requiredTables],
  );
  const insecure = security.rows
    .filter(
      (row) =>
        !row.relrowsecurity || !row.relforcerowsecurity || !row.has_policy,
    )
    .map((row) => row.relname);
  if (insecure.length)
    throw new Error(
      `Procurement tables without complete forced RLS: ${insecure.join(", ")}`,
    );

  const integrityColumns = await pool.query(`
    SELECT table_name,column_name FROM information_schema.columns
     WHERE table_schema='tenant' AND (table_name,column_name) IN (
       ('procurement_purchase_orders','supplier_id'),
       ('procurement_purchase_orders','source_event_id'),
       ('procurement_receipts','purchase_order_id'),
       ('procurement_purchase_order_lines','received_quantity'),
       ('procurement_purchase_order_lines','invoiced_quantity'),
       ('procurement_receipt_lines','purchase_order_line_id'),
       ('procurement_sourcing_bids','version')
     )
  `);
  if (integrityColumns.rowCount !== 7)
    throw new Error(
      "Procurement normalized relationship/version columns are incomplete.",
    );

  const integrityIndexes = await pool.query(
    `
    SELECT indexname FROM pg_indexes
     WHERE schemaname='tenant' AND indexname=ANY($1::text[])
  `,
    [
      [
        "procurement_invoice_matches_duplicate_uidx",
        "procurement_purchase_orders_idempotency_uidx",
      ],
    ],
  );
  if (integrityIndexes.rowCount !== 2)
    throw new Error(
      "Procurement idempotency/duplicate indexes are incomplete.",
    );
  const awardUniqueness = await pool.query(`
    SELECT 1
      FROM pg_constraint constraint_row
      JOIN pg_class relation ON relation.oid=constraint_row.conrelid
      JOIN pg_namespace namespace ON namespace.oid=relation.relnamespace
     WHERE namespace.nspname='tenant'
       AND relation.relname='procurement_sourcing_awards'
       AND constraint_row.contype='u'
       AND pg_get_constraintdef(constraint_row.oid) LIKE '%organization_id, source_event_id%'
  `);
  if (!awardUniqueness.rows[0])
    throw new Error("Procurement sourcing-award uniqueness is missing.");

  const permissions = await pool.query(
    "SELECT key FROM permissions WHERE key=ANY($1::text[])",
    [expectedPermissions],
  );
  const permissionSet = new Set(permissions.rows.map((row) => row.key));
  const missingPermissions = expectedPermissions.filter(
    (key) => !permissionSet.has(key),
  );
  if (missingPermissions.length)
    throw new Error(
      `Procurement permission catalog is incomplete: ${missingPermissions.join(", ")}`,
    );

  const released =
    await pool.query(`SELECT organization.id,organization.name,module.status
    FROM organizations organization LEFT JOIN organization_modules module
      ON module.organization_id=organization.id AND module.module_key='procurement'
    WHERE organization.status='active' ORDER BY organization.created_at`);
  for (const organization of released.rows) {
    if (organization.status !== "enabled")
      throw new Error(
        `Procurement is not enabled for ${organization.name} (${organization.id}).`,
      );
    const numbering = await pool.query(
      "SELECT entity_type FROM numbering_series WHERE organization_id=$1 AND status='active' AND entity_type=ANY($2::text[])",
      [organization.id, requiredNumbering],
    );
    const numberingSet = new Set(numbering.rows.map((row) => row.entity_type));
    const missing = requiredNumbering.filter((key) => !numberingSet.has(key));
    if (missing.length)
      throw new Error(
        `Procurement numbering is incomplete for ${organization.name}: ${missing.join(", ")}.`,
      );
  }

  console.log(
    `Procurement database verified: ${requiredTables.length} tables, ${security.rows.length} forced-RLS contracts, ${expectedPermissions.length} permissions and ${released.rows.length} organization registrations.`,
  );
} finally {
  await pool.end();
}
