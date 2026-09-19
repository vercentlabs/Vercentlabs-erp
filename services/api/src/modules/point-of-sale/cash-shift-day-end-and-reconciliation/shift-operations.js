// POS-CAP-007 (F299-F305 cash, shift, day-end and reconciliation). Shift
// open/close lifecycle. Cash movements (F300) live alongside this in
// cash-movements.js; day-end/Z-report (F303), reconciliation (F304) and
// accounting posting (F305) belong in this same capability directory once
// built.
import { nextDocumentNumber } from "../../../core/document-numbering.js";
import { requireCompanyRecord } from "../../../core/references.js";
import { decimal, sub, asDatabaseDecimal } from "../../../core/decimal.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { event } from "../shared/audit.js";

export async function openShift(client, context, input) {
  requirePermission(context, "pos.shift.open");
  await assertPosStoreAccess(client, context, input.storeId, input.terminalId);
  const store = await requireCompanyRecord(client, context, "pos_store", input.storeId);
  const terminal = await requireCompanyRecord(client, context, "pos_terminal", input.terminalId);
  if (terminal.store_id !== store.id) {
    const error = new Error("The POS terminal does not belong to the selected store.");
    error.status = 409;
    error.code = "POS_TERMINAL_STORE_MISMATCH";
    throw error;
  }
  // Phase 2 (F270): input.cashierUserId let ANY caller with pos.shift.open
  // name an arbitrary user as the shift's cashier, with no check that
  // person is a real member, holds any POS permission, or has store
  // access -- opening a shift "as" someone else is a supervisory action
  // (assigning a cashier to a shift), not something an ordinary cashier
  // does for themselves, and the assigned cashier must be as eligible for
  // this store as the person opening the shift is.
  if (input.cashierUserId && input.cashierUserId !== context.userId) {
    if (!context.roleSlugs?.includes("organization_owner") && !context.permissions?.includes("pos.terminal.manage") && !context.permissions?.includes("pos.store.manage")) {
      throw posError(403, "You are not authorized to open a shift on behalf of another cashier.", "FORBIDDEN");
    }
    // Checked against the ASSIGNED cashier's own eligibility, not the
    // caller's -- deliberately not carrying over the caller's roleSlugs/
    // permissions (a supervisor's own pos.store.manage must not silently
    // vouch for someone else's store access).
    await assertPosStoreAccess(client, { organizationId: context.organizationId, companyId: context.companyId, userId: input.cashierUserId, roleSlugs: [], permissions: [] }, store.id, terminal.id);
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

  const shiftNumber = input.shiftNumber || await nextDocumentNumber(client, context, {
    documentType: `pos_shift:${input.terminalId}`,
    prefix: "SHIFT",
  });
  const shift = await client.query(
    `INSERT INTO tenant.pos_shifts
      (organization_id,company_id,store_id,terminal_id,shift_number,
       cashier_user_id,status,opening_cash,expected_cash,opened_at,opened_by)
     VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$7,now(),$8)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.storeId,
      input.terminalId,
      shiftNumber,
      input.cashierUserId || context.userId,
      String(input.openingCash || 0),
      context.userId,
    ],
  );
  if (Number(input.openingCash || 0) > 0) {
    const cashMovementNumber = await nextDocumentNumber(client, context, {
      documentType: "pos_cash_movement",
      prefix: "CASH",
    });
    await client.query(
      `INSERT INTO tenant.pos_cash_movements
        (organization_id,company_id,shift_id,movement_number,movement_type,
         amount,reason,created_by)
       VALUES ($1,$2,$3,$4,'opening',$5,'Opening float',$6)`,
      [
        context.organizationId,
        context.companyId,
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

export async function closeShift(client, context, shiftId, input) {
  requirePermission(context, "pos.shift.close");
  const shift = await client.query(
    `SELECT * FROM tenant.pos_shifts
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
       AND status='open' FOR UPDATE`,
    [context.organizationId, context.companyId, shiftId],
  );
  if (!shift.rows[0]) throw posError(404, "Open shift not found.", "POS_SHIFT_NOT_OPEN");
  await assertPosStoreAccess(client, context, shift.rows[0].store_id);

  // F302: a shift must not close out from under a cart still actively
  // being rung up (draft/priced), or an unresolved return (a supervisor
  // hasn't decided or completed it yet) -- both would silently orphan a
  // real in-flight transaction with no record of why the shift closed
  // while it existed. A HELD cart is deliberately excluded: holding is the
  // real-world "come back for this later" case, and a held cart carries no
  // payment or stock commitment yet -- it is designed to outlive the shift
  // that held it and be resumed on a later one (same terminal).
  const unresolvedCart = await client.query(
    `SELECT id FROM tenant.pos_carts WHERE organization_id=$1 AND company_id=$2 AND shift_id=$3 AND status IN ('draft','priced') LIMIT 1`,
    [context.organizationId, context.companyId, shiftId],
  );
  if (unresolvedCart.rows[0]) {
    throw posError(409, "Complete, hold, or cancel every active cart on this shift before closing it.", "POS_SHIFT_HAS_UNRESOLVED_CART");
  }
  const unresolvedReturn = await client.query(
    `SELECT id FROM tenant.pos_returns WHERE organization_id=$1 AND company_id=$2 AND shift_id=$3 AND status IN ('pending_approval','approved') LIMIT 1`,
    [context.organizationId, context.companyId, shiftId],
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
     SET status='closed',expected_cash=$4,counted_cash=$5,cash_variance=$6,
       closed_at=now(),closed_by=$7,close_notes=$8
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
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
