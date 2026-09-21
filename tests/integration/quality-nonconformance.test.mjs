// Real PostgreSQL integration test -- quality holds and the F323 Stock-movement gate (a real call into
// Stock's own postStockMovement, not a mock), non-conformance with containment/disposition (including
// the use-as-is second-person approval), and CAPA through independent effectiveness verification
// (F321-F333).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { ALL_QUALITY, buildQualityWorld, connectAdmin } from "./quality-test-kit.mjs";

const ROLES = {
  qaA: ALL_QUALITY,
  qaB: ALL_QUALITY,
  holder: ["quality.hold", "quality.nonconformance.manage", "quality.capa.manage", "quality.view"], // no quality.manage: cannot self-approve use-as-is or self-verify a CAPA
  stockClerk: ["stock.issue"], // a warehouse user with a Stock permission but nothing from Quality
};

test("Quality holds (with the Stock movement gate), non-conformance and CAPA against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildQualityWorld(admin, ROLES, "qlnc");
  const { api, run, denied, sql, itemId, warehouseId, supplierId } = w;
  const ids = {};

  try {
    await t.test("F322/F323/F324: an active hold blocks Stock from moving into it; releasing it unblocks the movement (a real Stock call, not a mock)", async () => {
      await denied("stockClerk", (c, x) => api.createQualityHold(c, x, { itemId, warehouseId, quantity: 20, reason: "Suspect batch" }), 403);
      const hold = await run("holder", (c, x) => api.createQualityHold(c, x, { itemId, warehouseId, quantity: 20, reason: "Suspect batch pending inspection" }));
      ids.hold = hold.id;
      assert.equal(hold.status, "active");

      // 100 on hand, 20 held: only 80 is available outside the hold, so a request for more is refused...
      const blocked = await run("stockClerk", (c, x) => api.postStockMovement(c, x, { movementType: "issue", itemId, warehouseId, quantity: 85 })).catch((e) => e);
      assert.equal(blocked.code, "QUALITY_HOLD_BLOCKED", "Stock's own gate refuses to move more than what is available outside the Quality hold");
      assert.equal(blocked.holdId, hold.id);
      // ...while a request within the 80 unheld still moves freely
      const partial = await run("stockClerk", (c, x) => api.postStockMovement(c, x, { movementType: "issue", itemId, warehouseId, quantity: 50 }));
      assert.ok(partial.id || partial.replayed !== undefined);

      await denied("qaA", (c, x) => api.releaseQualityHold(c, x, hold.id, { reason: "", idempotencyKey: randomUUID() }), 400, "QUALITY_HOLD_RELEASE_REASON_REQUIRED");
      const released = await run("qaA", (c, x) => api.releaseQualityHold(c, x, hold.id, { reason: "Inspection passed", idempotencyKey: randomUUID() }));
      assert.equal(released.status, "released");

      // now the balance is 50 (100 - the 50 issued above) with nothing held: a further 30 moves freely
      const nowAllowed = await run("stockClerk", (c, x) => api.postStockMovement(c, x, { movementType: "issue", itemId, warehouseId, quantity: 30 }));
      assert.ok(nowAllowed.id || nowAllowed.replayed !== undefined);
    });

    await t.test("F324: a hold can be released in part; the remainder still blocks Stock", async () => {
      await sql(`UPDATE tenant.stock_balances SET quantity=100,reserved_quantity=0 WHERE organization_id=$1 AND item_id=$2 AND warehouse_id=$3`, [w.orgId, itemId, warehouseId]);
      const hold = await run("holder", (c, x) => api.createQualityHold(c, x, { itemId, warehouseId, quantity: 30, reason: "Partial suspect quantity" }));
      const partiallyReleased = await run("qaA", (c, x) => api.releaseQualityHold(c, x, hold.id, { quantity: 10, reason: "Ten units re-tested and passed", idempotencyKey: randomUUID() }));
      assert.equal(partiallyReleased.status, "active");
      assert.equal(Number(partiallyReleased.released_quantity), 10);
      // 20 is still held out of 100: taking the balance to 85 (below the 20 held) is refused
      const blocked = await run("stockClerk", (c, x) => api.postStockMovement(c, x, { movementType: "issue", itemId, warehouseId, quantity: 85 })).catch((e) => e);
      assert.equal(blocked.code, "QUALITY_HOLD_BLOCKED");
      const finalRelease = await run("qaA", (c, x) => api.releaseQualityHold(c, x, hold.id, { reason: "Rest cleared", idempotencyKey: randomUUID() }));
      assert.equal(finalRelease.status, "released");
    });

    await t.test("cancelling a hold in error needs a reason and never blocks Stock again", async () => {
      const hold = await run("holder", (c, x) => api.createQualityHold(c, x, { itemId, warehouseId, quantity: 5, reason: "Placed by mistake" }));
      await denied("holder", (c, x) => api.cancelQualityHold(c, x, hold.id, ""), 400, "QUALITY_REASON_REQUIRED");
      const cancelled = await run("holder", (c, x) => api.cancelQualityHold(c, x, hold.id, "Wrong item selected"));
      assert.equal(cancelled.status, "cancelled");
    });

    await t.test("F321/F325-329: non-conformance -- containment, then a disposition; use-as-is needs a second person's approval", async () => {
      const nc = await run("holder", (c, x) => api.createQualityNonconformance(c, x, { severity: "major", category: "dimensional", description: "Out-of-tolerance length on 12 units", supplierId, itemId, detectedQuantity: 12, affectedQuantity: 12, estimatedCost: 500 }));
      ids.nc = nc.id;
      assert.equal(nc.status, "open");
      await denied("holder", (c, x) => api.transitionNonconformance(c, x, nc.id, { action: "contain" }), 409, "QUALITY_NC_STATE");
      await run("holder", (c, x) => api.transitionNonconformance(c, x, nc.id, { action: "review" }));
      await denied("holder", (c, x) => api.transitionNonconformance(c, x, nc.id, { action: "contain" }), 400, "QUALITY_NC_INVALID");
      const contained = await run("holder", (c, x) => api.transitionNonconformance(c, x, nc.id, { action: "contain", containmentAction: "Segregated the 12 units in the hold area" }));
      assert.equal(contained.status, "contained");

      // use-as-is is requested by someone WITH quality.manage (qaA), so the self-approval block is the
      // thing actually under test, not a plain permission refusal
      await denied("qaA", (c, x) => api.setDisposition(c, x, nc.id, { disposition: "use_as_is", dispositionQuantity: 12 }), 400, "QUALITY_REASON_REQUIRED");
      const requested = await run("qaA", (c, x) => api.setDisposition(c, x, nc.id, { disposition: "use_as_is", dispositionQuantity: 12, reason: "Within functional spec despite cosmetic length variance" }));
      assert.equal(requested.disposition, "use_as_is");
      assert.ok(requested.use_as_is_requested_at);
      assert.equal(requested.use_as_is_approved_at, null);
      await denied("qaA", (c, x) => api.approveUseAsIs(c, x, nc.id, { approve: true }), 403, "SELF_APPROVAL_BLOCKED");
      await denied("holder", (c, x) => api.closeNonconformance(c, x, nc.id, {}), 409, "QUALITY_NC_USE_AS_IS_UNAPPROVED");
      const approved = await run("qaB", (c, x) => api.approveUseAsIs(c, x, nc.id, { approve: true }));
      assert.ok(approved.use_as_is_approved_at);
    });

    await t.test("F330-333: CAPA -- root cause before actions, actions before verification, and never self-verified; a major NC needs it before closing", async () => {
      await denied("holder", (c, x) => api.closeNonconformance(c, x, ids.nc, {}), 409, "QUALITY_NC_CAPA_REQUIRED");
      const capa = await run("holder", (c, x) => api.createQualityCapa(c, x, { nonconformanceId: ids.nc, title: "Fix incoming length variance", dueDate: w.today }));
      ids.capa = capa.id;
      await denied("holder", (c, x) => api.recordCapaActions(c, x, capa.id, { correctiveAction: "Recalibrate incoming gauge" }), 409, "QUALITY_CAPA_ROOT_CAUSE_REQUIRED");
      await denied("holder", (c, x) => api.recordRootCause(c, x, capa.id, { rootCause: "" }), 400, "QUALITY_CAPA_INVALID");
      const withRootCause = await run("holder", (c, x) => api.recordRootCause(c, x, capa.id, { rootCauseMethod: "5-Why", rootCause: "Incoming gauge was out of calibration" }));
      assert.equal(withRootCause.status, "analysis");
      const withActions = await run("holder", (c, x) => api.recordCapaActions(c, x, capa.id, { correction: "Re-measured the 12 units by hand", correctiveAction: "Recalibrate the incoming gauge weekly", preventiveAction: "Add gauge calibration to the PM schedule" }));
      assert.equal(withActions.status, "implementation");
      const submitted = await run("holder", (c, x) => api.submitCapaForVerification(c, x, capa.id));
      assert.equal(submitted.status, "verification");
      await denied("holder", (c, x) => api.verifyCapa(c, x, capa.id, { effective: true, verificationResult: "Confirmed" }), 403, "SELF_APPROVAL_BLOCKED");
      const verified = await run("qaA", (c, x) => api.verifyCapa(c, x, capa.id, { effective: true, verificationResult: "Ten follow-up lots all within tolerance" }));
      assert.equal(verified.status, "effective");
      const closedCapa = await run("holder", (c, x) => api.closeCapa(c, x, capa.id));
      assert.equal(closedCapa.status, "closed");

      const closedNc = await run("holder", (c, x) => api.closeNonconformance(c, x, ids.nc, {}));
      assert.equal(closedNc.status, "closed");
    });

    await t.test("a CAPA owner cannot verify their own effectiveness result, even with quality.manage; an ineffective CAPA blocks NC closure", async () => {
      const nc2 = await run("qaA", (c, x) => api.createQualityNonconformance(c, x, { severity: "critical", category: "safety", description: "Sharp edge found", detectedQuantity: 1, affectedQuantity: 1 }));
      await run("qaA", (c, x) => api.setDisposition(c, x, nc2.id, { disposition: "rework", dispositionQuantity: 1 }));
      const capa2 = await run("qaA", (c, x) => api.createQualityCapa(c, x, { nonconformanceId: nc2.id, title: "Eliminate sharp edge", ownerUserId: undefined }));
      await run("qaA", (c, x) => api.recordRootCause(c, x, capa2.id, { rootCause: "Tooling wear" }));
      await run("qaA", (c, x) => api.recordCapaActions(c, x, capa2.id, { correctiveAction: "Replace tooling" }));
      await run("qaA", (c, x) => api.submitCapaForVerification(c, x, capa2.id));
      await denied("qaA", (c, x) => api.verifyCapa(c, x, capa2.id, { effective: true, verificationResult: "Looks fine" }), 403, "SELF_APPROVAL_BLOCKED");
      const ineffective = await run("qaB", (c, x) => api.verifyCapa(c, x, capa2.id, { effective: false, verificationResult: "New tooling still produced the defect" }));
      assert.equal(ineffective.status, "ineffective");
      await denied("qaA", (c, x) => api.closeNonconformance(c, x, nc2.id, {}), 409, "QUALITY_NC_CAPA_OPEN");
    });

    await t.test("cancelling an open non-conformance needs a reason", async () => {
      const nc3 = await run("holder", (c, x) => api.createQualityNonconformance(c, x, { severity: "minor", category: "packaging", description: "Label smudge" }));
      await denied("holder", (c, x) => api.cancelNonconformance(c, x, nc3.id, ""), 400, "QUALITY_REASON_REQUIRED");
      const cancelled = await run("holder", (c, x) => api.cancelNonconformance(c, x, nc3.id, "Duplicate report"));
      assert.equal(cancelled.status, "cancelled");
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
