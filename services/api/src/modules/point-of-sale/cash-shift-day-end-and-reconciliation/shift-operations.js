// POS-CAP-007 (F299-F305 cash, shift, day-end and reconciliation). The shift detail; opening is shift-opening.js (0103), closing is shift-closing.js (0105). Cash
// movements (F300) live alongside this in cash-movements.js; day-end/Z-report (F303), reconciliation (F304) and accounting posting (F305)
// belong in this same capability directory.
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";

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
