// POS-CAP-005 (F293 exchanges). See return-lifecycle.js and
// assortment-pricing-customer-and-cart/sale-completion.js for the two
// primitives this composes.
import { posError } from "../shared/errors.js";
import { requirePermission } from "../shared/access-control.js";
import { completePointOfSaleReturn } from "./return-lifecycle.js";
import { completePosCart } from "../assortment-pricing-customer-and-cart/sale-completion.js";

// F293 -- exchange as linked lineage, never a destructive mutation. This
// deliberately does NOT duplicate any return/sale/stock/cash logic: it
// calls the existing, already-tested completePointOfSaleReturn() and
// completePosCart() exactly once each, inside the SAME transaction (so a
// failure partway through rolls back both -- an exchange never persists
// half-done), then stamps the lineage column added for this. The return
// must already exist and be 'approved' (the normal return maker-checker
// flow, unchanged); the replacement cart must already be a normal priced
// cart with the new item(s) on it (the normal checkout flow, unchanged).
//
// Settlement is deliberately NOT netted into a single payment: the return
// posts its own real refund cash movement (exactly as any return does)
// and the replacement sale posts its own real sale cash movement
// (exactly as any sale does, requiring cash payment for its own full
// grand_total) -- for an equal-value exchange these naturally offset in
// the till; for an uneven one, the customer physically receives the
// return's refund and physically pays the new sale's total, which is
// economically identical to netting without inventing a third settlement
// calculation this pass would otherwise have to get exactly right on its
// own. Cash-only, matching every other payment path in this pass.
export async function completePosExchange(client, context, input) {
  // Completing an exchange completes its return half too -- the same
  // supervisor-level authority completePointOfSaleReturn itself already
  // requires (pos.return.approve), checked here up front for a clear
  // error rather than surfacing from deep inside that call. A plain
  // cashier (pos.sale.create only) cannot execute an exchange alone, the
  // same as they cannot complete an ordinary return's refund alone.
  requirePermission(context, "pos.sale.create");
  requirePermission(context, "pos.return.approve");
  if (!input.returnId) throw posError(400, "The return being exchanged is required.", "POS_EXCHANGE_RETURN_REQUIRED");
  if (!input.cartId) throw posError(400, "The replacement cart is required.", "POS_EXCHANGE_CART_REQUIRED");

  const returnCheck = await client.query(`SELECT status FROM tenant.pos_returns WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [
    context.organizationId,
    context.companyId,
    input.returnId,
  ]);
  if (!returnCheck.rows[0]) throw posError(404, "POS return was not found.", "POS_RETURN_NOT_FOUND");
  if (returnCheck.rows[0].status !== "approved") {
    throw posError(409, "The return must be approved before it can be exchanged.", "POS_RETURN_NOT_APPROVED");
  }

  const returnResult = await completePointOfSaleReturn(client, context, input.returnId, { idempotencyKey: `${input.idempotencyKey}:return` });
  const saleResult = await completePosCart(client, context, input.cartId, {
    idempotencyKey: `${input.idempotencyKey}:sale`,
    payments: input.payments,
    expectedVersion: input.expectedVersion,
    expectedGrandTotal: input.expectedGrandTotal,
  });
  await client.query(`UPDATE tenant.pos_sales SET exchange_return_id=$3 WHERE organization_id=$1 AND id=$2`, [
    context.organizationId,
    saleResult.id,
    input.returnId,
  ]);
  return { return: returnResult, sale: { ...saleResult, exchange_return_id: input.returnId } };
}
