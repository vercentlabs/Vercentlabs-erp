import { Client } from "pg";

import { fixtures } from "./fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import type { SalesPersona } from "./sales-fixtures";

// Deterministic Procurement E2E world: separate users holding the REAL seeded
// procurement roles (no bypass role), created once per run in the shared fixture
// organisation, plus a stock-tracked item and a warehouse. Nothing pre-existing
// is modified. Sessions reuse `openSalesSession` (it is a generic persona login
// with the per-process session cache that keeps the rate-limited login endpoint
// from answering 429).
const PASSWORD = "ProcE2E!2026Secure";

export type ProcurementWorld = {
  organizationId: string;
  requester: SalesPersona;
  buyer: SalesPersona;
  approver: SalesPersona;
  manager: SalesPersona;
  receiver: SalesPersona;
  itemName: string;
  itemCode: string;
  warehouseCode: string;
  warehouseName: string;
};

let worldPromise: Promise<ProcurementWorld> | null = null;
export const getProcurementWorld = () => (worldPromise ??= buildWorld());

async function buildWorld(): Promise<ProcurementWorld> {
  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();
  const { hashPassword } = await import("../../../services/api/src/core/session.js");
  try {
    const owner = await client.query(`SELECT id FROM public.users WHERE email=$1`, [fixtures.ownerEmail]);
    const ownerUserId = owner.rows[0].id as string;
    const organizationId = (await client.query(`SELECT organization_id FROM organization_memberships WHERE user_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [ownerUserId])).rows[0].organization_id as string;
    const companyId = (await client.query(`SELECT id FROM public.companies WHERE organization_id=$1 AND is_primary=true LIMIT 1`, [organizationId])).rows[0].id as string;
    const branchId = (await client.query(`SELECT id FROM public.branches WHERE organization_id=$1 AND company_id=$2 ORDER BY created_at LIMIT 1`, [organizationId, companyId])).rows[0].id as string;
    const slugs = ["purchase_requester", "buyer", "purchase_approver", "purchase_manager", "goods_receipt_user"];
    const roles = await client.query(`SELECT slug,id FROM public.roles WHERE organization_id=$1 AND slug = ANY($2::text[])`, [organizationId, slugs]);
    const roleIdBySlug = Object.fromEntries(roles.rows.map((row) => [row.slug as string, row.id as string]));
    for (const slug of slugs) if (!roleIdBySlug[slug]) throw new Error(`Role '${slug}' not found in organisation ${organizationId}.`);

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const passwordHash = await hashPassword(PASSWORD);
    async function persona(label: string, roleSlug: string): Promise<SalesPersona> {
      const userId = crypto.randomUUID();
      const email = `e2e-proc-${label}-${suffix}@crm-e2e-fixture.test`;
      await client.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,$4,'active',now())`, [userId, email, `E2E Proc ${label}`, passwordHash]);
      await client.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [organizationId, userId]);
      await client.query(`INSERT INTO public.user_role_assignments(organization_id,user_id,role_id,is_primary,status,starts_at) VALUES ($1,$2,$3,true,'active',now())`, [organizationId, userId, roleIdBySlug[roleSlug]]);
      await client.query(`INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES ($1,$2,$3)`, [organizationId, userId, companyId]);
      await client.query(`INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES ($1,$2,$3)`, [organizationId, userId, branchId]);
      return { email, password: PASSWORD, userId };
    }
    const requester = await persona("requester", "purchase_requester");
    const buyer = await persona("buyer", "buyer");
    const approver = await persona("approver", "purchase_approver");
    const manager = await persona("manager", "purchase_manager");
    const receiver = await persona("receiver", "goods_receipt_user");

    const itemCode = `E2E-PROC-${suffix}`;
    const itemName = "Proc E2E Component";
    const warehouseCode = `PWH-${suffix}`;
    const warehouseName = "Proc E2E Warehouse";
    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_organization_id', $1, true)`, [organizationId]);
    const uomId = (await client.query(`SELECT id FROM tenant.units_of_measure WHERE organization_id=$1 AND code='EA' AND status='active' LIMIT 1`, [organizationId])).rows[0].id;
    await client.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory) VALUES ($1,$2,$3,$4,$5,'product',$6,'active',true)`, [crypto.randomUUID(), organizationId, companyId, itemCode, itemName, uomId]);
    await client.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,$5,$6,'active')`, [crypto.randomUUID(), organizationId, companyId, branchId, warehouseCode, warehouseName]);
    await client.query("COMMIT");
    return { organizationId, requester, buyer, approver, manager, receiver, itemName, itemCode, warehouseCode, warehouseName };
  } finally {
    await client.end();
  }
}
