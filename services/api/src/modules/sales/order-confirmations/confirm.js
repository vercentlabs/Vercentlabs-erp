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
import { publishDomainEvent } from "../../../core/platform/events/index.js";
import { notifyRecordOwner } from "../../../core/platform/notifications/index.js";
import { updateDealFromConfirmedOrder } from "../../crm/quotations/order-sync.js";
import { accrueCommissionOnConfirmation } from "../pass1-operations.js";
import { assertOrderVisible, orderCan, requireOrderPermission } from "../orders/access.js";
import { FULFILLMENT, INVOICING, OrderError, STATUS, text } from "../orders/constants.js";
import { refreshSalesOrderProgress } from "../orders/progress.js";
import { reserveOrderLines } from "../reservations/service.js";
import { lockOrder, recordOrderEvent } from "../orders/versions.js";
import { CONFIRMATION_PERMISSIONS } from "./constants.js";
import { createOrderConfirmation, currentConfirmation } from "./snapshot.js";
import { evaluateConfirmation } from "./validation.js";

const EPSILON = 1e-6;

// input: { expectedVersionNumber?, quotationVarianceReason?, creditReleaseReason? }
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
  // An order held for credit is confirmed only by someone who can release it, saying why (Sales audit M1).
  const creditReason = text(input.creditReleaseReason, 1000) ?? "";
  if (check.credit?.held) {
    if (!orderCan(context, CONFIRMATION_PERMISSIONS.creditRelease))
      problems.push(`Held for credit: ${check.credit.reasons.join(" ")} Someone who can release credit (a Sales manager) must confirm it, or take a payment first.`);
    else if (creditReason.length < 5) problems.push(`Held for credit: ${check.credit.reasons.join(" ")} Say why it is released (at least 5 characters).`);
  }
  if (problems.length) {
    await recordOrderEvent(client, context, order.id, "sales_order.confirmation_refused", STATUS.draft, STATUS.draft, { problems });
    // Held for credit until it is confirmed (Sales plan): the Credit hold view and the home count it.
    if (check.credit?.held)
      await client.query(
        `UPDATE tenant.sales_orders SET credit_hold_since = COALESCE(credit_hold_since, clock_timestamp()), credit_hold_reasons = $3::jsonb WHERE organization_id = $1 AND id = $2`,
        [context.organizationId, order.id, JSON.stringify(check.credit.reasons)]);
    return { orderId: order.id, confirmed: false, status: STATUS.draft, changed: false, problems, warnings: check.warnings };
  }

  const reconfirmation = Number(order.confirmation_version ?? 0) > 0;
  await client.query(
    `UPDATE tenant.sales_orders
        SET lifecycle_status = $3, approval_status = 'not_required', fulfillment_status = $4, billing_status = $5, confirmed_at = now(), confirmed_by = $6,
            cancelled_at = NULL, cancelled_by = NULL, cancel_reason = NULL, cancel_reason_code = NULL, updated_by = $6, updated_at = now(),
            credit_hold_since = NULL, credit_hold_reasons = '[]'::jsonb, credit_release_requested_at = NULL, credit_release_requested_by = NULL
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, order.id, STATUS.confirmed, FULFILLMENT.notStarted, INVOICING.notInvoiced, context.userId ?? null]);
  await client.query(
    `UPDATE tenant.sales_order_line_progress progress SET confirmed_quantity = line.quantity, updated_by = $3, updated_at = now()
       FROM tenant.sales_order_lines line WHERE progress.sales_order_line_id = line.id AND line.organization_id = $1 AND line.sales_order_version_id = $2`,
    [context.organizationId, order.current_version_id, context.userId ?? null]);
  await recordOrderEvent(client, context, order.id, reconfirmation ? "sales_order.reconfirmed" : "sales_order.confirmed", STATUS.draft, STATUS.confirmed,
    { versionId: order.current_version_id, versionNumber: order.version_number, confirmationVersion: Number(order.confirmation_version ?? 0) + 1 });
  if (check.credit?.held)
    await recordOrderEvent(client, context, order.id, "sales_order.credit_released", STATUS.confirmed, STATUS.confirmed,
      { reason: creditReason, reasons: check.credit.reasons, exposure: check.credit.exposureWithOrder, creditLimit: check.credit.creditLimit, overdueDays: check.credit.overdueDays });
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
    await accrueCommissionOnConfirmation(client, context, order.id);
    await client.query("RELEASE SAVEPOINT sales_order_commission");
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT sales_order_commission");
  }
  // The deal the order came from now carries what was ordered (CRM); like commission, it never blocks the confirmation.
  let deal = null;
  if (order.source_opportunity_id) {
    await client.query("SAVEPOINT sales_order_deal_value");
    try {
      deal = await updateDealFromConfirmedOrder(client, context, order.id);
      await client.query("RELEASE SAVEPOINT sales_order_deal_value");
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT sales_order_deal_value");
    }
  }
  // Make-to-order (Sales report Phase 3): the "buy" and "make" lines raise their purchase or production; never blocks the confirmation.
  const { raiseSupplyForOrder } = await import("../supply.js");
  const supply = await raiseSupplyForOrder(client, context, order);
  await publishDomainEvent(client, { organizationId: context.organizationId, moduleKey: "sales", eventType: "sales.order.confirmed", entityType: "sales.order", entityId: order.id,
    payload: { orderNumber: order.sales_order_number, customerId: order.party_id, ownerUserId: order.owner_user_id, total: order.grand_total, currencyCode: order.currency_code?.trim() } });
  await notifyRecordOwner(client, context, { userId: order.owner_user_id ?? order.created_by, category: "sales_document",
    title: `Sales order ${order.sales_order_number} was confirmed`, message: "It is confirmed; stock is kept aside where it was available.",
    href: `/sales/orders/${order.id}`, entityType: "sales_order", entityId: order.id });
  return {
    orderId: order.id, confirmed: true, status: STATUS.confirmed, changed: true, confirmationId: confirmation.id, confirmationVersion: confirmation.version,
    fulfillmentStatus: progress.fulfillmentStatus, reservation, shortages: check.shortages, warnings: check.warnings, sourceOpportunityId: order.source_opportunity_id ?? null,
    dealValueUpdated: Boolean(deal?.changed),
    supply: supply.map((row) => ({ sequence: row.line_sequence, route: row.route, documentType: row.document_type, documentNumber: row.document_number, error: row.error })),
  };
}

// A salesperson asks for an order held for credit to be released (Sales plan, Flow 1): everyone who can release credit is told, once per
// hold. Releasing is confirming with a reason (above). input: { note? }
export async function requestCreditRelease(client, context, orderId, input = {}) {
  requireOrderPermission(context, CONFIRMATION_PERMISSIONS.confirm, "You do not have permission to confirm sales orders.");
  const order = await lockOrder(client, context, orderId);
  await assertOrderVisible(client, context, order.id);
  if (order.lifecycle_status !== STATUS.draft || !order.credit_hold_since)
    throw new OrderError(409, "This order is not held for credit. Confirm it to check the customer's credit.", "SALES_ORDER_NOT_CREDIT_HELD");
  if (order.credit_release_requested_at) return { orderId: order.id, requested: true, told: 0, replayed: true };
  const note = text(input.note, 500);
  await client.query(`UPDATE tenant.sales_orders SET credit_release_requested_at = clock_timestamp(), credit_release_requested_by = $3 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, order.id, context.userId ?? null]);
  await recordOrderEvent(client, context, order.id, "sales_order.credit_release_requested", STATUS.draft, STATUS.draft, { note: note ?? undefined, reasons: order.credit_hold_reasons });
  const { notifyPermissionHolders } = await import("../../../core/platform/notifications/service.js");
  const told = await notifyPermissionHolders(client, context, CONFIRMATION_PERMISSIONS.creditRelease, {
    category: "sales_credit_release", title: `Order ${order.sales_order_number} is held for credit`,
    message: [...(Array.isArray(order.credit_hold_reasons) ? order.credit_hold_reasons : []), note].filter(Boolean).join(" ").slice(0, 500) || "Asked to release it.",
    href: `/sales/orders/${order.id}`, entityType: "sales_order", entityId: order.id,
  });
  return { orderId: order.id, requested: true, told, replayed: false };
}
