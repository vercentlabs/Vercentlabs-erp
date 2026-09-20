import { Client } from "pg";

import { fixtures } from "./fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";
import type { SalesPersona } from "./sales-fixtures";

// Deterministic Manufacturing E2E world: separate users holding the REAL seeded roles
// (manufacturing_manager x2 so a second person can approve; quality_manager is view-only for
// Manufacturing), plus a small set of items created directly (Manufacturing has no item screen --
// items belong to Inventory).
const PASSWORD = "MfgE2E!2026Secure";

export type ManufacturingWorld = {
  organizationId: string;
  companyId: string;
  manager: SalesPersona;
  approver: SalesPersona;
  viewer: SalesPersona;
  items: Record<"finished" | "compA" | "compB" | "compC" | "sub" | "subPart", { id: string; code: string; name: string }>;
  warehouse: { id: string; code: string; name: string };
  suffix: string;
};

let worldPromise: Promise<ManufacturingWorld> | null = null;
export const getManufacturingWorld = () => (worldPromise ??= buildWorld());

async function buildWorld(): Promise<ManufacturingWorld> {
  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();
  const { hashPassword } = await import("../../../services/api/src/core/session.js");
  try {
    const owner = await client.query(`SELECT id FROM public.users WHERE email=$1`, [fixtures.ownerEmail]);
    const organizationId = (await client.query(`SELECT organization_id FROM organization_memberships WHERE user_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [owner.rows[0].id])).rows[0].organization_id as string;
    const companyId = (await client.query(`SELECT id FROM public.companies WHERE organization_id=$1 AND is_primary=true LIMIT 1`, [organizationId])).rows[0].id as string;
    const branchId = (await client.query(`SELECT id FROM public.branches WHERE organization_id=$1 AND company_id=$2 ORDER BY created_at LIMIT 1`, [organizationId, companyId])).rows[0].id as string;
    const slugs = ["manufacturing_manager", "quality_manager"];
    const roles = await client.query(`SELECT slug,id FROM public.roles WHERE organization_id=$1 AND slug = ANY($2::text[])`, [organizationId, slugs]);
    const roleIdBySlug = Object.fromEntries(roles.rows.map((row) => [row.slug as string, row.id as string]));
    for (const slug of slugs) if (!roleIdBySlug[slug]) throw new Error(`Role '${slug}' not found in organisation ${organizationId}.`);

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
    const passwordHash = await hashPassword(PASSWORD);
    async function persona(label: string, roleSlug: string): Promise<SalesPersona> {
      const userId = crypto.randomUUID();
      const email = `e2e-mfg-${label}-${suffix}@crm-e2e-fixture.test`.toLowerCase();
      await client.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,$4,'active',now())`, [userId, email, `E2E Mfg ${label}`, passwordHash]);
      await client.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [organizationId, userId]);
      await client.query(`INSERT INTO public.user_role_assignments(organization_id,user_id,role_id,is_primary,status,starts_at) VALUES ($1,$2,$3,true,'active',now())`, [organizationId, userId, roleIdBySlug[roleSlug]]);
      await client.query(`INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES ($1,$2,$3)`, [organizationId, userId, companyId]);
      await client.query(`INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES ($1,$2,$3)`, [organizationId, userId, branchId]);
      return { email, password: PASSWORD, userId };
    }
    const manager = await persona("manager", "manufacturing_manager");
    const approver = await persona("approver", "manufacturing_manager");
    const viewer = await persona("viewer", "quality_manager");

    await client.query("BEGIN");
    await client.query(`SELECT set_config('app.current_organization_id', $1, true)`, [organizationId]);
    const uomId = (await client.query(`SELECT id FROM tenant.units_of_measure WHERE organization_id=$1 AND code='EA' AND status='active' LIMIT 1`, [organizationId])).rows[0].id;
    const made: Record<string, { id: string; code: string; name: string }> = {};
    for (const [key, tag] of [["finished", "FIN"], ["compA", "A"], ["compB", "B"], ["compC", "C"], ["sub", "SUB"], ["subPart", "SP"]] as const) {
      const id = crypto.randomUUID();
      const code = `MF-${tag}-${suffix}`;
      const name = `Mfg ${tag} ${suffix}`;
      await client.query(`INSERT INTO tenant.items(id,organization_id,company_id,code,name,item_type,uom_id,status,track_inventory) VALUES ($1,$2,$3,$4,$5,'product',$6,'active',true)`, [id, organizationId, companyId, code, name, uomId]);
      made[key] = { id, code, name };
    }
    const warehouse = { id: crypto.randomUUID(), code: `MFW-${suffix}`, name: `Mfg WH ${suffix}` };
    await client.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,$5,$6,'active')`, [warehouse.id, organizationId, companyId, branchId, warehouse.code, warehouse.name]);
    await client.query("COMMIT");
    return { organizationId, companyId, manager, approver, viewer, items: made as ManufacturingWorld["items"], warehouse, suffix };
  } finally {
    await client.end();
  }
}
