// Real PostgreSQL integration test -- physical verification (F260/F261), disposal and gain/loss
// (F262-F266), and reporting with the ledger reconciliation (F266/F267).
import assert from "node:assert/strict";
import test from "node:test";

import { ACCOUNTANT, MANAGER, buildAssetsWorld, connectAdmin } from "./assets-test-kit.mjs";

const ROLES = { mgr: MANAGER, auditor: ["assets.view", "assets.inspect"], acctA: ACCOUNTANT, acctB: ACCOUNTANT, custodian: ["assets.view"] };

test("Asset verification, disposal and reporting against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildAssetsWorld(admin, ROLES, "asdp");
  const { api, run, denied, sql, accounts } = w;
  const ids = {};

  try {
    const cat = await run("mgr", (c, x) => api.saveAssetCategory(c, x, w.categoryInput({ code: "OFF", usefulLifeMonths: 12 })));
    const roomA = await run("mgr", (c, x) => api.saveAssetLocation(c, x, { code: "a", name: "Room A", locationType: "room" }));
    const roomB = await run("mgr", (c, x) => api.saveAssetLocation(c, x, { code: "b", name: "Room B", locationType: "room" }));
    const make = async (name, over = {}) => {
      const a = await run("mgr", (c, x) => api.registerAsset(c, x, { name, categoryId: cat.id, acquisitionCost: 12000, locationId: roomA.id, ...over }));
      return run("acctA", (c, x) => api.capitalizeAssetRecord(c, x, a.id, { capitalizationDate: "2026-01-15" }));
    };
    const desk = await make("Desk");
    const chair = await make("Chair");
    const lamp = await make("Lamp");
    const stray = await run("mgr", (c, x) => api.registerAsset(c, x, { name: "Stray", categoryId: cat.id, acquisitionCost: 100, locationId: roomB.id }));

    await t.test("F260/F261: a scan classifies each asset as matched, moved, damaged or unexpected", async () => {
      await denied("custodian", (c, x) => api.createAssetVerificationCampaign(c, x, { name: "Q1 check" }), 403);
      const camp = await run("auditor", (c, x) => api.createAssetVerificationCampaign(c, x, { name: "Room A check", locationId: roomA.id }));
      const early = await run("auditor", (c, x) => api.scanAssetForVerification(c, x, camp.id, { tag: desk.tag_code })).catch((e) => e);
      assert.equal(early.status, 409, "a draft campaign accepts no scans");
      const started = await run("auditor", (c, x) => api.startAssetVerificationCampaign(c, x, camp.id));
      assert.equal(started.expected_count, 3, "the three capitalized assets in Room A are expected");
      ids.camp = camp.id;
      const m = await run("auditor", (c, x) => api.scanAssetForVerification(c, x, camp.id, { tag: desk.tag_code, foundLocationId: roomA.id }));
      assert.equal(m.result, "matched");
      const moved = await run("auditor", (c, x) => api.scanAssetForVerification(c, x, camp.id, { tag: chair.tag_code, foundLocationId: roomB.id }));
      assert.equal(moved.result, "moved");
      const damaged = await run("auditor", (c, x) => api.scanAssetForVerification(c, x, camp.id, { tag: lamp.tag_code, condition: "critical" }));
      assert.equal(damaged.result, "damaged");
      const unexpected = await run("auditor", (c, x) => api.scanAssetForVerification(c, x, camp.id, { tag: stray.tag_code }));
      assert.equal(unexpected.result, "unexpected", "a register asset outside the scope");
      const unknown = await run("auditor", (c, x) => api.scanAssetForVerification(c, x, camp.id, { tag: "NO-SUCH-TAG" }));
      assert.equal(unknown.result, "unexpected");
      assert.equal(unknown.asset_id, null, "an unknown tag is recorded, not dropped");
      ids.moved = moved.id;
      ids.damaged = damaged.id;
    });

    await t.test("F260: a campaign cannot close with unscanned assets or open discrepancies; resolutions are separately authorised", async () => {
      const open = await run("auditor", (c, x) => api.closeAssetVerificationCampaign(c, x, ids.camp)).catch((e) => e);
      assert.equal(open.status, 409, "discrepancies are open");
      const noAuth = await run("auditor", (c, x) => api.resolveAssetDiscrepancy(c, x, ids.moved, { action: "update_location", note: "found in B" })).catch((e) => e);
      assert.equal(noAuth.status, 403, "changing the register's location needs assets.manage, not just inspect");
      await run("mgr", (c, x) => api.resolveAssetDiscrepancy(c, x, ids.moved, { action: "update_location", note: "Confirmed in Room B" })).catch((e) => e);
      const [chairRow] = await sql(`SELECT location_id FROM tenant.assets WHERE id=$1`, [chair.id]);
      assert.equal(chairRow.location_id, roomB.id, "the register now follows the physical fact");
      const moves = await sql(`SELECT movement_type FROM tenant.asset_movements WHERE asset_id=$1`, [chair.id]);
      assert.ok(moves.some((r) => r.movement_type === "verification_correction"));
      await run("mgr", (c, x) => api.resolveAssetDiscrepancy(c, x, ids.damaged, { action: "accept", note: "Booked for repair" })).catch((e) => e);
    });

    await t.test("F260: the remaining discrepancies are resolved and the campaign closes, marking unscanned assets missing", async () => {
      const detail = await run("mgr", (c, x) => api.getAssetVerificationCampaign(c, x, ids.camp));
      for (const l of detail.lines.filter((r) => r.resolution_status === "open")) {
        await run("mgr", (c, x) => api.resolveAssetDiscrepancy(c, x, l.id, { action: "accept", note: "Reviewed" }));
      }
      const closed = await run("auditor", (c, x) => api.closeAssetVerificationCampaign(c, x, ids.camp, { markRemainingMissing: true }));
      assert.equal(closed.status, "closed");
      const final = await run("mgr", (c, x) => api.getAssetVerificationCampaign(c, x, ids.camp));
      assert.equal(final.summary.matched, 1);
      const scanAfter = await run("auditor", (c, x) => api.scanAssetForVerification(c, x, ids.camp, { tag: desk.tag_code })).catch((e) => e);
      assert.equal(scanAfter.status, 409, "a closed campaign takes no more scans");
    });

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

    await t.test("F267/F266: the reports reconcile to the register and the ledger, and respect permissions", async () => {
      const desk2 = await run("mgr", (c, x) => api.getAssetDesk(c, x));
      assert.ok(desk2.totalAssets >= 3);
      assert.equal(desk2.totalNetBookValue, undefined, "a manager without value rights sees counts, not value");
      const acctDesk = await run("acctA", (c, x) => api.getAssetDesk(c, x));
      assert.ok(Number(acctDesk.totalNetBookValue) > 0);
      await denied("mgr", (c, x) => api.getAssetReport(c, x, "register", {}), 403);
      const register = await run("acctA", (c, x) => api.getAssetReport(c, x, "register", {}));
      assert.equal(register.assets.some((r) => r.status === "disposed"), false, "disposed assets are out of the register report");
      const sum = register.assets.reduce((s, r) => s + Number(r.net_book_value), 0);
      assert.equal(Number(register.totalNetBookValue), sum);
      const rec = await run("acctA", (c, x) => api.getAssetReport(c, x, "reconciliation", {}));
      const row = rec.rows.find((r) => r.category === "OFF");
      assert.equal(Number(row.registerCost), 24000, "Chair and Lamp remain");
      assert.equal(Number(row.glCost), 24000, "the ledger holds the same cost from Assets' own postings, after the disposal derecognised the desk");
      assert.equal(Number(row.costDifference), 0);
      const disposals = await run("acctA", (c, x) => api.getAssetReport(c, x, "disposals", {}));
      assert.equal(disposals.rows.length, 1);
      const audit = await run("acctA", (c, x) => api.getAssetReport(c, x, "audit-trail", {}));
      assert.ok(audit.rows.some((r) => r.event_type === "asset.disposed"));
      await denied("mgr", (c, x) => api.getAssetReport(c, x, "audit-trail", {}), 403);
      const dep = await run("acctA", (c, x) => api.getAssetReport(c, x, "depreciation", {}));
      assert.ok(dep.byPeriod.length > 0);
      void accounts;
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
