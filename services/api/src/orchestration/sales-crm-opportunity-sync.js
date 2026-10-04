// The side effects that run after a Sales order is confirmed or cancelled but
// cannot live inside confirmSalesOrder/cancelSalesOrder: commission accrual
// and stock reservation release. The CRM opportunity is never closed or
// reopened from here: winning a deal is the explicit Mark won action (with
// its won reason), and a won deal with a sales order is not reopened; new
// work becomes a new opportunity.
import { confirmSalesOrder, cancelSalesOrder } from "../modules/sales/index.js";
import { accrueSalesCommission } from "../modules/sales/pass1-operations.js";
import { releaseSalesOrderStockReservationsOnCancel } from "./sales-stock-reservation.js";

// accrueSalesCommission requires sales.settings.manage - the confirming rep
// won't usually hold that. Elevated, tenant-scoped internal step, same
// shape as stockSyncContext below.
function commissionAccrualContext(salesContext) {
  return {
    organizationId: salesContext.organizationId,
    userId: salesContext.userId,
    permissions: ["sales.settings.manage"],
    roleSlugs: [],
  };
}

// Releasing a reservation needs Stock rights the cancelling rep may not hold.
function stockSyncContext(salesContext) {
  return {
    organizationId: salesContext.organizationId,
    userId: salesContext.userId,
    permissions: ["stock.view", "stock.reserve"],
    roleSlugs: [],
  };
}

export async function confirmSalesOrderWithCrmSync(
  client,
  salesContext,
  orderId,
  options = {},
) {
  const result = await confirmSalesOrder(client, salesContext, orderId, options);
  // F057 gap: accrueSalesCommission (a real, correct calculation engine -
  // rule precedence, net_sales/gross_margin basis, idempotent
  // upsert-by-natural-key) was only ever reachable via a manual action,
  // with nothing triggering it automatically. Order confirmation is the
  // natural trigger point.
  // Most orders have no applicable commission rule configured at all -
  // that's an expected, common outcome, not a failure, so this is
  // unconditionally best-effort.
  try {
    await accrueSalesCommission(client, commissionAccrualContext(salesContext), {
      salesOrderId: orderId,
    });
  } catch {
    // Best-effort - no applicable commission rule is a normal outcome, and
    // a commission-configuration issue must never block order confirmation.
  }
  return result;
}

export async function cancelSalesOrderWithCrmSync(
  client,
  salesContext,
  orderId,
  reason,
) {
  const result = await cancelSalesOrder(client, salesContext, orderId, reason);
  // F046 gap: nothing released the stock reservation(s) created against this
  // order's lines when the order was cancelled, leaving reserved_quantity
  // permanently inflated. A missing/inconsistent reservation is a normal
  // outcome (not every order reserves stock), so this stays best-effort like
  // the commission accrual above.
  try {
    await releaseSalesOrderStockReservationsOnCancel(
      client,
      stockSyncContext(salesContext),
      orderId,
    );
  } catch {
    // Best-effort - order cancellation already succeeded and must stand.
  }
  return result;
}
