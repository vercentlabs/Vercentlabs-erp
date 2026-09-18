import fs from "node:fs";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { Client } from "pg";

import { fixtures } from "./fixtures";

// Deterministic POS E2E world-builder.
//
// Why this exists (see the task brief this suite was built against): the
// seeded E2E owner (fixtures.ownerEmail) is `organization_owner`, which
// bypasses every permission check -- fine for most CRM specs, but useless
// for proving POS's real role boundaries (pos_cashier cannot discount,
// pos_supervisor cannot approve their own discount request, store access
// is enforced once configured, etc). It is also a bad fit for shift/cart
// determinism: by the time this suite was written, manual browser testing
// done DURING POS's own development had already left the owner user with
// multiple open `tenant.pos_shifts` rows against leftover "Smoke Test
// Store" rows in the shared `CRM E2E Fixture Org` -- PosCheckoutScreen
// resolves "my open shift" as `shiftsQuery.data.rows.find(status===open &&
// cashier_user_id===me)`, so a second open shift for the same user makes
// which store/terminal a test lands on non-deterministic.
//
// Instead, this module provisions three GENUINE, separately-authenticated
// users (pos_cashier / pos_supervisor / pos_manager -- the exact system
// roles in packages/permissions/src/roles.js, already present in this org
// per public.roles) plus a dedicated store/terminal/warehouse/price
// list/tax category/item, all inside the SAME existing organization the
// owner already belongs to (switching a session to a brand-new
// organization mid-suite isn't a supported flow, and isn't worth building
// just for this). Every persona is brand new, so none of them inherit any
// pre-existing open shift -- the only open shift for a persona is the one
// this module opens for them.
//
// Every id this module creates is written to e2e/.pos-world.json so
// e2e/pos-global-teardown.ts (registered in playwright.config.ts) can
// delete precisely those rows once, after the whole `playwright test`
// invocation finishes -- regardless of which POS spec files actually ran.
// Nothing here ever deletes by organization_id (unlike the throwaway-org
// integration tests), because this org is shared, real, and already used
// by other E2E specs.

export const MIGRATION_DATABASE_URL =
  process.env.MIGRATION_DATABASE_URL ||
  "postgresql://vercentlabs:vercentlabs_local_password@localhost:5433/vercentlabs_control";

const MARKER_PATH = path.resolve(process.cwd(), "e2e/.pos-world.json");
const PERSONA_PASSWORD = "PosE2E!2026Secure";

export type PosPersona = { email: string; password: string; userId: string };

export type PosWorld = {
  organizationId: string;
  companyId: string;
  branchId: string;
  currencyCode: string;
  storeId: string;
  storeCode: string;
  storeName: string;
  terminalId: string;
  secondStoreId: string;
  secondTerminalId: string;
  supervisorStoreId: string;
  supervisorTerminalId: string;
  supervisorShiftId: string;
  warehouseId: string;
  priceListId: string;
  taxCategoryId: string;
  itemId: string;
  itemCode: string;
  itemName: string;
  unitPrice: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  shiftId: string;
  cashier: PosPersona;
  supervisor: PosPersona;
  manager: PosPersona;
};

type MarkerFile = {
  world: PosWorld;
  cleanup: {
    storeIds: string[];
    warehouseId: string;
    taxCategoryId: string;
    taxRateId: string;
    priceListId: string;
    itemId: string;
    customerId: string;
    userIds: string[];
  };
};

async function tx<T>(client: Client, organizationId: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const { setTenantContext } = await import("../../../packages/database/src/index.js");
  await client.query("BEGIN");
  try {
    await setTenantContext(client, organizationId);
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

let cached: Promise<PosWorld> | null = null;

/** Lazily seeds the whole POS E2E world exactly once per test run (module
 * singleton -- safe because playwright.config.ts runs this suite with
 * `workers: 1`, so every spec file that imports this module shares the
 * same Node process). */
export function getPosWorld(): Promise<PosWorld> {
  if (!cached) cached = buildPosWorld();
  return cached;
}

async function buildPosWorld(): Promise<PosWorld> {
  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();

  const { hashPassword } = await import("../../../services/api/src/core/session.js");
  const { openShift } = await import("../../../services/api/src/index.js");

  try {
    const ownerRes = await client.query(`SELECT id FROM public.users WHERE email = $1`, [fixtures.ownerEmail]);
    if (!ownerRes.rows[0]) throw new Error(`Seeded E2E owner ${fixtures.ownerEmail} not found -- has .env.e2e.local been bootstrapped?`);
    const ownerUserId = ownerRes.rows[0].id as string;

    const membershipRes = await client.query(
      `SELECT organization_id FROM organization_memberships WHERE user_id = $1 AND status = 'active' ORDER BY created_at ASC LIMIT 1`,
      [ownerUserId],
    );
    const organizationId = membershipRes.rows[0].organization_id as string;

    const companyRes = await client.query(`SELECT id FROM public.companies WHERE organization_id = $1 AND is_primary = true LIMIT 1`, [organizationId]);
    const companyId = companyRes.rows[0].id as string;

    const branchRes = await client.query(
      `SELECT id FROM public.branches WHERE organization_id = $1 AND company_id = $2 ORDER BY created_at ASC LIMIT 1`,
      [organizationId, companyId],
    );
    const branchId = branchRes.rows[0].id as string;

    const roleRes = await client.query(
      `SELECT slug, id FROM public.roles WHERE organization_id = $1 AND slug IN ('pos_cashier','pos_supervisor','pos_manager')`,
      [organizationId],
    );
    const roleIdBySlug = Object.fromEntries(roleRes.rows.map((r) => [r.slug as string, r.id as string]));
    for (const slug of ["pos_cashier", "pos_supervisor", "pos_manager"]) {
      if (!roleIdBySlug[slug]) throw new Error(`Role '${slug}' not found in organization ${organizationId} -- expected a pre-provisioned system role.`);
    }

    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const passwordHash = await hashPassword(PERSONA_PASSWORD);

    async function createPersona(label: "cashier" | "supervisor" | "manager", roleSlug: string): Promise<PosPersona> {
      const userId = crypto.randomUUID();
      const email = `e2e-pos-${label}-${suffix}@crm-e2e-fixture.test`;
      await client.query(
        `INSERT INTO public.users(id, email, full_name, password_hash, status, email_verified_at) VALUES ($1,$2,$3,$4,'active',now())`,
        [userId, email, `E2E POS ${label[0].toUpperCase()}${label.slice(1)}`, passwordHash],
      );
      await client.query(`INSERT INTO organization_memberships(organization_id, user_id, role, status) VALUES ($1,$2,'member','active')`, [organizationId, userId]);
      await client.query(
        `INSERT INTO public.user_role_assignments(organization_id, user_id, role_id, is_primary, status, starts_at) VALUES ($1,$2,$3,true,'active',now())`,
        [organizationId, userId, roleIdBySlug[roleSlug]],
      );
      await client.query(`INSERT INTO membership_company_access(organization_id, user_id, company_id) VALUES ($1,$2,$3)`, [organizationId, userId, companyId]);
      await client.query(`INSERT INTO membership_branch_access(organization_id, user_id, branch_id) VALUES ($1,$2,$3)`, [organizationId, userId, branchId]);
      return { email, password: PERSONA_PASSWORD, userId };
    }

    const cashier = await createPersona("cashier", "pos_cashier");
    const supervisor = await createPersona("supervisor", "pos_supervisor");
    const manager = await createPersona("manager", "pos_manager");

    // Ensure GST place-of-supply resolution is deterministic (intra-state
    // CGST+SGST, matching tests/integration/pos-cart-tax-promotions-
    // coupons-f277-f281.test.mjs's own expectation) -- additive only, this
    // org had no tenant.sales_settings row at all before this suite ran,
    // so there is nothing to preserve/restore and nothing else in this
    // shared org depends on its absence.
    const existingSalesSettings = await tx(client, organizationId, (c) => c.query(`SELECT 1 FROM tenant.sales_settings WHERE organization_id = $1`, [organizationId]));
    if (existingSalesSettings.rows.length === 0) {
      await tx(client, organizationId, (c) => c.query(`INSERT INTO tenant.sales_settings(organization_id, seller_state_code) VALUES ($1,'KA')`, [organizationId]));
    }

    const warehouseId = crypto.randomUUID();
    const taxCategoryId = crypto.randomUUID();
    const taxRateId = crypto.randomUUID();
    const priceListId = crypto.randomUUID();
    const itemId = crypto.randomUUID();
    const itemCode = `E2E-POS-ITEM-${suffix}`;
    const itemName = "POS E2E Widget";
    const unitPrice = "250.0000";
    const storeId = crypto.randomUUID();
    const storeCode = `E2E-POS-${suffix}`;
    const storeName = "POS E2E Store";
    const terminalId = crypto.randomUUID();
    const secondStoreId = crypto.randomUUID();
    const secondStoreCode = `E2E-POS-2-${suffix}`;
    const secondTerminalId = crypto.randomUUID();
    const supervisorStoreId = crypto.randomUUID();
    const supervisorStoreCode = `E2E-POS-SUP-${suffix}`;
    const supervisorTerminalId = crypto.randomUUID();
    const customerId = crypto.randomUUID();
    const customerName = `POS E2E Customer ${suffix}`;
    const customerPhone = `9${String(Math.floor(Math.random() * 1_000_000_000)).padStart(9, "0")}`;

    await tx(client, organizationId, async (c) => {
      const uomRes = await c.query(`SELECT id FROM tenant.units_of_measure WHERE organization_id = $1 AND code = 'EA' AND status = 'active' LIMIT 1`, [organizationId]);
      const uomId = uomRes.rows[0].id as string;

      await c.query(
        `INSERT INTO tenant.warehouses(id, organization_id, company_id, branch_id, code, name, status) VALUES ($1,$2,$3,$4,$5,$6,'active')`,
        [warehouseId, organizationId, companyId, branchId, `WH-${suffix}`, "POS E2E Warehouse"],
      );
      await c.query(`INSERT INTO tenant.tax_categories(id, organization_id, code, name, status) VALUES ($1,$2,$3,'POS E2E GST','active')`, [
        taxCategoryId,
        organizationId,
        `TAXCAT-${suffix}`,
      ]);
      await c.query(
        `INSERT INTO tenant.tax_rates(id, organization_id, tax_category_id, name, code, tax_type, rate, status) VALUES ($1,$2,$3,'GST 18%',$4,'gst',18,'active')`,
        [taxRateId, organizationId, taxCategoryId, `GST18-${suffix}`],
      );
      await c.query(
        `INSERT INTO tenant.price_lists(id, organization_id, code, name, price_list_type, currency_code, tax_inclusive, status) VALUES ($1,$2,$3,'POS E2E Price List','sales','INR',false,'active')`,
        [priceListId, organizationId, `PL-${suffix}`],
      );
      await c.query(
        `INSERT INTO tenant.items(id, organization_id, code, name, item_type, uom_id, tax_category_id, sales_price, standard_cost, status)
         VALUES ($1,$2,$3,$4,'product',$5,$6,$7,100,'active')`,
        [itemId, organizationId, itemCode, itemName, uomId, taxCategoryId, unitPrice],
      );
      await c.query(
        `INSERT INTO tenant.price_list_items(organization_id, price_list_id, item_id, minimum_quantity, rate, status) VALUES ($1,$2,$3,1,$4,'active')`,
        [organizationId, priceListId, itemId, unitPrice],
      );
      await c.query(
        `INSERT INTO tenant.stock_balances(organization_id, company_id, item_id, warehouse_id, quantity, reserved_quantity, average_cost) VALUES ($1,$2,$3,$4,1000,0,100)`,
        [organizationId, companyId, itemId, warehouseId],
      );
      await c.query(
        `INSERT INTO tenant.pos_stores(id, organization_id, company_id, branch_id, code, name, warehouse_id, price_list_id, currency_code, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'INR',$9)`,
        [storeId, organizationId, companyId, branchId, storeCode, storeName, warehouseId, priceListId, ownerUserId],
      );
      await c.query(`INSERT INTO tenant.pos_terminals(id, organization_id, company_id, store_id, code, name, created_by) VALUES ($1,$2,$3,$4,'T1','Terminal 1',$5)`, [
        terminalId,
        organizationId,
        companyId,
        storeId,
        ownerUserId,
      ]);
      // A second store, used only by the store-access-denial journey -- no
      // pos_store_access rows exist for this org yet, so access is
      // unrestricted by default until a test opts in for just that case.
      await c.query(
        `INSERT INTO tenant.pos_stores(id, organization_id, company_id, branch_id, code, name, warehouse_id, price_list_id, currency_code, created_by)
         VALUES ($1,$2,$3,$4,$5,'POS E2E Store 2',$6,$7,'INR',$8)`,
        [secondStoreId, organizationId, companyId, branchId, secondStoreCode, warehouseId, priceListId, ownerUserId],
      );
      await c.query(`INSERT INTO tenant.pos_terminals(id, organization_id, company_id, store_id, code, name, created_by) VALUES ($1,$2,$3,$4,'T1','Terminal 1',$5)`, [
        secondTerminalId,
        organizationId,
        companyId,
        secondStoreId,
        ownerUserId,
      ]);
      // A third store, dedicated to the supervisor persona -- discount-
      // approval journeys need the supervisor to hold their own cart/
      // shift, entirely separate from the cashier's, so neither journey's
      // cart state can collide with the other's.
      await c.query(
        `INSERT INTO tenant.pos_stores(id, organization_id, company_id, branch_id, code, name, warehouse_id, price_list_id, currency_code, created_by)
         VALUES ($1,$2,$3,$4,$5,'POS E2E Supervisor Store',$6,$7,'INR',$8)`,
        [supervisorStoreId, organizationId, companyId, branchId, supervisorStoreCode, warehouseId, priceListId, ownerUserId],
      );
      await c.query(`INSERT INTO tenant.pos_terminals(id, organization_id, company_id, store_id, code, name, created_by) VALUES ($1,$2,$3,$4,'T1','Terminal 1',$5)`, [
        supervisorTerminalId,
        organizationId,
        companyId,
        supervisorStoreId,
        ownerUserId,
      ]);
      await c.query(
        `INSERT INTO tenant.business_parties(id, organization_id, company_id, code, party_type, display_name, status, currency_code, phone, created_by)
         VALUES ($1,$2,$3,$4,'customer',$5,'active','INR',$6,$7)`,
        [customerId, organizationId, companyId, `CUST-${suffix}`, customerName, customerPhone, ownerUserId],
      );
      // tenant.pos_store_access: as soon as ANY row exists for this
      // company, store-level access enforcement flips ON company-wide
      // (tests/integration/pos-store-access-f268-f273.test.mjs) -- so both
      // grants are inserted together, up front, before any persona ever
      // opens a shift. cashier is scoped to `storeId` only, supervisor to
      // `supervisorStoreId` only; `secondStoreId` is deliberately left
      // ungranted to anyone (organization_owner/pos.store.manage aside) --
      // it exists purely so pos-authorization.spec.ts can prove cashier is
      // denied on a store they were never assigned to. pos_manager always
      // bypasses via pos.store.manage, so the manager persona needs no
      // grant at all.
      await c.query(`INSERT INTO tenant.pos_store_access(organization_id, company_id, user_id, store_id, created_by) VALUES ($1,$2,$3,$4,$5)`, [
        organizationId,
        companyId,
        cashier.userId,
        storeId,
        ownerUserId,
      ]);
      await c.query(`INSERT INTO tenant.pos_store_access(organization_id, company_id, user_id, store_id, created_by) VALUES ($1,$2,$3,$4,$5)`, [
        organizationId,
        companyId,
        supervisor.userId,
        supervisorStoreId,
        ownerUserId,
      ]);
    });

    const shift = await tx(client, organizationId, (c) =>
      openShift(c, { organizationId, companyId, userId: cashier.userId, roleSlugs: [], permissions: ["pos.view", "pos.shift.open"] }, {
        storeId,
        terminalId,
        openingCash: 500,
      }),
    );
    const supervisorShift = await tx(client, organizationId, (c) =>
      openShift(c, { organizationId, companyId, userId: supervisor.userId, roleSlugs: [], permissions: ["pos.view", "pos.shift.open"] }, {
        storeId: supervisorStoreId,
        terminalId: supervisorTerminalId,
        openingCash: 500,
      }),
    );

    const world: PosWorld = {
      organizationId,
      companyId,
      branchId,
      currencyCode: "INR",
      storeId,
      storeCode,
      storeName,
      terminalId,
      secondStoreId,
      secondTerminalId,
      supervisorStoreId,
      supervisorTerminalId,
      supervisorShiftId: supervisorShift.id,
      warehouseId,
      priceListId,
      taxCategoryId,
      itemId,
      itemCode,
      itemName,
      unitPrice,
      customerId,
      customerName,
      customerPhone,
      shiftId: shift.id,
      cashier,
      supervisor,
      manager,
    };

    const marker: MarkerFile = {
      world,
      cleanup: {
        storeIds: [storeId, secondStoreId, supervisorStoreId],
        warehouseId,
        taxCategoryId,
        taxRateId,
        priceListId,
        itemId,
        customerId,
        userIds: [cashier.userId, supervisor.userId, manager.userId],
      },
    };
    fs.mkdirSync(path.dirname(MARKER_PATH), { recursive: true });
    fs.writeFileSync(MARKER_PATH, JSON.stringify(marker, null, 2));

    return world;
  } finally {
    await client.end();
  }
}

// ---- Persona login -------------------------------------------------------
//
// Real, page-driven login (same mechanics as
// restricted-role-authorization.spec.ts's `login()`), memoized per persona
// email so each of the 3 personas logs in at most once for the whole run
// (login is rate-limited at 10/300s/IP -- see that file's own comment).
// Every test gets its OWN fresh BrowserContext seeded from the memoized
// storageState, so cart/UI state never leaks between tests even though the
// login itself is shared.

const storageStateCache = new Map<string, Promise<Awaited<ReturnType<BrowserContext["storageState"]>>>>();

async function loginAndCaptureStorageState(browser: Browser, email: string, password: string) {
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  try {
    await page.goto("/login", { waitUntil: "load" });
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    const [loginResponse] = await Promise.all([
      page.waitForResponse((res) => res.url().includes("/api/auth/login")),
      page.getByRole("button", { name: /sign in|log in/i }).click(),
    ]);
    expect(loginResponse.status(), `login for ${email} must succeed (not rate-limited)`).toBe(200);
    await page.goto("/pos", { waitUntil: "domcontentloaded" });
    return await context.storageState();
  } finally {
    await context.close();
  }
}

export function getPersonaStorageState(browser: Browser, persona: PosPersona) {
  const cacheKey = persona.email;
  let entry = storageStateCache.get(cacheKey);
  if (!entry) {
    entry = loginAndCaptureStorageState(browser, persona.email, persona.password);
    storageStateCache.set(cacheKey, entry);
  }
  return entry;
}

/** Opens a fresh, isolated context+page authenticated as `persona`. Caller
 * is responsible for closing the returned context. */
export async function openPersonaSession(
  browser: Browser,
  persona: PosPersona,
  options: { viewport?: { width: number; height: number } } = {},
): Promise<{ context: BrowserContext; page: Page }> {
  const storageState = await getPersonaStorageState(browser, persona);
  const context = await browser.newContext({ storageState, viewport: options.viewport });
  const page = await context.newPage();
  return { context, page };
}

/** Runs `fn` with a fresh, tenant-scoped Postgres client for direct
 * assertions against real rows (never through the app's own HTTP/domain
 * layer) -- e.g. "exactly one pos_sales row exists," "stock_balances
 * decremented by exactly N." Always closes the connection afterward. */
export async function withPosDb<T>(fn: (client: Client, organizationId: string) => Promise<T>): Promise<T> {
  const world = await getPosWorld();
  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    const { setTenantContext } = await import("../../../packages/database/src/index.js");
    await setTenantContext(client, world.organizationId);
    return await fn(client, world.organizationId);
  } finally {
    await client.end();
  }
}

// ---- Terminal reset -------------------------------------------------------
//
// Every spec file below reuses one of the world's small, fixed set of
// dedicated terminals (`workers: 1` means test FILES run one after another
// in this same Node process, but Playwright does not guarantee they run in
// source order). `tenant.pos_carts_one_active_per_terminal_uidx` allows
// only one draft/priced/held cart per terminal at a time, so any spec that
// needs to start from a genuinely empty cart calls this first -- a direct,
// targeted SQL cancel of whatever's left on that one terminal from a
// previous file, not a destructive reset of anything else in the shared
// org. This never touches ALREADY-COMPLETED sales/carts (nothing to reset
// there) -- only carts still in an active state.
export async function resetTerminalCarts(terminalId: string): Promise<void> {
  const world = await getPosWorld();
  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();
  try {
    const { setTenantContext } = await import("../../../packages/database/src/index.js");
    await client.query("BEGIN");
    await setTenantContext(client, world.organizationId);
    await client.query(
      `UPDATE tenant.pos_carts SET status='cancelled', cancelled_at=now(), cancel_reason='e2e terminal reset'
       WHERE terminal_id=$1 AND status IN ('draft','priced','held')`,
      [terminalId],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}
