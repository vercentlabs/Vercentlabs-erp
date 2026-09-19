// Real PostgreSQL integration test — F270/F271 terminal-level cashier
// eligibility (migration 128), the disclosed gap on top of F268-F273's own
// store-level tenant.pos_store_access: a cashier could be restricted to a
// STORE but never to a specific TERMINAL within one. terminal_id is
// nullable and additive (see migration 128's own comment) — a NULL row is
// the pre-existing store-wide grant, unaffected by anything here; this
// suite is entirely about the NEW narrower terminal-specific grant.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";

const adminConnectionString = process.env.MIGRATION_DATABASE_URL || "";

async function connectOrNull(connectionString) {
  if (!connectionString) return null;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

test("F270/F271: terminal-level cashier eligibility against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
    createPosCart,
    getPosCart,
    openShift,
    closeShift,
    grantPosStoreAccess,
    revokePosStoreAccess,
    listPosStoreAccess,
    listPointOfSaleResource,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const ownerUserId = randomUUID();
  const cashierId = randomUUID(); // will be granted terminal-1-only access
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const priceListId = randomUUID();
  const storeId = randomUUID();
  const terminal1Id = randomUUID();
  const terminal2Id = randomUUID();

  const cashierContext = { organizationId: orgId, companyId, userId: cashierId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create", "pos.shift.open", "pos.shift.close"] };
  const ownerContext = { organizationId: orgId, companyId, userId: ownerUserId, roleSlugs: ["organization_owner"], permissions: [] };
  const storeManagerContext = { organizationId: orgId, companyId, userId: ownerUserId, roleSlugs: [], permissions: ["pos.store.manage", "pos.view", "pos.shift.open"] };

  async function tx(fn) {
    await admin.query("BEGIN");
    try {
      await setTenantContext(admin, orgId);
      const result = await fn(admin);
      await admin.query("COMMIT");
      return result;
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
  }

  try {
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F270 Owner','x','active',now())`, [ownerUserId, `f270-owner-${ownerUserId}@test.invalid`]);
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F270 Cashier','x','active',now())`, [cashierId, `f270-cashier-${cashierId}@test.invalid`]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F270 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [orgId, `f270-org-${orgId}`, ownerUserId]);
    await admin.query(`INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F270 Co','F270 Co Pvt Ltd','F270CO','INR','IN',true,'active')`, [companyId, orgId]);
    await admin.query(`INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [branchId, orgId, companyId]);
    await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active'),($1,$3,'member','active') ON CONFLICT DO NOTHING`, [orgId, ownerUserId, cashierId]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
    await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,'WH1','Main WH','active')`, [warehouseId, orgId, companyId, branchId]);
    await admin.query(`INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`, [priceListId, orgId]);
    await admin.query(`INSERT INTO tenant.pos_settings(organization_id,company_id) VALUES ($1,$2)`, [orgId, companyId]);
    await admin.query(
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,price_list_id,currency_code,timezone,created_by) VALUES ($1,$2,$3,$4,'S1','Store 1',$5,$6,'INR','Asia/Kolkata',$7)`,
      [storeId, orgId, companyId, branchId, warehouseId, priceListId, ownerUserId],
    );
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T1','Terminal 1',$5)`, [terminal1Id, orgId, companyId, storeId, ownerUserId]);
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T2','Terminal 2',$5)`, [terminal2Id, orgId, companyId, storeId, ownerUserId]);

    // assertPosStoreAccess only enforces anything once the COMPANY has at
    // least one pos_store_access row at all ("permissive until
    // configured" — see shared/access-control.js). This standing grant
    // for the owner (who bypasses via roleSlugs anyway, so the row itself
    // is otherwise inert) keeps the company "opted in" for the whole test,
    // so later revoking the cashier's OWN grant tests real enforcement
    // rather than accidentally falling back to the unconfigured default.
    await admin.query(
      `INSERT INTO tenant.pos_store_access(organization_id,company_id,user_id,store_id,created_by) VALUES ($1,$2,$3,$4,$3)`,
      [orgId, companyId, ownerUserId, storeId],
    );

    let shift1;
    await t.test("F270: granting a cashier terminal-1-only access lets them open a shift on terminal 1", async () => {
      await tx((c) => grantPosStoreAccess(c, storeManagerContext, { userId: cashierId, storeId, terminalId: terminal1Id }));
      shift1 = await tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminal1Id, openingCash: 0, idempotencyKey: randomUUID() }));
      assert.equal(shift1.status, "open");
    });

    await t.test("F270 SECURITY: the same cashier cannot open a shift on terminal 2 at the SAME store they're otherwise eligible for", async () => {
      await assert.rejects(
        () => tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminal2Id, openingCash: 0, idempotencyKey: randomUUID() })),
        (error) => error.code === "POS_TERMINAL_ACCESS_DENIED",
      );
    });

    let cart1;
    await t.test("F270: the cashier can create a cart on their granted terminal", async () => {
      cart1 = await tx((c) => createPosCart(c, cashierContext, { storeId, terminalId: terminal1Id, shiftId: shift1.id }));
      assert.equal(cart1.terminal_id, terminal1Id);
    });

    await t.test("F270 SECURITY: mid-shift revocation takes effect on the very next action, not just future shift-opens", async () => {
      // Prove the cart is readable before revocation (sanity), then revoke
      // terminal-1 access and prove the SAME cart is immediately denied --
      // the "existing sessions" requirement: there is no server-side
      // session cache to invalidate, every call re-checks fresh.
      const before = await tx((c) => getPosCart(c, cashierContext, cart1.id));
      assert.equal(before.id, cart1.id);

      await tx((c) => revokePosStoreAccess(c, storeManagerContext, { userId: cashierId, storeId, terminalId: terminal1Id }));

      await assert.rejects(
        () => tx((c) => getPosCart(c, cashierContext, cart1.id)),
        (error) => error.code === "POS_STORE_ACCESS_DENIED",
      );
      await assert.rejects(
        () => tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminal1Id, openingCash: 0, idempotencyKey: randomUUID() })),
        (error) => error.code === "POS_STORE_ACCESS_DENIED",
      );

      // Restore for the remaining tests.
      await tx((c) => grantPosStoreAccess(c, storeManagerContext, { userId: cashierId, storeId, terminalId: terminal1Id }));
    });

    await t.test("F270: a store-wide grant covers every terminal at that store, including one only ever granted per-terminal elsewhere", async () => {
      await tx((c) => grantPosStoreAccess(c, storeManagerContext, { userId: cashierId, storeId }));
      const shift2 = await tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminal2Id, openingCash: 0, idempotencyKey: randomUUID() }));
      assert.equal(shift2.status, "open");
      await tx((c) => closeShift(c, cashierContext, shift2.id, { countedCash: 0 }));
      // Remove the store-wide grant again so later assertions are back to
      // terminal-1-only.
      await tx((c) => revokePosStoreAccess(c, storeManagerContext, { userId: cashierId, storeId }));
    });

    await t.test("F270: listPosStoreAccess reports the terminal-specific grant with a resolved terminal name, not just an id", async () => {
      const rows = await tx((c) => listPosStoreAccess(c, storeManagerContext, storeId));
      const grant = rows.find((row) => row.userId === cashierId && row.terminalId === terminal1Id);
      assert.ok(grant, "expected a terminal-1-specific grant row");
      assert.equal(grant.terminalName, "Terminal 1");
    });

    await t.test("F270: listPointOfSaleResource('terminals') is narrowed to the granted terminal once a terminal-specific grant exists", async () => {
      const rows = await tx((c) => listPointOfSaleResource(c, cashierContext, "terminals"));
      const ids = rows.map((row) => row.id);
      assert.ok(ids.includes(terminal1Id));
      assert.ok(!ids.includes(terminal2Id), "terminal 2 should not be visible to a cashier restricted to terminal 1");
    });

    await t.test("F270: organization_owner always bypasses terminal-level restriction, same as store-level", async () => {
      const shift = await tx((c) => openShift(c, ownerContext, { storeId, terminalId: terminal2Id, cashierUserId: ownerUserId, openingCash: 0, idempotencyKey: randomUUID() }));
      assert.equal(shift.status, "open");
      await tx((c) => closeShift(c, ownerContext, shift.id, { countedCash: 0 }));
    });

    await t.test("F270 SECURITY: opening a shift on behalf of a cashier who is only eligible for a DIFFERENT terminal is rejected", async () => {
      await assert.rejects(
        () =>
          tx((c) =>
            openShift(c, storeManagerContext, { storeId, terminalId: terminal2Id, cashierUserId: cashierId, openingCash: 0, idempotencyKey: randomUUID() }),
          ),
        (error) => error.code === "POS_TERMINAL_ACCESS_DENIED",
      );
    });
  } finally {
    for (const table of [
      "operation_idempotency",
      "pos_events",
      "pos_cart_lines",
      "pos_carts",
      "pos_cash_movements",
      "pos_shifts",
      "pos_store_access",
      "pos_terminals",
      "pos_stores",
      "pos_settings",
      "price_lists",
      "warehouses",
      "currencies",
    ]) {
      await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    }
    await admin.query(`DELETE FROM public.organization_memberships WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[ownerUserId, cashierId]]).catch(() => undefined);
    await admin.end();
  }
});
