// POS-CAP-007 (F299-F305 cash, shift, day-end and reconciliation). Shift
// open/close lifecycle. Cash movements (F300) live alongside this in
// cash-movements.js; day-end/Z-report (F303), reconciliation (F304) and
// accounting posting (F305) belong in this same capability directory.
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { requireOrganizationRecord } from "../../../core/references.js";
import { decimal, sub, asDatabaseDecimal } from "../../../core/decimal.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { event } from "../shared/audit.js";
import { assertTerminalCanOpenSession, PosTerminalError } from "../terminals/index.js";
import { assertCashierCanOpenSession, PosCashierError } from "../cashiers/index.js";
import { assertPosAction } from "../permissions/index.js";

export async function openShift(client, context, input) {
  // POS module access; opening is the cashier's SESSION_OPEN_OWN grant, checked below.
  requirePermission(context, "pos.view");
  await assertPosStoreAccess(client, context, input.storeId, input.terminalId);
  const store = await requireOrganizationRecord(client, context, "pos_store", input.storeId);
  const terminal = await requireOrganizationRecord(client, context, "pos_terminal", input.terminalId);
  if (terminal.store_id !== store.id) {
    const error = new Error("The POS terminal does not belong to the selected store.");
    error.status = 409;
    error.code = "POS_TERMINAL_STORE_MISMATCH";
    throw error;
  }
  // F270: input.cashierUserId must not let ANY caller with pos.shift.open
  // name an arbitrary user as the shift's cashier -- opening a shift "as"
  // someone else is a supervisory action
  // (assigning a cashier to a shift), not something an ordinary cashier
  // does for themselves, and the assigned cashier must be as eligible for
  // this store as the person opening the shift is.
  if (input.cashierUserId && input.cashierUserId !== context.userId) {
    if (!context.roleSlugs?.includes("organization_owner") && !context.permissions?.includes("pos.terminal.manage") && !context.permissions?.includes("pos.store.manage")) {
      throw posError(403, "You are not authorized to open a shift on behalf of another cashier.", "FORBIDDEN");
    }
    // The assigned cashier's own eligibility is checked below (assertCashierCanOpenSession), never vouched for by the caller's.
  }
  // F301: previously relied only on the DB's one-open-shift-per-terminal
  // unique index to reject a genuine double-attempt -- correct for a
  // DIFFERENT request racing in, but a retry of the SAME request (client
  // timeout, double-tap) had no replay contract: it would just hit the
  // same unique-index violation and surface as a raw error instead of
  // safely returning the shift that already opened. Same reserve-then-
  // complete idempotency primitive every other POS financial mutation
  // uses (see cash-movements.js's recordPosCashMovement).
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.shift.open",
    key: input.idempotencyKey,
    payload: { ...input, idempotencyKey: undefined },
    required: true,
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  // An active terminal at an active outlet, with no session open on it; a terminal that does not manage cash takes no opening float.
  await assertTerminalCanOpenSession(client, context, terminal.id, { openingCash: input.openingCash });
  // The session's cashier: an active cashier profile with access to this outlet, an active user, a POS operating permission, and no other
  // session open anywhere (one drawer at a time).
  await assertCashierCanOpenSession(client, context, { outletId: store.id, userId: input.cashierUserId || context.userId });
  // Opening a session is the cashier's own SESSION_OPEN_OWN (their profile, not the opener's when a supervisor opens it for them).
  await assertPosAction(client, { ...context, userId: input.cashierUserId || context.userId }, { permission: "SESSION_OPEN_OWN", outletId: store.id });

  const shiftNumber = input.shiftNumber || await nextDocumentNumber(client, context, {
    documentType: `pos_shift:${input.terminalId}`,
    prefix: "SHIFT",
  });
  // Two cashiers opening the same terminal at once: the one-open-session-per-terminal index lets exactly one through.
  await client.query("SAVEPOINT pos_shift_open");
  const shift = await client.query(
    `INSERT INTO tenant.pos_shifts
      (organization_id,store_id,terminal_id,shift_number,
       cashier_user_id,status,opening_cash,expected_cash,opened_at,opened_by)
     VALUES ($1,$2,$3,$4,$5,'open',$6,$6,now(),$7)
     RETURNING *`,
    [
      context.organizationId,
      input.storeId,
      input.terminalId,
      shiftNumber,
      input.cashierUserId || context.userId,
      String(input.openingCash || 0),
      context.userId,
    ],
  ).catch(async (error) => {
    await client.query("ROLLBACK TO SAVEPOINT pos_shift_open");
    if (error?.code === "23505" && error.constraint === "pos_terminal_open_shift_uidx")
      throw new PosTerminalError(409, `Terminal ${terminal.code} already has an active POS session.`, "TERMINAL_SESSION_ALREADY_OPEN");
    if (error?.code === "23505" && error.constraint === "pos_cashier_open_shift_uidx")
      throw new PosCashierError(409, "This cashier already has an active POS session.", "CASHIER_SESSION_ALREADY_OPEN");
    throw error;
  });
  await client.query("RELEASE SAVEPOINT pos_shift_open");
  if (Number(input.openingCash || 0) > 0) {
    const cashMovementNumber = await nextDocumentNumber(client, context, {
      documentType: "pos_cash_movement",
      prefix: "CASH",
    });
    await client.query(
      `INSERT INTO tenant.pos_cash_movements
        (organization_id,shift_id,movement_number,movement_type,
         amount,reason,created_by)
       VALUES ($1,$2,$3,'opening',$4,'Opening float',$5)`,
      [
        context.organizationId,
        shift.rows[0].id,
        cashMovementNumber,
        String(input.openingCash || 0),
        context.userId,
      ],
    );
  }
  await event(client, context, "shift", shift.rows[0].id, "pos.shift.opened");
  const response = shift.rows[0];
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_shift", aggregateId: response.id });
  return response;
}

// Shift-detail workspace (F301/F302 UI): the shift row itself plus enough
// of its own transactions -- sales, tendered payments, cash movements --
// to explain expected/counted/variance without a second round trip per
// section. Read-only, so no FOR UPDATE lock and no store-access mutation
// gate; still store-scoped like every other per-shift read in this module.
export async function getPosShift(client, context, shiftId) {
  requirePermission(context, "pos.view");
  const shift = await client.query(`SELECT * FROM tenant.pos_shifts WHERE organization_id=$1 AND id=$2`, [
    context.organizationId,
    shiftId,
  ]);
  if (!shift.rows[0]) throw posError(404, "Shift was not found.", "POS_SHIFT_NOT_FOUND");
  await assertPosStoreAccess(client, context, shift.rows[0].store_id);

  const cashMovements = await client.query(
    `SELECT * FROM tenant.pos_cash_movements WHERE organization_id=$1 AND shift_id=$2 ORDER BY created_at`,
    [context.organizationId, shiftId],
  );
  const sales = await client.query(
    `SELECT id, receipt_number, customer_name, grand_total, status, created_at
     FROM tenant.pos_sales WHERE organization_id=$1 AND shift_id=$2 ORDER BY created_at`,
    [context.organizationId, shiftId],
  );
  const payments = await client.query(
    `SELECT payment_method, status, sum(amount)::text AS amount, count(*)::int AS count
     FROM tenant.pos_payments WHERE organization_id=$1 AND shift_id=$2
     GROUP BY payment_method, status ORDER BY payment_method, status`,
    [context.organizationId, shiftId],
  );

  return {
    ...shift.rows[0],
    cashMovements: cashMovements.rows,
    sales: sales.rows,
    paymentBreakdown: payments.rows,
  };
}

export async function closeShift(client, context, shiftId, input) {
  // POS module access; closing is SESSION_CLOSE_OWN (or a supervisor's SESSION_CLOSE_OTHER), checked below.
  requirePermission(context, "pos.view");
  const shift = await client.query(
    `SELECT * FROM tenant.pos_shifts
     WHERE organization_id=$1 AND id=$2
       AND status='open' FOR UPDATE`,
    [context.organizationId, shiftId],
  );
  if (!shift.rows[0]) throw posError(404, "Open shift not found.", "POS_SHIFT_NOT_OPEN");
  await assertPosStoreAccess(client, context, shift.rows[0].store_id);
  // Closing your own session is SESSION_CLOSE_OWN; closing someone else's is a supervisor's SESSION_CLOSE_OTHER, with a reason. Either way
  // the session keeps its cashier, opening cash and transactions.
  if (shift.rows[0].cashier_user_id === context.userId) await assertPosAction(client, context, { permission: "SESSION_CLOSE_OWN", outletId: shift.rows[0].store_id });
  else await assertPosAction(client, context, { permission: "SESSION_CLOSE_OTHER", outletId: shift.rows[0].store_id, reason: input?.reason ?? input?.closeNotes ?? input?.notes });

  // F302: a shift must not close out from under a cart still actively
  // being rung up (draft/priced), or an unresolved return (a supervisor
  // hasn't decided or completed it yet) -- both would silently orphan a
  // real in-flight transaction with no record of why the shift closed
  // while it existed. A HELD cart is deliberately excluded: holding is the
  // real-world "come back for this later" case, and a held cart carries no
  // payment or stock commitment yet -- it is designed to outlive the shift
  // that held it and be resumed on a later one (same terminal).
  const unresolvedCart = await client.query(
    `SELECT id FROM tenant.pos_carts WHERE organization_id=$1 AND shift_id=$2 AND status IN ('draft','priced') LIMIT 1`,
    [context.organizationId, shiftId],
  );
  if (unresolvedCart.rows[0]) {
    throw posError(409, "Complete, hold, or cancel every active cart on this shift before closing it.", "POS_SHIFT_HAS_UNRESOLVED_CART");
  }
  const unresolvedReturn = await client.query(
    `SELECT id FROM tenant.pos_returns WHERE organization_id=$1 AND shift_id=$2 AND status IN ('pending_approval','approved') LIMIT 1`,
    [context.organizationId, shiftId],
  );
  if (unresolvedReturn.rows[0]) {
    throw posError(409, "Resolve every pending return on this shift before closing it.", "POS_SHIFT_HAS_UNRESOLVED_RETURN");
  }

  const cash = await client.query(
    `SELECT coalesce(sum(amount),0)::text AS expected_cash
     FROM tenant.pos_cash_movements
     WHERE organization_id=$1 AND shift_id=$2`,
    [context.organizationId, shiftId],
  );
  // F302: was `Number(...) - Number(...)` -- native floating-point
  // arithmetic for a financial variance figure that feeds the shift
  // record, the audit event, and (via F303) the day-end Z report. Every
  // other monetary calculation in this module goes through the
  // fixed-point decimal utilities (core/decimal.js); this one didn't.
  const expected = decimal(cash.rows[0].expected_cash);
  const counted = decimal(input.countedCash);
  const variance = sub(counted, expected);

  const result = await client.query(
    `UPDATE tenant.pos_shifts
     SET status='closed',expected_cash=$3,counted_cash=$4,cash_variance=$5,
       closed_at=now(),closed_by=$6,close_notes=$7
     WHERE organization_id=$1 AND id=$2
     RETURNING *`,
    [
      context.organizationId,
      shiftId,
      asDatabaseDecimal(expected),
      asDatabaseDecimal(counted),
      asDatabaseDecimal(variance),
      context.userId,
      input.closeNotes || null,
    ],
  );
  await event(client, context, "shift", shiftId, "pos.shift.closed", {
    expected: asDatabaseDecimal(expected),
    counted: asDatabaseDecimal(counted),
    variance: asDatabaseDecimal(variance),
  });
  return result.rows[0];
}
