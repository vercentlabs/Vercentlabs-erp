// Real PostgreSQL integration test -- custody and movement (F239-F241) and asset value (F242-F251):
// assignment/return and the transfer workflow, the depreciation maths, approved-and-posted depreciation
// runs and their reversal, units-of-production usage, and revaluation/impairment.
import assert from "node:assert/strict";
import test from "node:test";

import { ACCOUNTANT, MANAGER, REGISTRAR, buildAssetsWorld, connectAdmin } from "./assets-test-kit.mjs";

const ROLES = {
  mgr: MANAGER, registrar: REGISTRAR,
  mgr2: MANAGER,
  acctA: ACCOUNTANT,
  acctB: ACCOUNTANT,
  custodian: ["assets.view"],
};

test("Asset custody and value against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildAssetsWorld(admin, ROLES, "ascv");
  const { api, run, denied, sql, accounts } = w;
  const ids = {};

  async function newAsset(over = {}, catOver = {}) {
    let categoryId = ids.cat;
    if (Object.keys(catOver).length) categoryId = (await run("mgr", (c, x) => api.saveAssetCategory(c, x, w.categoryInput(catOver)))).id;
    const a = await run("registrar", (c, x) => api.registerAsset(c, x, { name: "Asset", categoryId, acquisitionCost: 12000, ...over }));
    return run("acctA", (c, x) => api.capitalizeAssetRecord(c, x, a.id, { capitalizationDate: over.capDate || "2026-01-15" }));
  }

  try {
    ids.cat = (await run("mgr", (c, x) => api.saveAssetCategory(c, x, w.categoryInput({ code: "GEN", usefulLifeMonths: 12 })))).id;
    ids.roomA = (await run("mgr", (c, x) => api.saveAssetLocation(c, x, { code: "a", name: "Room A", locationType: "room" }))).id;
    ids.roomB = (await run("mgr", (c, x) => api.saveAssetLocation(c, x, { code: "b", name: "Room B", locationType: "room" }))).id;

    await t.test("F245: straight-line splits cost less salvage evenly and trues up the last month", () => {
      const lines = api.buildDepreciationLines({ method: "straight_line", openingCents: 1000000n, salvageCents: 100000n, months: 7, start: new Date("2026-01-10T00:00:00Z") });
      assert.equal(lines.length, 7);
      const total = lines.reduce((s, l) => s + l.amount, 0n);
      assert.equal(total, 900000n, "exactly cost less salvage");
      assert.equal(lines.at(-1).closing, 100000n, "ends at salvage, never below");
      assert.equal(lines[0].periodStart, "2026-01-01");
      assert.equal(lines[0].periodEnd, "2026-01-31");
      const amounts = lines.slice(0, -1).map((l) => l.amount);
      assert.ok(amounts.every((a) => a === amounts[0]), "each full month is equal");
    });

    await t.test("F246: declining balance front-loads, never goes below salvage, and lands on salvage", () => {
      const lines = api.buildDepreciationLines({ method: "declining_balance", openingCents: 1200000n, salvageCents: 200000n, months: 24, start: new Date("2026-01-01T00:00:00Z"), annualRatePercent: 40 });
      assert.ok(lines[0].amount > lines[10].amount, "the first charge exceeds a later one");
      assert.ok(lines.every((l) => l.closing >= 200000n));
      assert.equal(lines.at(-1).closing, 200000n);
    });

    await t.test("F245: a mid-month convention halves the first and last periods; next-month starts a month later", () => {
      const mid = api.buildDepreciationLines({ method: "straight_line", openingCents: 1200000n, salvageCents: 0n, months: 12, start: new Date("2026-01-20T00:00:00Z"), convention: "mid_month" });
      assert.equal(mid.length, 13);
      assert.ok(mid[1].amount - mid[0].amount * 2n <= 2n && mid[0].amount * 2n - mid[1].amount <= 2n, "the first period is half a normal month");
      assert.equal(mid.reduce((a, l) => a + l.amount, 0n), 1200000n);
      const next = api.buildDepreciationLines({ method: "straight_line", openingCents: 1200000n, salvageCents: 0n, months: 12, start: new Date("2026-01-20T00:00:00Z"), convention: "next_month" });
      assert.equal(next[0].periodStart, "2026-02-01");
    });

    await t.test("F239-F241: assignment closes the previous one, records movements, and return frees the asset", async () => {
      const a = await newAsset({ name: "Laptop", locationId: ids.roomA });
      ids.laptop = a.id;
      await denied("custodian", (c, x) => api.assignAssetToCustodian(c, x, a.id, { userId: w.users.custodian }), 403);
      const none = await run("mgr", (c, x) => api.assignAssetToCustodian(c, x, a.id, {})).catch((e) => e);
      assert.equal(none.status, 400, "an assignment needs a target");
      const first = await run("mgr", (c, x) => api.assignAssetToCustodian(c, x, a.id, { userId: w.users.custodian, conditionOut: "new" }));
      const second = await run("mgr", (c, x) => api.assignAssetToCustodian(c, x, a.id, { userId: w.users.mgr2 }));
      const rows = await sql(`SELECT assignment_status FROM tenant.asset_assignments WHERE asset_id=$1 ORDER BY assigned_from`, [a.id]);
      assert.deepEqual(rows.map((r) => r.assignment_status), ["returned", "active"]);
      assert.notEqual(first.id, second.id);
      const back = await run("mgr", (c, x) => api.returnAsset(c, x, a.id, { conditionRating: "fair", conditionIn: "scratched" }));
      assert.equal(back.ok, true);
      const [state] = await sql(`SELECT status,current_user_id,condition_rating FROM tenant.assets WHERE id=$1`, [a.id]);
      assert.equal(state.status, "available");
      assert.equal(state.current_user_id, null);
      assert.equal(state.condition_rating, "fair");
      const moves = await run("mgr", (c, x) => api.listAssetMovements(c, x, { assetId: a.id }));
      assert.deepEqual(moves.map((m) => m.movement_type).sort(), ["assignment", "assignment", "return"]);
      const noAssignment = await run("mgr", (c, x) => api.returnAsset(c, x, a.id, {})).catch((e) => e);
      assert.equal(noAssignment.status, 409);
    });

    await t.test("F239: a transfer is requested, approved by someone else, then completed, and moves the asset", async () => {
      const a = ids.laptop;
      const tr = await run("mgr", (c, x) => api.requestAssetTransfer(c, x, a, { toLocationId: ids.roomB, reason: "Moving desks" }));
      assert.equal(tr.status, "submitted");
      const dup = await run("mgr", (c, x) => api.requestAssetTransfer(c, x, a, { toLocationId: ids.roomA, reason: "again" })).catch((e) => e);
      assert.equal(dup.status, 409, "one open transfer per asset");
      const self = await run("mgr", (c, x) => api.approveAssetTransfer(c, x, tr.id)).catch((e) => e);
      assert.equal(self.code, "SELF_APPROVAL_BLOCKED");
      const early = await run("mgr", (c, x) => api.completeAssetTransfer(c, x, tr.id)).catch((e) => e);
      assert.equal(early.status, 409, "it must be approved first");
      await run("mgr2", (c, x) => api.approveAssetTransfer(c, x, tr.id));
      const done = await run("mgr", (c, x) => api.completeAssetTransfer(c, x, tr.id));
      assert.equal(done.status, "completed");
      const [asset] = await sql(`SELECT location_id FROM tenant.assets WHERE id=$1`, [a]);
      assert.equal(asset.location_id, ids.roomB);
      const rejected = await run("mgr", (c, x) => api.requestAssetTransfer(c, x, a, { toLocationId: ids.roomA, reason: "back" }));
      await run("mgr2", (c, x) => api.rejectAssetTransfer(c, x, rejected.id, "Not needed"));
      const cancel = await run("mgr", (c, x) => api.requestAssetTransfer(c, x, a, { toLocationId: ids.roomA, reason: "back again" }));
      const cancelled = await run("mgr", (c, x) => api.cancelAssetTransfer(c, x, cancel.id));
      assert.equal(cancelled.status, "cancelled");
      const history = await run("mgr", (c, x) => api.listAssetMovements(c, x, { assetId: a }));
      assert.ok(history.some((m) => m.movement_type === "transfer" && m.to_location_id === ids.roomB));
    });

    await t.test("F248/F249: a run is prepared, approved by someone else, posted as one balanced journal, and moves NBV", async () => {
      const a = await newAsset({ name: "Press", acquisitionCost: 12000, capDate: "2026-01-15" }, { code: "PRS", usefulLifeMonths: 12 });
      ids.press = a.id;
      await denied("mgr", (c, x) => api.createDepreciationRun(c, x, { periodEnd: "2026-03-31" }), 403);
      const run1 = await run("acctA", (c, x) => api.createDepreciationRun(c, x, { periodEnd: "2026-03-31" }));
      assert.equal(run1.status, "calculated");
      assert.ok(Number(run1.total_depreciation) >= 3000, "three months of the press (1000 a month) at least");
      const dupRun = await run("acctA", (c, x) => api.createDepreciationRun(c, x, { periodEnd: "2026-03-31" })).catch((e) => e);
      assert.equal(dupRun.status, 409);
      const early = await run("acctA", (c, x) => api.postDepreciationRun(c, x, run1.id)).catch((e) => e);
      assert.equal(early.status, 409, "it must be approved first");
      const selfApprove = await run("acctA", (c, x) => api.approveDepreciationRun(c, x, run1.id)).catch((e) => e);
      assert.equal(selfApprove.code, "SELF_APPROVAL_BLOCKED");
      await run("acctB", (c, x) => api.approveDepreciationRun(c, x, run1.id));
      const posted = await run("acctB", (c, x) => api.postDepreciationRun(c, x, run1.id));
      assert.equal(posted.status, "posted");
      assert.equal(posted.accounting_status, "posted");
      const [j] = await sql(`SELECT sum(base_debit_amount) AS d, sum(base_credit_amount) AS cr FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2`, [w.orgId, posted.accounting_journal_id]);
      assert.equal(Number(j.d), Number(j.cr));
      assert.equal(Number(j.d), Number(run1.total_depreciation), "the journal equals the run");
      const [asset] = await sql(`SELECT accumulated_depreciation,net_book_value,capitalized_cost FROM tenant.assets WHERE id=$1`, [a.id]);
      assert.equal(Number(asset.net_book_value), Number(asset.capitalized_cost) - Number(asset.accumulated_depreciation));
      assert.equal(Number(asset.accumulated_depreciation), 3000);
      ids.run1 = run1.id;
    });

    await t.test("F249: reversing a run restores NBV and lets the same period be run again; only the latest can reverse", async () => {
      const run2 = await run("acctA", (c, x) => api.createDepreciationRun(c, x, { periodEnd: "2026-04-30" }));
      await run("acctB", (c, x) => api.approveDepreciationRun(c, x, run2.id));
      await run("acctB", (c, x) => api.postDepreciationRun(c, x, run2.id));
      const order = await run("acctB", (c, x) => api.reverseDepreciationRun(c, x, ids.run1, "Wrong period")).catch((e) => e);
      assert.equal(order.status, 409, "a later run is posted");
      await run("acctB", (c, x) => api.reverseDepreciationRun(c, x, run2.id, "Rerun needed"));
      const [asset] = await sql(`SELECT accumulated_depreciation FROM tenant.assets WHERE id=$1`, [ids.press]);
      assert.equal(Number(asset.accumulated_depreciation), 3000, "April is out again");
      const again = await run("acctA", (c, x) => api.createDepreciationRun(c, x, { periodEnd: "2026-04-30" }));
      assert.equal(again.status, "calculated", "a reversed run does not block a new one for the same date");
      await run("acctB", (c, x) => api.approveDepreciationRun(c, x, again.id));
      await run("acctB", (c, x) => api.postDepreciationRun(c, x, again.id));
      const [after] = await sql(`SELECT accumulated_depreciation FROM tenant.assets WHERE id=$1`, [ids.press]);
      assert.equal(Number(after.accumulated_depreciation), 4000);
    });

    await t.test("F247: units-of-production depreciates by usage and never beyond total units", async () => {
      const a = await newAsset({ name: "Drill", acquisitionCost: 10000, totalUnits: 1000, depreciationMethod: "units_of_production", capDate: "2026-01-05" }, { code: "UOP", depreciationMethod: "units_of_production" });
      const none = await sql(`SELECT count(*)::int AS n FROM tenant.asset_depreciation_schedules WHERE asset_id=$1`, [a.id]);
      assert.equal(none[0].n, 0, "no calendar schedule for a usage-driven asset");
      const r = await run("mgr", (c, x) => api.recordAssetUsage(c, x, a.id, { periodEnd: "2026-01-31", units: 100 }));
      assert.equal(Number(r.depreciationAmount), 1000);
      const over = await run("mgr", (c, x) => api.recordAssetUsage(c, x, a.id, { periodEnd: "2026-02-28", units: 950 })).catch((e) => e);
      assert.equal(over.status, 409, "usage beyond the total expected units is refused");
      await run("mgr", (c, x) => api.recordAssetUsage(c, x, a.id, { periodEnd: "2026-02-28", units: 900 }));
      const [t2] = await sql(`SELECT sum(depreciation_amount) AS d FROM tenant.asset_depreciation_schedules WHERE asset_id=$1`, [a.id]);
      assert.equal(Number(t2.d), 10000, "the full base is depreciated at exactly 1000 units");
    });

    await t.test("F251: an impairment is requested, approved by someone else, and cuts NBV and the remaining schedule", async () => {
      const req = await run("acctA", (c, x) => api.requestValueAdjustment(c, x, ids.press, { adjustmentType: "impairment", newNetBookValue: 5000, reason: "Fire damage", effectiveDate: "2026-04-30" }));
      assert.equal(req.status, "pending_approval");
      const dup = await run("acctA", (c, x) => api.requestValueAdjustment(c, x, ids.press, { adjustmentType: "impairment", newNetBookValue: 4000, reason: "again" })).catch((e) => e);
      assert.equal(dup.status, 409, "one pending adjustment at a time");
      const self = await run("acctA", (c, x) => api.approveValueAdjustment(c, x, req.id)).catch((e) => e);
      assert.equal(self.code, "SELF_APPROVAL_BLOCKED");
      const posted = await run("acctB", (c, x) => api.approveValueAdjustment(c, x, req.id));
      assert.equal(posted.status, "posted");
      assert.equal(posted.accounting_status, "posted");
      const [a] = await sql(`SELECT net_book_value,impairment_accumulated FROM tenant.assets WHERE id=$1`, [ids.press]);
      assert.equal(Number(a.net_book_value), 5000);
      assert.equal(Number(a.impairment_accumulated), 3000);
      const remaining = await sql(`SELECT sum(depreciation_amount) AS d FROM tenant.asset_depreciation_schedules WHERE asset_id=$1 AND status='planned'`, [ids.press]);
      assert.equal(Number(remaining[0].d), 5000, "the future schedule now depreciates the reduced value down to salvage");
    });

    await t.test("F250: an impairment reversal cannot exceed the impairment; a revaluation up books a reserve", async () => {
      const tooMuch = await run("acctA", (c, x) => api.requestValueAdjustment(c, x, ids.press, { adjustmentType: "impairment_reversal", newNetBookValue: 9000, reason: "recovered" })).catch((e) => e);
      assert.equal(tooMuch.status, 409);
      const up = await run("acctA", (c, x) => api.requestValueAdjustment(c, x, ids.press, { adjustmentType: "revaluation", newNetBookValue: 6000, reason: "Market value" }));
      const posted = await run("acctB", (c, x) => api.approveValueAdjustment(c, x, up.id));
      assert.equal(posted.status, "posted");
      const [a] = await sql(`SELECT net_book_value,revaluation_surplus,capitalized_cost FROM tenant.assets WHERE id=$1`, [ids.press]);
      assert.equal(Number(a.net_book_value), 6000);
      assert.equal(Number(a.revaluation_surplus), 1000);
      const [line] = await sql(`SELECT account_id FROM tenant.accounting_journal_lines WHERE journal_entry_id=$1 AND base_credit_amount>0`, [posted.accounting_journal_id]);
      assert.equal(line.account_id, accounts.reserve, "the credit lands on the revaluation reserve");
    });

    await t.test("F251: a stale adjustment is refused when depreciation posted after it was requested", async () => {
      const req = await run("acctA", (c, x) => api.requestValueAdjustment(c, x, ids.press, { adjustmentType: "impairment", newNetBookValue: 100, reason: "Scrap value" }));
      const next = await run("acctA", (c, x) => api.createDepreciationRun(c, x, { periodEnd: "2026-06-30" }));
      await run("acctB", (c, x) => api.approveDepreciationRun(c, x, next.id));
      await run("acctB", (c, x) => api.postDepreciationRun(c, x, next.id));
      const stale = await run("acctB", (c, x) => api.approveValueAdjustment(c, x, req.id)).catch((e) => e);
      assert.equal(stale.code, "ASSET_ADJUSTMENT_STALE");
      const cancelled = await run("acctA", (c, x) => api.cancelValueAdjustment(c, x, req.id));
      assert.equal(cancelled.status, "cancelled");
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
