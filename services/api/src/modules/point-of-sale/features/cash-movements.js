// F300 -- paid-in/paid-out cash movements. pos_cash_movements.movement_type
// already accepted 'paid_in'/'paid_out' in the schema (migration 048) and
// pos.cash.adjust already existed as a permission, but no domain function
// ever created one -- opening/sale/refund were the only movement types
// anything actually wrote. Every movement is immutable once inserted (no
// update/delete function exists for this table anywhere in the module);
// correcting a mistake means recording an offsetting movement with its own
// reason, never editing history.
import { nextDocumentNumber } from "../../../core/document-numbering.js";
import { decimal, asDatabaseDecimal } from "../../../core/decimal.js";
import { assertPosStoreAccess } from "./cart.js";
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";

function posError(status, message, code) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function requirePermission(context, permission) {
  if (!context.roleSlugs?.includes("organization_owner") && !context.permissions?.includes(permission)) {
    const error = new Error(`Missing permission: ${permission}`);
    error.code = "FORBIDDEN";
    throw error;
  }
}

// Same sign convention completePointOfSaleReturn's refund movement already
// uses: positive = cash added to the drawer, negative = cash removed --
// closeShift sums this column directly to compute expected_cash.
export async function recordPosCashMovement(client, context, shiftId, input) {
  requirePermission(context, "pos.cash.adjust");
  const movementType = input.movementType;
  if (!["paid_in", "paid_out"].includes(movementType)) {
    throw posError(400, "Cash movement type must be paid_in or paid_out.", "POS_CASH_MOVEMENT_TYPE_INVALID");
  }
  const amount = decimal(input.amount);
  if (!(amount > 0n)) throw posError(400, "Amount must be greater than zero.", "POS_CASH_MOVEMENT_AMOUNT_INVALID");
  if (!input.reason || !String(input.reason).trim()) throw posError(400, "A reason is required.", "POS_CASH_MOVEMENT_REASON_REQUIRED");

  const shift = await client.query(
    `SELECT * FROM tenant.pos_shifts WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='open'`,
    [context.organizationId, context.companyId, shiftId],
  );
  if (!shift.rows[0]) throw posError(409, "An open shift is required to record a cash movement.", "POS_SHIFT_NOT_OPEN");
  await assertPosStoreAccess(client, context, shift.rows[0].store_id);

  // SECURITY (consolidated pass, item #23): this financial mutation had no
  // idempotency protection at all -- a client retry (timeout, double-tap)
  // could double-post a paid-in/paid-out movement with no way to detect it
  // after the fact. Same reserve-then-complete pattern completePosCart and
  // the other checkout/return/exchange paths already use.
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "pos.cash_movement.record",
    key: input.idempotencyKey,
    payload: { ...input, idempotencyKey: undefined },
    required: true,
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  const signedAmount = movementType === "paid_out" ? -amount : amount;
  const movementNumber = await nextDocumentNumber(client, context, { documentType: "pos_cash_movement", prefix: "CASH" });
  const result = await client.query(
    `INSERT INTO tenant.pos_cash_movements (organization_id,company_id,shift_id,movement_number,movement_type,amount,reason,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [context.organizationId, context.companyId, shiftId, movementNumber, movementType, asDatabaseDecimal(signedAmount), String(input.reason).trim(), context.userId],
  );
  const response = result.rows[0];
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "pos_cash_movement", aggregateId: response.id });
  return response;
}

export async function listPosCashMovements(client, context, shiftId) {
  requirePermission(context, "pos.view");
  const shift = await client.query(`SELECT store_id FROM tenant.pos_shifts WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [
    context.organizationId,
    context.companyId,
    shiftId,
  ]);
  if (!shift.rows[0]) throw posError(404, "Shift was not found.", "POS_SHIFT_NOT_FOUND");
  await assertPosStoreAccess(client, context, shift.rows[0].store_id);
  const result = await client.query(
    `SELECT * FROM tenant.pos_cash_movements WHERE organization_id=$1 AND company_id=$2 AND shift_id=$3 ORDER BY created_at`,
    [context.organizationId, context.companyId, shiftId],
  );
  return result.rows;
}
