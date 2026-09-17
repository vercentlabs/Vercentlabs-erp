// Real PostgreSQL integration test — POS consolidated pass, F268-F271
// store/terminal/cashier administration: updatePosStore/setPosStoreActive/
// updatePosTerminal/setPosTerminalStatus/listPosEligibleCashiers/
// grantPosStoreAccess/revokePosStoreAccess. Covers both the ordinary edit
// path and the "safe handling when active shifts/carts exist" guard the
// consolidated-pass brief specifically calls out -- these are NOT
// re-derived client-side; the server itself must refuse an unsafe
// transition.
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

test("F268-F271: store/terminal/cashier administration against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const {
    createStore,
    updatePosStore,
    setPosStoreActive,
    createTerminal,
    updatePosTerminal,
    setPosTerminalStatus,
    openShift,
    createPosCart,
    listPosEligibleCashiers,
    grantPosStoreAccess,
    revokePosStoreAccess,
  } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const managerId = randomUUID();
  const cashierId = randomUUID();
  const unrelatedUserId = randomUUID(); // active member, but holds no POS role -- must never appear as an eligible cashier
  const companyId = randomUUID();
  const branchId = randomUUID();
  const branch2Id = randomUUID();
  const warehouseId = randomUUID();
  const warehouse2Id = randomUUID();
  const priceListId = randomUUID();

  const managerContext = { organizationId: orgId, companyId, userId: managerId, roleSlugs: [], permissions: ["pos.view", "pos.store.manage", "pos.terminal.manage", "pos.shift.open"] };
  const cashierContext = { organizationId: orgId, companyId, userId: cashierId, roleSlugs: [], permissions: ["pos.view", "pos.sale.create", "pos.shift.open"] };

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

  let posManagerRoleId;
  let posCashierRoleId;

  try {
    for (const [id, name] of [
      [managerId, "F268 Manager"],
      [cashierId, "F268 Admin Cashier"],
      [unrelatedUserId, "F268 Unrelated Member"],
    ]) {
      await admin.query(
        `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`,
        [id, `f268admin-${id}@test.invalid`, name],
      );
    }
    await admin.query(
      `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F268 Admin Test Org',$2,'IN','Asia/Kolkata','INR',$3)`,
      [orgId, `f268admin-org-${orgId}`, managerId],
    );
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F268 Co','F268 Co Pvt Ltd','F268ACO','INR','IN',true,'active')`,
      [companyId, orgId],
    );
    for (const [id, code] of [
      [branchId, "HQ"],
      [branch2Id, "BR2"],
    ]) {
      await admin.query(`INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,$4,$4,'Asia/Kolkata','active')`, [
        id,
        orgId,
        companyId,
        code,
      ]);
    }
    // Active org memberships -- required for listPosEligibleCashiers /
    // grantPosStoreAccess's "is this a real active member" check.
    for (const id of [managerId, cashierId, unrelatedUserId]) {
      await admin.query(`INSERT INTO public.organization_memberships(organization_id,user_id,role,status) VALUES ($1,$2,'member','active')`, [orgId, id]);
    }
    // Real POS role assignments -- listPosEligibleCashiers must derive
    // eligibility from these, not a hand-picked allowlist.
    const managerRole = await admin.query(
      `INSERT INTO roles(organization_id,name,slug,description,is_system,module_key,assignable,risk_level,status) VALUES ($1,'Store Manager','pos_manager_f268','test','false','point-of-sale',true,'sensitive','active') RETURNING id`,
      [orgId],
    );
    posManagerRoleId = managerRole.rows[0].id;
    const cashierRole = await admin.query(
      `INSERT INTO roles(organization_id,name,slug,description,is_system,module_key,assignable,risk_level,status) VALUES ($1,'Cashier','pos_cashier_f268','test','false','point-of-sale',true,'standard','active') RETURNING id`,
      [orgId],
    );
    posCashierRoleId = cashierRole.rows[0].id;
    await admin.query(`INSERT INTO public.user_role_assignments(organization_id,user_id,role_id,status,starts_at) VALUES ($1,$2,$3,'active',now())`, [
      orgId,
      managerId,
      posManagerRoleId,
    ]);
    await admin.query(`INSERT INTO public.user_role_assignments(organization_id,user_id,role_id,status,starts_at) VALUES ($1,$2,$3,'active',now())`, [
      orgId,
      cashierId,
      posCashierRoleId,
    ]);

    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
    for (const [id, code] of [
      [warehouseId, "WHA"],
      [warehouse2Id, "WHB"],
    ]) {
      await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,$5,$5,'active')`, [
        id,
        orgId,
        companyId,
        branchId,
        code,
      ]);
    }
    await admin.query(
      `INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`,
      [priceListId, orgId],
    );
    await admin.query(`INSERT INTO tenant.pos_settings(organization_id,company_id) VALUES ($1,$2)`, [orgId, companyId]);

    let store;
    await t.test("F268: createStore/updatePosStore -- edit descriptive fields freely", async () => {
      store = await tx((c) => createStore(c, managerContext, { branchId, warehouseId, code: "SA", name: "Store A", priceListId, currencyCode: "INR" }));
      assert.equal(store.active, true);
      const updated = await tx((c) => updatePosStore(c, managerContext, store.id, { name: "Store A Renamed", timezone: "Asia/Kolkata" }));
      assert.equal(updated.name, "Store A Renamed");
    });

    let terminal;
    let shift;
    await t.test("F268/F269: deactivating a store or reassigning a terminal is blocked while a shift is open, allowed once it's closed", async () => {
      terminal = await tx((c) => createTerminal(c, managerContext, { storeId: store.id, code: "T1", name: "Terminal 1" }));
      shift = await tx((c) => openShift(c, cashierContext, { storeId: store.id, terminalId: terminal.id, openingCash: 0 }));

      await assert.rejects(() => tx((c) => setPosStoreActive(c, managerContext, store.id, false)), (error) => error.code === "POS_STORE_HAS_OPEN_SHIFT");
      await assert.rejects(
        () => tx((c) => updatePosStore(c, managerContext, store.id, { warehouseId: warehouse2Id })),
        (error) => error.code === "POS_STORE_UNSAFE_TRANSITION",
      );

      const store2 = await tx((c) => createStore(c, managerContext, { branchId: branch2Id, warehouseId: warehouse2Id, code: "SB", name: "Store B", currencyCode: "INR" }));
      await assert.rejects(
        () => tx((c) => updatePosTerminal(c, managerContext, terminal.id, { storeId: store2.id })),
        (error) => error.code === "POS_TERMINAL_UNSAFE_TRANSITION",
      );
      await assert.rejects(
        () => tx((c) => setPosTerminalStatus(c, managerContext, terminal.id, "maintenance")),
        (error) => error.code === "POS_TERMINAL_HAS_OPEN_SHIFT",
      );

      // Close the shift by cancelling any cart and marking it closed directly
      // (closeShift needs countedCash reconciliation, orthogonal to this test).
      await admin.query(`UPDATE tenant.pos_shifts SET status='closed' WHERE id=$1`, [shift.id]);

      const deactivated = await tx((c) => setPosStoreActive(c, managerContext, store.id, false));
      assert.equal(deactivated.active, false);
      const reactivated = await tx((c) => setPosStoreActive(c, managerContext, store.id, true));
      assert.equal(reactivated.active, true);

      const statusChanged = await tx((c) => setPosTerminalStatus(c, managerContext, terminal.id, "maintenance"));
      assert.equal(statusChanged.status, "maintenance");
      await tx((c) => setPosTerminalStatus(c, managerContext, terminal.id, "active"));
    });

    await t.test("F268: a store with an active (non-shift) cart also blocks deactivation", async () => {
      const shift2 = await tx((c) => openShift(c, cashierContext, { storeId: store.id, terminalId: terminal.id, openingCash: 0 }));
      await admin.query(`UPDATE tenant.pos_shifts SET status='closed' WHERE id=$1`, [shift2.id]);
      // Reopen a fresh shift so createPosCart has a valid open shift, then
      // close JUST the shift row (simulating a cart that outlived its
      // shift's own closure is unrealistic in practice, but the guard must
      // still catch a live cart directly) -- simpler: keep the shift open,
      // prove the cart guard fires even independent of the shift guard by
      // checking cart status specifically.
      const shift3 = await tx((c) => openShift(c, cashierContext, { storeId: store.id, terminalId: terminal.id, openingCash: 0 }));
      await tx((c) => createPosCart(c, cashierContext, { storeId: store.id, terminalId: terminal.id, shiftId: shift3.id }));
      await assert.rejects(() => tx((c) => setPosStoreActive(c, managerContext, store.id, false)), (error) => error.code === "POS_STORE_HAS_OPEN_SHIFT");
      await admin.query(`UPDATE tenant.pos_shifts SET status='closed' WHERE id=$1`, [shift3.id]);
      await assert.rejects(() => tx((c) => setPosStoreActive(c, managerContext, store.id, false)), (error) => error.code === "POS_STORE_HAS_ACTIVE_CART");
      await admin.query(`UPDATE tenant.pos_carts SET status='cancelled' WHERE organization_id=$1 AND store_id=$2`, [orgId, store.id]);
      const deactivated = await tx((c) => setPosStoreActive(c, managerContext, store.id, false));
      assert.equal(deactivated.active, false);
      await tx((c) => setPosStoreActive(c, managerContext, store.id, true));
    });

    await t.test("F270/F271: listPosEligibleCashiers only returns active members holding a real POS role, never an arbitrary/unrelated member", async () => {
      const eligible = await tx((c) => listPosEligibleCashiers(c, managerContext));
      const ids = eligible.map((row) => row.id);
      assert.ok(ids.includes(managerId));
      assert.ok(ids.includes(cashierId));
      assert.ok(!ids.includes(unrelatedUserId), "a member with no POS role must never be listed as an eligible cashier");
    });

    await t.test("F270: grantPosStoreAccess/revokePosStoreAccess manage real assignment rows, and reject a non-member/fabricated user id", async () => {
      await assert.rejects(
        () => tx((c) => grantPosStoreAccess(c, managerContext, { userId: randomUUID(), storeId: store.id })),
        (error) => error.code === "POS_STORE_ACCESS_USER_INVALID",
      );
      const granted = await tx((c) => grantPosStoreAccess(c, managerContext, { userId: cashierId, storeId: store.id }));
      assert.equal(granted.user_id, cashierId);
      const eligible = await tx((c) => listPosEligibleCashiers(c, managerContext));
      const cashierRow = eligible.find((row) => row.id === cashierId);
      assert.deepEqual(cashierRow.assignedStoreIds, [store.id]);

      await tx((c) => revokePosStoreAccess(c, managerContext, { userId: cashierId, storeId: store.id }));
      await assert.rejects(
        () => tx((c) => revokePosStoreAccess(c, managerContext, { userId: cashierId, storeId: store.id })),
        (error) => error.code === "POS_STORE_ACCESS_NOT_FOUND",
      );
    });
  } finally {
    for (const table of [
      "operation_idempotency",
      "pos_events",
      "pos_cart_lines",
      "pos_carts",
      "pos_store_access",
      "pos_shifts",
      "pos_terminals",
      "pos_stores",
      "pos_settings",
      "price_lists",
      "warehouses",
      "currencies",
    ]) {
      await admin.query(`DELETE FROM tenant.${table} WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    }
    await admin.query(`DELETE FROM public.user_role_assignments WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    if (posManagerRoleId) await admin.query(`DELETE FROM roles WHERE id=$1`, [posManagerRoleId]).catch(() => undefined);
    if (posCashierRoleId) await admin.query(`DELETE FROM roles WHERE id=$1`, [posCashierRoleId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.organization_memberships WHERE organization_id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[managerId, cashierId, unrelatedUserId]]).catch(() => undefined);
    await admin.end();
  }
});
