import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { Client } from "pg";

import { fixtures } from "./fixtures";
import { MIGRATION_DATABASE_URL } from "./pos-fixtures";

// Deterministic Sales E2E world: two genuinely separate users holding the real
// `sales_representative` (creates/sends) and `sales_manager` (approves) system roles (the seeded owner has no Sales permissions in this
// shared org, and a bypass role would prove nothing about the permission
// boundaries), plus a customer, tax category, price list and item of its own.
// Everything is created once per run with a unique suffix inside the existing
// shared organisation (switching organisations mid-suite is not a supported
// flow); nothing pre-existing is modified.
const PASSWORD = "SalesE2E!2026Secure";

export type SalesPersona = { email: string; password: string; userId: string };
export type SalesWorld = {
  organizationId: string;
  rep: SalesPersona;
  manager: SalesPersona;
  manager2: SalesPersona;
  customerName: string;
  itemName: string;
  itemCode: string;
  unitPrice: number;
  stockItemCode: string;
  stockItemName: string;
  warehouseCode: string;
};

let worldPromise: Promise<SalesWorld> | null = null;
export const getSalesWorld = () => (worldPromise ??= buildSalesWorld());

async function tenantTx<T>(client: Client, organizationId: string, fn: () => Promise<T>): Promise<T> {
  await client.query("BEGIN");
  try {
    await client.query(`SELECT set_config('app.current_organization_id', $1, true)`, [organizationId]);
    const result = await fn();
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function buildSalesWorld(): Promise<SalesWorld> {
  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();
  const { hashPassword } = await import("../../../services/api/src/core/auth/session.js");
  try {
    const owner = await client.query(`SELECT id FROM public.users WHERE email=$1`, [fixtures.ownerEmail]);
    const ownerUserId = owner.rows[0].id as string;
    const organizationId = (await client.query(`SELECT organization_id FROM organization_memberships WHERE user_id=$1 AND status='active' ORDER BY created_at LIMIT 1`, [ownerUserId])).rows[0].organization_id as string;
    const companyId = (await client.query(`SELECT id FROM public.companies WHERE organization_id=$1 AND is_primary=true LIMIT 1`, [organizationId])).rows[0].id as string;
    const branchId = (await client.query(`SELECT id FROM public.branches WHERE organization_id=$1 AND company_id=$2 ORDER BY created_at LIMIT 1`, [organizationId, companyId])).rows[0].id as string;
    const roles = await client.query(`SELECT slug,id FROM public.roles WHERE organization_id=$1 AND slug IN ('sales_manager','sales_representative')`, [organizationId]);
    const roleIdBySlug = Object.fromEntries(roles.rows.map((row) => [row.slug as string, row.id as string]));
    for (const slug of ["sales_manager", "sales_representative"]) if (!roleIdBySlug[slug]) throw new Error(`Role '${slug}' not found in organisation ${organizationId}.`);

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
    const passwordHash = await hashPassword(PASSWORD);
    async function createPersona(label: string, roleSlug: string): Promise<SalesPersona> {
      const userId = crypto.randomUUID();
      const email = `e2e-sales-${label}-${suffix}@crm-e2e-fixture.test`;
      await client.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,$4,'active',now())`, [userId, email, `E2E Sales ${label}`, passwordHash]);
      await client.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [organizationId, userId]);
      await client.query(`INSERT INTO public.user_role_assignments(organization_id,user_id,role_id,is_primary,status,starts_at) VALUES ($1,$2,$3,true,'active',now())`, [organizationId, userId, roleIdBySlug[roleSlug]]);
      await client.query(`INSERT INTO membership_company_access(organization_id,user_id,company_id) VALUES ($1,$2,$3)`, [organizationId, userId, companyId]);
      await client.query(`INSERT INTO membership_branch_access(organization_id,user_id,branch_id) VALUES ($1,$2,$3)`, [organizationId, userId, branchId]);
      return { email, password: PASSWORD, userId };
    }
    const rep = await createPersona("rep", "sales_representative");
    const manager = await createPersona("manager", "sales_manager");
    // A second approver: an amendment cannot be approved by whoever submitted it.
    const manager2 = await createPersona("manager2", "sales_manager");

    // A brand-new organisation gets its document numbering seeded by the platform;
    // this one predates the Sales module's series, so make sure they exist.

    const customerName = `Sales E2E Customer ${suffix}`;
    const itemName = "Sales E2E Widget";
    const itemCode = `E2E-SALES-${suffix}`;
    const unitPrice = 400;
    const stockItemCode = `E2E-STOCK-${suffix}`;
    const stockItemName = "Sales E2E Stocked Widget";
    const warehouseCode = `E2EWH-${suffix}`;
    const { postStockMovement } = await import("../../../services/api/src/index.js");
    await tenantTx(client, organizationId, async () => {
      const uomId = (await client.query(`SELECT id FROM tenant.units_of_measure WHERE organization_id=$1 AND code='EA' AND status='active' LIMIT 1`, [organizationId])).rows[0].id;
      const taxCategoryId = crypto.randomUUID();
      const priceListId = crypto.randomUUID();
      const itemId = crypto.randomUUID();
      const existingSettings = await client.query(`SELECT 1 FROM tenant.sales_settings WHERE organization_id=$1`, [organizationId]);
      if (!existingSettings.rows.length) await client.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [organizationId]);
      await client.query(`INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,$3,'Sales E2E GST','active')`, [taxCategoryId, organizationId, `SALESTAX-${suffix}`]);
      await client.query(`INSERT INTO tenant.tax_rates(id,organization_id,tax_category_id,name,code,tax_type,rate,status) VALUES ($1,$2,$3,'GST 18%',$4,'gst',18,'active')`, [crypto.randomUUID(), organizationId, taxCategoryId, `SGST18-${suffix}`]);
      await client.query(`INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,$3,'Sales E2E Price List','sales','INR',false,'active')`, [priceListId, organizationId, `SPL-${suffix}`]);
      await client.query(`INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,$3,$4,'product',$5,$6,$7,250,'active')`, [itemId, organizationId, itemCode, itemName, uomId, taxCategoryId, unitPrice]);
      await client.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,$4,'active')`, [organizationId, priceListId, itemId, unitPrice]);
      await client.query(`INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status,created_by) VALUES ($1,$2,$3,$4,'customer',$5,'active',$6)`, [crypto.randomUUID(), organizationId, companyId, `SCUST-${suffix}`, customerName, ownerUserId]);
      // A stock-tracked item with opening stock in its own warehouse, so delivery,
      // reservation and backorder flows run against real balances.
      const warehouseId = crypto.randomUUID();
      const stockItemId = crypto.randomUUID();
      await client.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,$5,'Sales E2E Warehouse','active')`, [warehouseId, organizationId, companyId, branchId, warehouseCode]);
      await client.query(`INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status,track_inventory) VALUES ($1,$2,$3,$4,'product',$5,$6,$7,250,'active',true)`, [stockItemId, organizationId, stockItemCode, stockItemName, uomId, taxCategoryId, unitPrice]);
      await client.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,$4,'active')`, [organizationId, priceListId, stockItemId, unitPrice]);
      await postStockMovement(client, { organizationId, companyId, userId: ownerUserId, roleSlugs: [], permissions: ["stock.receive", "stock.view"] }, { movementType: "receipt", itemId: stockItemId, warehouseId, quantity: 100, unitCost: 250, idempotencyKey: `e2e-open-${suffix}` });
    });

    return { organizationId, rep, manager, manager2, customerName, itemName, itemCode, unitPrice, stockItemCode, stockItemName, warehouseCode };
  } finally {
    await client.end();
  }
}

// The login endpoint is rate-limited (correctly: it answers 429 under a burst), and a
// full Sales run opens many sessions. Each persona therefore signs in through the
// real login form ONCE per process; later contexts reuse that session's cookies.
const sessions = new Map<string, Awaited<ReturnType<BrowserContext["storageState"]>>>();

export async function openSalesSession(browser: Browser, persona: SalesPersona): Promise<{ context: BrowserContext; page: Page }> {
  const saved = sessions.get(persona.email);
  if (saved) {
    const context = await browser.newContext({ storageState: saved });
    return { context, page: await context.newPage() };
  }
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  await page.goto("/login", { waitUntil: "load" });
  await page.getByLabel(/email/i).fill(persona.email);
  await page.getByLabel(/password/i).fill(persona.password);
  const [login] = await Promise.all([page.waitForResponse((res) => res.url().includes("/api/auth/login")), page.getByRole("button", { name: /sign in|log in/i }).click()]);
  expect(login.status(), "Sales persona login must succeed").toBe(200);
  sessions.set(persona.email, await context.storageState());
  return { context, page };
}
