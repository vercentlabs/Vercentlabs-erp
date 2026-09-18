import { test, expect } from "@playwright/test";
import { getPosWorld, openPersonaSession, resetTerminalCarts, withPosDb } from "./pos-fixtures";

// Real maker-checker E2E proof for POS discount approval (F279). This
// needs two GENUINELY separate, separately-authenticated sessions: the
// pos_supervisor persona (holds pos.discount.apply, requests an
// above-threshold discount) and the pos_manager persona (holds
// pos.discount.approve, decides it). organization_owner would fail this
// for the wrong reason -- self-approval-blocked because the SAME user
// requested and decided -- not because the security boundary actually
// works, so this suite never uses the owner fixture at all.
//
// KNOWN GAP documented (not fixed) in the second test below: the
// platform's generic /approvals inbox (GET /api/approvals) only returns a
// request to its requester, its `assigned_to`, or someone holding the
// blanket `approvals.manage` permission (services/api/src/core/
// approvals.js's listApprovals). POS never sets `assigned_to` when it
// creates a discount-approval request, and neither pos_supervisor nor
// pos_manager holds `approvals.manage` (verified against this org's real
// public.role_permissions) -- so a plain pos_manager cannot actually
// discover this request by opening /approvals in the real UI today, even
// though deciding it directly (POST /api/approvals/:id/decide) is fully
// and correctly authorized. This is a real, reproducible product gap, not
// a test limitation; left unfixed per this task's scope (out-of-blast-
// radius change to shared, cross-module approval-listing code) and
// asserted directly so a future fix is what breaks this test, not silence.

test.describe("POS discount maker-checker", () => {
  test("supervisor requests an above-threshold discount; self-approval is blocked; a real, separate manager session must decide it", async ({ browser }) => {
    const world = await getPosWorld();
    await resetTerminalCarts(world.supervisorTerminalId);

    const supervisorSession = await openPersonaSession(browser, world.supervisor);
    try {
      const [createResponse] = await Promise.all([
        supervisorSession.page.waitForResponse((res) => res.url().endsWith("/api/pos/carts") && res.request().method() === "POST"),
        supervisorSession.page.goto("/pos/checkout", { waitUntil: "domcontentloaded" }),
      ]);
      const cart = (await createResponse.json()).cart as { id: string; version: number };
      const origin = new URL(supervisorSession.page.url()).origin;

      const addLineResp = await supervisorSession.page.request.post(`/api/pos/carts/${cart.id}/lines`, {
        headers: { origin },
        data: { itemId: world.itemId, quantity: 1, expectedVersion: cart.version },
      });
      const pricedCart = (await addLineResp.json()).cart as { id: string; version: number; lines: Array<{ id: string }> };
      const lineId = pricedCart.lines[0].id;

      // 50% is well above pos_settings.discount_approval_threshold_percent
      // (10%) -- the discount is applied immediately (visible on the cart)
      // but creates a real pending approval; it does not throw.
      const discountResp = await supervisorSession.page.request.post(`/api/pos/carts/${cart.id}/lines/${lineId}/discount`, {
        headers: { origin },
        data: { type: "percent", value: 50, reason: "e2e maker-checker", expectedVersion: pricedCart.version },
      });
      expect(discountResp.status()).toBe(200);
      const discountedCart = (await discountResp.json()).cart as { manual_discount_total: string; grand_total: string; version: number };
      expect(discountedCart.manual_discount_total).toBe("125.000000"); // 50% of 250
      expect(discountedCart.grand_total).toBe("147.500000"); // (250-125) taxable * 1.18 GST

      const pendingApproval = await withPosDb((client) =>
        client
          .query(
            `SELECT id, requested_by, status FROM public.approval_requests WHERE organization_id=$1 AND command_key='pos.discount.approve' AND entity_id=$2 ORDER BY requested_at DESC LIMIT 1`,
            [world.organizationId, cart.id],
          )
          .then((r) => r.rows[0]),
      );
      expect(pendingApproval, "requesting an above-threshold discount must create a real pending approval_requests row").toBeTruthy();
      expect(pendingApproval.requested_by).toBe(world.supervisor.userId);
      expect(pendingApproval.status).toBe("pending");

      // The checkout guard fails closed: completing now, with no decided
      // approval, must be rejected.
      const completeAttempt = await supervisorSession.page.request.post(`/api/pos/carts/${cart.id}/complete`, {
        headers: { origin },
        data: { payments: [{ method: "cash", amount: Number(discountedCart.grand_total) }], idempotencyKey: `e2e-approval-blocked-${Date.now()}`, expectedVersion: discountedCart.version },
      });
      const completeAttemptBody = await completeAttempt.json();
      expect(completeAttempt.status(), JSON.stringify(completeAttemptBody)).not.toBe(201);
      expect(completeAttemptBody.code, JSON.stringify(completeAttemptBody)).toBe("POS_DISCOUNT_APPROVAL_REQUIRED");

      // The supervisor who requested it cannot decide their own request,
      // even via the real, authenticated decide endpoint they're logged
      // into right now.
      const selfDecide = await supervisorSession.page.request.post(`/api/approvals/${pendingApproval.id}/decide`, {
        headers: { origin },
        data: { decision: "approved" },
      });
      const selfDecideBody = await selfDecide.json();
      expect(selfDecide.status(), JSON.stringify(selfDecideBody)).toBe(403);
      expect(selfDecideBody.code).toBe("SELF_APPROVAL_DENIED");

      const stillPending = await withPosDb((client) =>
        client.query(`SELECT status FROM public.approval_requests WHERE id=$1`, [pendingApproval.id]).then((r) => r.rows[0]),
      );
      expect(stillPending.status).toBe("pending");

      // A genuine, separately-authenticated pos_manager session (holds
      // pos.discount.approve, not the same login as the requester) decides
      // it for real.
      const managerSession = await openPersonaSession(browser, world.manager);
      try {
        await managerSession.page.goto("/pos", { waitUntil: "domcontentloaded" });
        const managerOrigin = new URL(managerSession.page.url()).origin;
        const decideResp = await managerSession.page.request.post(`/api/approvals/${pendingApproval.id}/decide`, {
          headers: { origin: managerOrigin },
          data: { decision: "approved" },
        });
        const decideBody = await decideResp.json();
        expect(decideResp.status(), JSON.stringify(decideBody)).toBe(200);
        expect(decideBody.approval.status).toBe("approved");

        const approvalRow = await withPosDb((client) =>
          client.query(`SELECT status, approved_by FROM tenant.pos_cart_discount_approvals WHERE approval_request_id=$1`, [pendingApproval.id]).then((r) => r.rows[0]),
        );
        expect(approvalRow.status).toBe("approved");
        // The REAL decider's own id, never anything the request could forge.
        expect(approvalRow.approved_by).toBe(world.manager.userId);
      } finally {
        await managerSession.context.close();
      }

      // With a real, current-version approval now on file, the sale can
      // complete for real.
      const finalComplete = await supervisorSession.page.request.post(`/api/pos/carts/${cart.id}/complete`, {
        headers: { origin },
        data: { payments: [{ method: "cash", amount: Number(discountedCart.grand_total) }], idempotencyKey: `e2e-approval-approved-${Date.now()}`, expectedVersion: discountedCart.version },
      });
      const finalBody = await finalComplete.json();
      expect(finalComplete.status(), JSON.stringify(finalBody)).toBe(201);
      expect(finalBody.sale.grand_total).toBe("147.500000"); // 125 taxable * 1.18
    } finally {
      await supervisorSession.context.close();
    }
  });

  test("DOCUMENTED GAP: a pos_manager without approvals.manage cannot see a pending POS discount request in the generic /approvals inbox list", async ({ browser }) => {
    const world = await getPosWorld();
    await resetTerminalCarts(world.supervisorTerminalId);

    const supervisorSession = await openPersonaSession(browser, world.supervisor);
    let approvalId: string;
    try {
      const [createResponse] = await Promise.all([
        supervisorSession.page.waitForResponse((res) => res.url().endsWith("/api/pos/carts") && res.request().method() === "POST"),
        supervisorSession.page.goto("/pos/checkout", { waitUntil: "domcontentloaded" }),
      ]);
      const cart = (await createResponse.json()).cart as { id: string; version: number };
      const origin = new URL(supervisorSession.page.url()).origin;
      const addLineResp = await supervisorSession.page.request.post(`/api/pos/carts/${cart.id}/lines`, {
        headers: { origin },
        data: { itemId: world.itemId, quantity: 1, expectedVersion: cart.version },
      });
      const pricedCart = (await addLineResp.json()).cart as { id: string; version: number; lines: Array<{ id: string }> };
      const discountResp = await supervisorSession.page.request.post(`/api/pos/carts/${cart.id}/lines/${pricedCart.lines[0].id}/discount`, {
        headers: { origin },
        data: { type: "percent", value: 50, reason: "e2e gap documentation", expectedVersion: pricedCart.version },
      });
      expect(discountResp.status()).toBe(200);
      const pendingApproval = await withPosDb((client) =>
        client
          .query(`SELECT id FROM public.approval_requests WHERE organization_id=$1 AND command_key='pos.discount.approve' AND entity_id=$2 ORDER BY requested_at DESC LIMIT 1`, [
            world.organizationId,
            cart.id,
          ])
          .then((r) => r.rows[0]),
      );
      approvalId = pendingApproval.id;
    } finally {
      await supervisorSession.context.close();
    }

    const managerSession = await openPersonaSession(browser, world.manager);
    try {
      await managerSession.page.goto("/pos", { waitUntil: "domcontentloaded" });
      const origin = new URL(managerSession.page.url()).origin;
      const listResp = await managerSession.page.request.get("/api/approvals?status=pending", { headers: { origin } });
      expect(listResp.status()).toBe(200);
      const approvals = (await listResp.json()).approvals as Array<{ id: string }>;
      expect(
        approvals.some((a) => a.id === approvalId),
        "current behavior: the pending request is NOT visible to a plain pos_manager via the generic approvals list (see file header comment)",
      ).toBe(false);

      // Yet the SAME manager can still decide it directly once they have
      // the id (e.g. via a notification, or this suite's own DB lookup) --
      // the decide endpoint's own authorization is correct even though
      // list discovery isn't wired up for this role.
      const decideResp = await managerSession.page.request.post(`/api/approvals/${approvalId}/decide`, { headers: { origin }, data: { decision: "rejected", note: "cleanup" } });
      expect(decideResp.status()).toBe(200);
    } finally {
      await managerSession.context.close();
    }
  });
});
