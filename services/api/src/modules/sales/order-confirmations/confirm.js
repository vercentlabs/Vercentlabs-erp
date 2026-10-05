// Draft → Confirmed: the seller's commitment to the order.
//
// In one transaction: the order is validated and priced again
// (validation.js), becomes Confirmed with who confirmed it and when, its
// confirmation snapshot is written as the next revision, and, when Sales
// settings say so, the stock that is available is reserved. Confirmed is not
// Reserved: a shortage never stops a confirmation, and services are never
// reserved.
//
// The confirm runs against the version the user reviewed: a change saved by
// someone else in between is refused. Confirming an order that is already
// confirmed changes nothing and returns its confirmation, so a double click
// or a retried request never makes a second revision.
//
// A refused attempt is recorded on the order's history with its reasons.
import { accrueSalesCommission } from "../pass1-operations.js";
import { assertOrderVisible, orderCan, requireOrderPermission } from "../orders/access.js";
import { FULFILLMENT, INVOICING, OrderError, STATUS, text } from "../orders/constants.js";
import { refreshSalesOrderProgress } from "../orders/progress.js";
import { reserveOrderLines } from "../orders/stock.js";
import { lockOrder, recordOrderEvent } from "../orders/versions.js";
import { CONFIRMATION_PERMISSIONS } from "./constants.js";
import { createOrderConfirmation, currentConfirmation } from "./snapshot.js";
import { evaluateConfirmation } from "./validation.js";

const EPSILON = 1e-6;

// input: { expectedVersionNumber?, quotationVarianceReason? }
// Returns { confirmed: false, problems } when the order is not ready.
export async function confirmSalesOrder(client, context, orderId, input = {}) {
  requireOrderPermission(context, CONFIRMATION_PERMISSIONS.confirm, "You do not have permission to confirm sales orders.");
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  if ([STATUS.confirmed, STATUS.closed].includes(order.lifecycle_status) && order.confirmed_at) {
    const current = await currentConfirmation(client, context.organizationId, order.id);
    return {
      orderId: order.id, confirmed: true, status: order.lifecycle_status, changed: false, confirmationId: current?.id ?? null, confirmationVersion: current?.version ?? null,
      sourceOpportunityId: order.source_opportunity_id ?? null,
    };
  }
  if (order.lifecycle_status !== STATUS.draft) throw new OrderError(409, `A ${order.lifecycle_status} order cannot be confirmed.`, "SALES_ORDER_NOT_DRAFT");
  if (input.expectedVersionNumber != null && Number(input.expectedVersionNumber) !== Number(order.version_number))
    throw new OrderError(409, "The order was modified. Review the latest changes before confirming.", "SALES_ORDER_VERSION_CONFLICT");

  const check = await evaluateConfirmation(client, context, order);
  const problems = [...check.problems];
  const varianceReason = text(input.quotationVarianceReason, 1000);
  if (check.quotation?.differs) {
    if (!orderCan(context, CONFIRMATION_PERMISSIONS.quoteVariance))
      problems.push(`This order differs from the accepted quotation ${check.quotation.quotationNumber}. Confirming it needs the permission to confirm orders that differ from the quotation.`);
    else if (!varianceReason) problems.push(`Say why this order differs from the accepted quotation ${check.quotation.quotationNumber}.`);
  }
  if (problems.length) {
    await recordOrderEvent(client, context, order.id, "sales_order.confirmation_refused", STATUS.draft, STATUS.draft, { problems });
    return { orderId: order.id, confirmed: false, status: STATUS.draft, changed: false, problems, warnings: check.warnings };
  }

  const reconfirmation = Number(order.confirmation_version ?? 0) > 0;
  await client.query(
    `UPDATE tenant.sales_orders
        SET lifecycle_status = $3, approval_status = 'not_required', fulfillment_status = $4, billing_status = $5, confirmed_at = now(), confirmed_by = $6,
            cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL, cancel_reason_code = NULL, updated_by = $6, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, order.id, STATUS.confirmed, FULFILLMENT.notStarted, INVOICING.notInvoiced, context.userId ?? null]);
  await client.query(
    `UPDATE tenant.sales_order_line_progress progress SET confirmed_quantity = line.quantity, updated_by = $3, updated_at = now()
       FROM tenant.sales_order_lines line WHERE progress.sales_order_line_id = line.id AND line.organization_id = $1 AND line.sales_order_version_id = $2`,
    [context.organizationId, order.current_version_id, context.userId ?? null]);
  await recordOrderEvent(client, context, order.id, reconfirmation ? "sales_order.reconfirmed" : "sales_order.confirmed", STATUS.draft, STATUS.confirmed,
    { versionId: order.current_version_id, versionNumber: order.version_number, confirmationVersion: Number(order.confirmation_version ?? 0) + 1 });
  // The snapshot is part of confirming: if it cannot be written, nothing is confirmed.
  const confirmation = await createOrderConfirmation(client, context, { ...order, lifecycle_status: STATUS.confirmed },
    { variance: check.quotation?.differs ? check.quotation : null, varianceReason: check.quotation?.differs ? varianceReason : null });

  // Reserve what is available now, in the same transaction, when Sales settings say so.
  let reservation = [];
  if (check.reservesOnConfirm) {
    reservation = await reserveOrderLines(client, context, order);
    const reserved = reservation.filter((line) => line.reserved > EPSILON);
    if (reserved.length)
      await recordOrderEvent(client, context, order.id, "sales_order.stock_reserved", STATUS.confirmed, STATUS.confirmed,
        { lines: reserved.map((line) => ({ item: line.itemName, quantity: line.reserved })), short: reservation.filter((line) => line.problem).length, automatic: true });
  }
  const progress = await refreshSalesOrderProgress(client, context.organizationId, order.id, context.userId ?? null);
  // Commission accrues when a rule applies; having none is the usual case and never blocks an order.
  await client.query("SAVEPOINT sales_order_commission");
  try {
    await accrueSalesCommission(client, { organizationId: context.organizationId, userId: context.userId ?? null, permissions: ["sales.settings.manage"], roleSlugs: [] }, { salesOrderId: order.id });
    await client.query("RELEASE SAVEPOINT sales_order_commission");
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT sales_order_commission");
  }
  return {
    orderId: order.id, confirmed: true, status: STATUS.confirmed, changed: true, confirmationId: confirmation.id, confirmationVersion: confirmation.version,
    fulfillmentStatus: progress.fulfillmentStatus, reservation, shortages: check.shortages, warnings: check.warnings, sourceOpportunityId: order.source_opportunity_id ?? null,
  };
}
