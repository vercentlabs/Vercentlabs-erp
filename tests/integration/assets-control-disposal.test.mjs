// Real PostgreSQL integration test -- disposal and gain/loss (F262-F265) and the Assets home dashboard.
import assert from "node:assert/strict";
import test from "node:test";

import { ACCOUNTANT, MANAGER, REGISTRAR, buildAssetsWorld, connectAdmin } from "./assets-test-kit.mjs";

const ROLES = { mgr: MANAGER, registrar: REGISTRAR, acctA: ACCOUNTANT, acctB: ACCOUNTANT, custodian: ["assets.view"] };

test("Asset disposal and dashboard against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildAssetsWorld(admin, ROLES, "asdp");
  const { api, run, denied, sql } = w;

  try {
    const cat = await run("mgr", (c, x) => api.saveAssetCategory(c, x, w.categoryInput({ code: "OFF", usefulLifeMonths: 12 })));
    const roomA = await run("mgr", (c, x) => api.saveAssetLocation(c, x, { code: "a", name: "Room A", locationType: "room" }));
    const make = async (name, over = {}) => {
      const a = await run("registrar", (c, x) => api.registerAsset(c, x, { name, categoryId: cat.id, acquisitionCost: 12000, locationId: roomA.id, ...over }));
      return run("acctA", (c, x) => api.capitalizeAssetRecord(c, x, a.id, { capitalizationDate: "2026-01-15" }));
    };
    const desk = await make("Desk");
    const chair = await make("Chair");
    await make("Lamp");

    await t.test("F262-F265: a sale is requested, approved by someone else, completed, and books gain/loss against the register", async () => {
      await denied("mgr", (c, x) => api.requestAssetDisposal(c, x, desk.id, { disposalMethod: "scrap", reason: "x" }), 403);
      const noBuyer = await run("acctA", (c, x) => api.requestAssetDisposal(c, x, desk.id, { disposalMethod: "sale", proceedsAmount: 5000, reason: "Old" })).catch((e) => e);
      assert.equal(noBuyer.status, 400, "a sale needs a buyer");
      const d = await run("acctA", (c, x) => api.requestAssetDisposal(c, x, desk.id, { disposalMethod: "sale", proceedsAmount: 11000, disposalCost: 500, buyerPartyId: w.customerId, reason: "Replaced", disposalDate: "2026-03-31" }));
      assert.equal(d.status, "pending_approval");
      const [pending] = await sql(`SELECT status FROM tenant.assets WHERE id=$1`, [desk.id]);
      assert.equal(pending.status, "pending_disposal");
      const twice = await run("acctA", (c, x) => api.requestAssetDisposal(c, x, desk.id, { disposalMethod: "scrap", reason: "again" })).catch((e) => e);
      assert.equal(twice.status, 409, "one disposal at a time");
      const self = await run("acctA", (c, x) => api.approveAssetDisposal(c, x, d.id)).catch((e) => e);
      assert.equal(self.code, "SELF_APPROVAL_BLOCKED");
      const early = await run("acctA", (c, x) => api.completeAssetDisposal(c, x, d.id)).catch((e) => e);
      assert.equal(early.status, 409, "approve first");
      await run("acctB", (c, x) => api.approveAssetDisposal(c, x, d.id));
      const blocked = await run("acctA", (c, x) => api.completeAssetDisposal(c, x, d.id)).catch((e) => e);
      assert.equal(blocked.code, "ASSET_DEPRECIATION_PENDING", "depreciation due to the disposal date must be posted first");
      const dep = await run("acctA", (c, x) => api.createDepreciationRun(c, x, { periodEnd: "2026-03-31" }));
      await run("acctB", (c, x) => api.approveDepreciationRun(c, x, dep.id));
      await run("acctB", (c, x) => api.postDepreciationRun(c, x, dep.id));
      const done = await run("acctA", (c, x) => api.completeAssetDisposal(c, x, d.id));
      assert.equal(done.status, "completed");
      assert.equal(done.disposal_journal_status, "posted");
      assert.equal(Number(done.original_cost), 12000);
      assert.equal(Number(done.accumulated_depreciation), 3000, "January to March at 1000 a month");
      assert.equal(Number(done.net_book_value), 9000);
      assert.equal(Number(done.gain_loss_amount), 1500, "11000 proceeds less 500 costs less the 9000 carrying value");
      const [j] = await sql(`SELECT sum(base_debit_amount) AS d, sum(base_credit_amount) AS cr FROM tenant.accounting_journal_lines WHERE journal_entry_id=$1`, [done.accounting_journal_id]);
      assert.equal(Number(j.d), Number(j.cr), "the disposal journal balances");
      const [asset] = await sql(`SELECT status,net_book_value FROM tenant.assets WHERE id=$1`, [desk.id]);
      assert.equal(asset.status, "disposed");
      assert.equal(Number(asset.net_book_value), 0);
      const idem = await run("acctA", (c, x) => api.completeAssetDisposal(c, x, d.id));
      assert.equal(idem.id, done.id, "completing again returns the same disposal");
      const after = await run("mgr", (c, x) => api.assignAssetToCustodian(c, x, desk.id, { userId: w.users.custodian })).catch((e) => e);
      assert.equal(after.status, 409, "a disposed asset can never be assigned");
    });

    await t.test("F264: a rejected disposal restores the asset's status; a scrap has no buyer", async () => {
      const d = await run("acctA", (c, x) => api.requestAssetDisposal(c, x, chair.id, { disposalMethod: "scrap", reason: "Broken" }));
      const rejected = await run("acctB", (c, x) => api.rejectAssetDisposal(c, x, d.id, "Still usable"));
      assert.equal(rejected.status, "rejected");
      const [a] = await sql(`SELECT status FROM tenant.assets WHERE id=$1`, [chair.id]);
      assert.notEqual(a.status, "pending_disposal");
      const sale = await run("acctA", (c, x) => api.requestAssetDisposal(c, x, chair.id, { disposalMethod: "write_off", proceedsAmount: 10, reason: "x" })).catch((e) => e);
      assert.equal(sale.status, 400, "a write-off has no proceeds");
    });


    await t.test("the dashboard counts assets and shows value only to people with value rights", async () => {
      const desk2 = await run("mgr", (c, x) => api.getAssetDesk(c, x));
      assert.ok(desk2.totalAssets >= 2);
      assert.equal(desk2.totalNetBookValue, undefined, "a manager without value rights sees counts, not value");
      const acctDesk = await run("acctA", (c, x) => api.getAssetDesk(c, x));
      assert.ok(Number(acctDesk.totalNetBookValue) > 0);
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
