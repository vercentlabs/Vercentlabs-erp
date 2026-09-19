// Real PostgreSQL integration test — F301 shift-opening idempotency, the
// specific dedicated coverage the acceptance register's own F301-FLOW-002
// override disclosed as missing: every existing test that opens a shift
// always supplies a fresh randomUUID() idempotencyKey, so the actual
// replay-safety/reuse-rejection/concurrency/authorization properties of
// openShift's beginIdempotentOperation/completeIdempotentOperation wiring
// were only ever proven generically (via the shared primitive's own Wave 0
// tests), never through openShift itself. This suite closes that gap.
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

test("F301: shift-opening idempotency against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const { openShift, closeShift } = await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const orgId = randomUUID();
  const cashierUserId = randomUUID();
  const otherUserId = randomUUID();
  const companyId = randomUUID();
  const branchId = randomUUID();
  const warehouseId = randomUUID();
  const storeId = randomUUID();
  const terminalAId = randomUUID();
  const terminalBId = randomUUID();

  const cashierContext = { organizationId: orgId, companyId, userId: cashierUserId, roleSlugs: [], permissions: ["pos.view", "pos.shift.open", "pos.shift.close"] };
  // A real member with no POS permission at all -- used to prove a
  // replay attempt against someone else's idempotency key is stopped by
  // authorization, never by silently returning the cached shift.
  const unauthorizedContext = { organizationId: orgId, companyId, userId: otherUserId, roleSlugs: [], permissions: ["pos.view"] };

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
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F301 Cashier','x','active',now())`, [
      cashierUserId,
      `f301-cashier-${cashierUserId}@test.invalid`,
    ]);
    await admin.query(`INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,'F301 Other User','x','active',now())`, [
      otherUserId,
      `f301-other-${otherUserId}@test.invalid`,
    ]);
    await admin.query(`INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,'F301 Test Org',$2,'IN','Asia/Kolkata','INR',$3)`, [
      orgId,
      `f301-org-${orgId}`,
      cashierUserId,
    ]);
    await admin.query(
      `INSERT INTO public.companies(id,organization_id,name,legal_name,code,base_currency,country_code,is_primary,status) VALUES ($1,$2,'F301 Co','F301 Co Pvt Ltd','F301CO','INR','IN',true,'active')`,
      [companyId, orgId],
    );
    await admin.query(`INSERT INTO public.branches(id,organization_id,company_id,name,code,timezone,status) VALUES ($1,$2,$3,'HQ','HQ','Asia/Kolkata','active')`, [
      branchId,
      orgId,
      companyId,
    ]);
    await setTenantContext(admin, orgId);
    await admin.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active')`, [orgId]);
    await admin.query(`INSERT INTO tenant.warehouses(id,organization_id,company_id,branch_id,code,name,status) VALUES ($1,$2,$3,$4,'WH1','Main WH','active')`, [
      warehouseId,
      orgId,
      companyId,
      branchId,
    ]);
    await admin.query(`INSERT INTO tenant.pos_settings(organization_id,company_id) VALUES ($1,$2)`, [orgId, companyId]);
    await admin.query(
      `INSERT INTO tenant.pos_stores(id,organization_id,company_id,branch_id,code,name,warehouse_id,currency_code,created_by) VALUES ($1,$2,$3,$4,'S1','Store 1',$5,'INR',$6)`,
      [storeId, orgId, companyId, branchId, warehouseId, cashierUserId],
    );
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T1','Terminal 1',$5)`, [
      terminalAId,
      orgId,
      companyId,
      storeId,
      cashierUserId,
    ]);
    await admin.query(`INSERT INTO tenant.pos_terminals(id,organization_id,company_id,store_id,code,name,created_by) VALUES ($1,$2,$3,$4,'T2','Terminal 2',$5)`, [
      terminalBId,
      orgId,
      companyId,
      storeId,
      cashierUserId,
    ]);

    let firstShiftId;

    await t.test("a retry with the SAME idempotency key and the SAME payload replays the original shift -- exactly one row persisted", async () => {
      const key = `f301-replay-${randomUUID()}`;
      const first = await tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminalAId, openingCash: 100, idempotencyKey: key }));
      assert.equal(first.replayed, undefined); // fresh creation, never marked replayed
      firstShiftId = first.id;

      // Simulate a client-side timeout retry: a SEPARATE request (new
      // transaction) with the identical key and identical payload.
      const retry = await tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminalAId, openingCash: 100, idempotencyKey: key }));
      assert.equal(retry.replayed, true);
      assert.equal(retry.id, firstShiftId);

      const rows = await admin.query(`SELECT count(*)::int AS n FROM tenant.pos_shifts WHERE organization_id=$1 AND terminal_id=$2`, [orgId, terminalAId]);
      assert.equal(rows.rows[0].n, 1, "exactly one shift row must exist after a same-key/same-payload retry");

      await tx((c) => closeShift(c, cashierContext, firstShiftId, { countedCash: 100 }));
    });

    await t.test("the SAME idempotency key with a DIFFERENT payload is rejected, not silently replayed with the wrong data", async () => {
      const key = `f301-reuse-${randomUUID()}`;
      const first = await tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminalBId, openingCash: 50, idempotencyKey: key }));

      await assert.rejects(
        tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminalBId, openingCash: 999, idempotencyKey: key })),
        (error) => error.code === "IDEMPOTENCY_KEY_REUSED",
      );

      await tx((c) => closeShift(c, cashierContext, first.id, { countedCash: 50 }));
    });

    await t.test("a replay attempt by an UNAUTHORIZED user is stopped by authorization, never returns the original shift", async () => {
      const key = `f301-auth-${randomUUID()}`;
      const first = await tx((c) => openShift(c, cashierContext, { storeId, terminalId: terminalAId, openingCash: 0, idempotencyKey: key }));

      // otherUserId holds no pos.shift.open permission at all -- must be
      // rejected on authorization BEFORE ever reaching the idempotency
      // table, regardless of supplying the exact same key/payload.
      await assert.rejects(
        tx((c) => openShift(c, unauthorizedContext, { storeId, terminalId: terminalAId, openingCash: 0, idempotencyKey: key })),
        (error) => error.code === "FORBIDDEN" || error.message?.toLowerCase().includes("permission"),
      );

      await tx((c) => closeShift(c, cashierContext, first.id, { countedCash: 0 }));
    });

    await t.test("CONCURRENCY: two genuinely simultaneous requests with the identical key/payload create exactly ONE shift", async () => {
      const key = `f301-concurrent-${randomUUID()}`;
      const clientA = await connectOrNull(adminConnectionString);
      const clientB = await connectOrNull(adminConnectionString);
      try {
        await clientA.query("BEGIN");
        await setTenantContext(clientA, orgId);
        await clientB.query("BEGIN");
        await setTenantContext(clientB, orgId);

        const runA = openShift(clientA, cashierContext, { storeId, terminalId: terminalBId, openingCash: 25, idempotencyKey: key })
          .then(async (result) => {
            await clientA.query("COMMIT");
            return { status: "fulfilled", value: result };
          })
          .catch(async (error) => {
            await clientA.query("ROLLBACK");
            return { status: "rejected", reason: error };
          });
        const runB = openShift(clientB, cashierContext, { storeId, terminalId: terminalBId, openingCash: 25, idempotencyKey: key })
          .then(async (result) => {
            await clientB.query("COMMIT");
            return { status: "fulfilled", value: result };
          })
          .catch(async (error) => {
            await clientB.query("ROLLBACK");
            return { status: "rejected", reason: error };
          });

        const [outcomeA, outcomeB] = await Promise.all([runA, runB]);
        assert.equal(outcomeA.status, "fulfilled", "the winner must succeed");
        assert.equal(outcomeB.status, "fulfilled", "the loser must safely replay, not error");
        assert.equal(outcomeA.value.id, outcomeB.value.id, "both racing callers must observe the SAME shift id");
      } finally {
        await clientA.end();
        await clientB.end();
      }

      const rows = await admin.query(`SELECT id FROM tenant.pos_shifts WHERE organization_id=$1 AND terminal_id=$2 AND status='open'`, [orgId, terminalBId]);
      assert.equal(rows.rows.length, 1, "exactly one shift row must exist after two genuinely concurrent identical requests");
      await tx((c) => closeShift(c, cashierContext, rows.rows[0].id, { countedCash: 25 }));
    });
  } finally {
    await admin.query("BEGIN");
    await setTenantContext(admin, orgId);
    await admin.query(`DELETE FROM tenant.pos_cash_movements WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_shifts WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_terminals WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_stores WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.pos_settings WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.warehouses WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM tenant.currencies WHERE organization_id=$1`, [orgId]);
    await admin.query("COMMIT");
    await admin.query(`DELETE FROM public.branches WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM public.companies WHERE organization_id=$1`, [orgId]);
    await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]);
    await admin.query(`DELETE FROM public.users WHERE id=ANY($1::uuid[])`, [[cashierUserId, otherUserId]]);
    await admin.end();
  }
});
