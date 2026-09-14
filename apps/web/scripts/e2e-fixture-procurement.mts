#!/usr/bin/env -S npx tsx
// Procurement E2E fixture — adds what scripts/e2e-fixture-bootstrap.mts's
// shared "crm-e2e-fixture" organization does NOT provide but a real
// Supplier -> Requisition -> RFQ -> Purchase Order -> Goods Receipt ->
// Supplier Bill -> Payment browser journey needs:
//
//   1. A second real, logged-in-able user with the organization_owner role.
//      transitionProcurementRecord's self-approval guard
//      (PROCUREMENT_SELF_APPROVAL) correctly rejects the same user both
//      creating AND approving/qualifying a document, so a real segregated
//      buyer/approver browser journey needs two distinct authenticated
//      sessions, not one. The main bootstrap's own "restricted" user is
//      deliberately scoped to CRM-only permissions and cannot be reused.
//   2. Master data (a unit of measure, a stock-tracked item, a warehouse)
//      for the fixture organization's primary company. No module in this
//      repo currently exposes an HTTP endpoint to create these (Stock's
//      /api/stock/resources/[resource] route is GET/list-only) — this is
//      a real, separate product gap (item/warehouse/UOM master-data
//      management has no UI or API yet), not something this fixture works
//      around by choice. Seeded directly via SQL, the same way the main
//      bootstrap seeds organizations/companies/branches before any HTTP
//      layer exists to do it.
//   3. An Accounting business partner (party_type='supplier') that the
//      Procurement Supplier fixture can link via accountingPartyId, so the
//      matched-invoice -> vendor bill import path (this session's
//      F084/F086 fix) has somewhere real to land.
//
// Depends on scripts/e2e-fixture-bootstrap.mts having already run at least
// once (requires the "crm-e2e-fixture" organization/company to exist).
// Idempotent: every row is looked up/upserted by a fixed natural key, and
// re-running just rotates the approver's password like the main script
// does for its own users.
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { config as loadDotEnv } from "dotenv";

const scrypt = promisify(scryptCallback);
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");

for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, "apps/web/.env"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}

const connectionString = String(process.env.MIGRATION_DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL is required.");

// Mirrors e2e-fixture-bootstrap.mts's own copy of apps/web/src/core/auth.ts's
// hashPassword() exactly — see that file's comment for why this is a
// standalone copy rather than an import.
async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

function randomPassword() {
  return `E2e${randomBytes(18).toString("base64url")}!9`;
}

const ORG_SLUG = "crm-e2e-fixture";
const APPROVER_EMAIL = "e2e-procurement-approver@crm-e2e-fixture.test";

async function main() {
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("BEGIN");

    const org = await client.query<{ id: string }>(`SELECT id FROM organizations WHERE slug=$1`, [ORG_SLUG]);
    if (!org.rows[0]) {
      throw new Error(
        `Organization "${ORG_SLUG}" does not exist yet — run "pnpm --filter @vercentlabs/web e2e:bootstrap" first.`,
      );
    }
    const organizationId = org.rows[0].id;
    const company = await client.query<{ id: string }>(`SELECT id FROM companies WHERE organization_id=$1 AND is_primary`, [organizationId]);
    const companyId = company.rows[0].id;
    const branch = await client.query<{ id: string }>(`SELECT id FROM branches WHERE organization_id=$1 AND is_primary`, [organizationId]);
    const branchId = branch.rows[0].id;

    const approverPassword = randomPassword();
    const approverResult = await client.query<{ id: string }>(
      `INSERT INTO users(id,email,full_name,password_hash,email_verified_at,status,password_changed_at,failed_login_attempts,locked_until)
       VALUES($1,$2,'Procurement E2E Approver',$3,now(),'active',now(),0,NULL)
       ON CONFLICT (email) DO UPDATE SET
         password_hash=EXCLUDED.password_hash, status='active', email_verified_at=now(),
         failed_login_attempts=0, locked_until=NULL, password_changed_at=now()
       RETURNING id`,
      [randomUUID(), APPROVER_EMAIL, await hashPassword(approverPassword)],
    );
    const approverId = approverResult.rows[0].id;

    await client.query(
      `INSERT INTO organization_memberships(organization_id,user_id,role,status)
       VALUES($1,$2,'admin','active')
       ON CONFLICT (organization_id,user_id) DO UPDATE SET status='active'`,
      [organizationId, approverId],
    );
    await client.query(
      `INSERT INTO user_preferences(organization_id,user_id,active_company_id,active_branch_id)
       VALUES($1,$2,$3,$4)
       ON CONFLICT (organization_id,user_id) DO UPDATE SET active_company_id=EXCLUDED.active_company_id,active_branch_id=EXCLUDED.active_branch_id`,
      [organizationId, approverId, companyId, branchId],
    );

    // The organization_owner role is what seedOrganizationFoundation
    // (called by the main bootstrap) assigns to the fixture's owner user —
    // reused here rather than re-deriving a Procurement-approver-shaped
    // permission set by hand, exactly as the main script's own restricted
    // fixture reuses the real onboarding role catalogue rather than
    // inventing one for everything except its one deliberately-narrow case.
    const ownerRole = await client.query<{ id: string }>(
      `SELECT id FROM roles WHERE organization_id=$1 AND slug='organization_owner'`,
      [organizationId],
    );
    if (!ownerRole.rows[0]) throw new Error("organization_owner role not found — did the main E2E bootstrap run seedOrganizationFoundation?");
    await client.query(
      `INSERT INTO user_role_assignments(organization_id,user_id,role_id,is_primary,starts_at,status)
       VALUES($1,$2,$3,true,now(),'active')
       ON CONFLICT (organization_id,user_id,role_id) DO UPDATE SET status='active',revoked_at=NULL,expires_at=NULL,starts_at=now()`,
      [organizationId, approverId, ownerRole.rows[0].id],
    );

    const uom = await client.query<{ id: string }>(
      `INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,is_base,created_by,updated_by)
       VALUES($1,$2,'E2E-EA','E2E Each','quantity',true,$3,$3)
       ON CONFLICT (organization_id,code) DO UPDATE SET name=EXCLUDED.name
       RETURNING id`,
      [randomUUID(), organizationId, approverId],
    );
    const uomId = uom.rows[0].id;

    const item = await client.query<{ id: string }>(
      `INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,track_inventory,created_by,updated_by)
       VALUES($1,$2,$3,'E2E-PROC-ITEM','Procurement E2E Item','product',$4,true,$5,$5)
       ON CONFLICT (organization_id,code) DO UPDATE SET uom_id=EXCLUDED.uom_id
       RETURNING id`,
      [randomUUID(), organizationId, companyId, uomId, approverId],
    );
    const itemId = item.rows[0].id;

    const warehouse = await client.query<{ id: string }>(
      `INSERT INTO tenant.warehouses(id,organization_id,company_id,name,code,created_by,updated_by)
       VALUES($1,$2,$3,'Procurement E2E Warehouse','E2E-WH',$4,$4)
       ON CONFLICT (organization_id,code) DO UPDATE SET name=EXCLUDED.name
       RETURNING id`,
      [randomUUID(), organizationId, companyId, approverId],
    );
    const warehouseId = warehouse.rows[0].id;

    const party = await client.query<{ id: string }>(
      `INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,legal_name,status,created_by,updated_by)
       VALUES($1,$2,$3,'E2E-SUPPLIER-PARTY','supplier','Procurement E2E Supplier Party','Procurement E2E Supplier Party Pvt Ltd','active',$4,$4)
       ON CONFLICT (organization_id,code) DO UPDATE SET status='active'
       RETURNING id`,
      [randomUUID(), organizationId, companyId, approverId],
    );
    const accountingPartyId = party.rows[0].id;

    await client.query("COMMIT");

    const envPath = path.join(root, "apps/web/.env.e2e.local");
    const procurementKeys: Record<string, string> = {
      PROCUREMENT_E2E_APPROVER_EMAIL: APPROVER_EMAIL,
      PROCUREMENT_E2E_APPROVER_PASSWORD: approverPassword,
      PROCUREMENT_E2E_UOM_ID: uomId,
      PROCUREMENT_E2E_ITEM_ID: itemId,
      PROCUREMENT_E2E_WAREHOUSE_ID: warehouseId,
      PROCUREMENT_E2E_ACCOUNTING_PARTY_ID: accountingPartyId,
    };
    // Merge into .env.e2e.local rather than overwriting it — the main
    // bootstrap's ERP_E2E_* keys must survive this script running second in
    // the chained npm script (see package.json's test:e2e:procurement).
    const existingLines = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8").split("\n") : [];
    const keptLines = existingLines.filter((line) => {
      const key = line.match(/^([A-Z0-9_]+)=/)?.[1];
      return !key || !(key in procurementKeys);
    });
    const newLines = Object.entries(procurementKeys).map(([key, value]) => `${key}=${value}`);
    fs.writeFileSync(envPath, [...keptLines.filter(Boolean), ...newLines, ""].join("\n"), "utf8");

    console.log(`Procurement E2E fixture ready in organization ${ORG_SLUG} (${organizationId})`);
    console.log(`  approver: ${APPROVER_EMAIL}`);
    console.log(`  item: ${itemId}  warehouse: ${warehouseId}  uom: ${uomId}  accountingParty: ${accountingPartyId}`);
    console.log(`Credentials/ids written to ${path.relative(root, envPath)} (gitignored).`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error("Procurement E2E fixture bootstrap failed:", error);
  process.exit(1);
});
