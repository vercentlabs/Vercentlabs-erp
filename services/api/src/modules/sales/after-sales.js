import { SalesError } from "./index.js";

// F051–F057: the governed lifecycles behind the after-sales requests. Each
// request could be created but never moved on; here they are decided,
// fulfilled, applied or reversed, with the actor, time and reason kept, and
// every quantity or amount checked against what the order actually allows.
// Stock and Accounting stay authoritative for stock and posted money: Sales
// only records its own side and hands off.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid = (value, label) => {
  if (!UUID.test(String(value || ""))) throw new SalesError(400, `${label} is invalid.`, "SALES_REFERENCE_INVALID");
  return String(value);
};
const text = (value, max = 2000) => String(value ?? "").trim().slice(0, max);
const round = (value) => Math.round(Number(value) * 100) / 100;
const can = (c, permission) => c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(permission);
const need = (c, permission) => {
  if (!can(c, permission)) throw new SalesError(403, "You do not have permission to perform this Sales operation.");
};
const reasonOf = (value, label = "reason") => {
  const reason = text(value);
  if (reason.length < 5) throw new SalesError(400, `Give a ${label} (at least 5 characters).`, "SALES_REASON_REQUIRED");
  return reason;
};
async function orderEvent(client, c, orderId, eventType, metadata) {
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id,entity_type,entity_id,event_type,from_status,to_status,metadata,actor_user_id)
     SELECT $1,'sales_order',$2,$3,lifecycle_status,lifecycle_status,$4::jsonb,$5 FROM tenant.sales_orders WHERE organization_id=$1 AND id=$2`,
    [c.organizationId, orderId, eventType, JSON.stringify(metadata), c.userId || null],
  );
}

// ---- F053 one credit exposure for the screen and for confirmation -------------
// Unpaid invoices (net of unapplied receipts) plus the not-yet-invoiced part of
// open orders — the same figures confirmation checks, so the Credit tab can no
// longer say "available" while confirming is blocked.
export async function getSalesCustomerCreditExposure(client, c, partyId) {
  need(c, "sales.view");
  const id = uuid(partyId, "Customer");
  const { rows } = await client.query(
    `SELECT party.credit_limit, party.currency_code,
        COALESCE((SELECT sum(outstanding_amount) FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND party_id=$2 AND status NOT IN ('draft','void','paid','cancelled','reversed')),0) AS ar_outstanding,
        COALESCE((SELECT sum(unapplied_amount) FROM tenant.accounting_customer_receipts WHERE organization_id=$1 AND party_id=$2 AND status IN ('posted','partially_applied')),0) AS unapplied_receipts,
        COALESCE((SELECT sum(line.line_total*version.exchange_rate*greatest(line.quantity-progress.invoiced_quantity-progress.cancelled_quantity,0)/NULLIF(line.quantity,0))
                    FROM tenant.sales_orders orders
                    JOIN tenant.sales_order_versions version ON version.id=orders.current_version_id
                    JOIN tenant.sales_order_lines line ON line.sales_order_version_id=version.id
                    JOIN tenant.sales_order_line_progress progress ON progress.sales_order_line_id=line.id
                   WHERE orders.organization_id=$1 AND orders.party_id=$2 AND orders.lifecycle_status IN ('confirmed','on_hold') AND orders.billing_status<>'fully_invoiced'),0) AS open_orders
       FROM tenant.business_parties party WHERE party.organization_id=$1 AND party.id=$2`,
    [c.organizationId, id],
  );
  const row = rows[0];
  if (!row) throw new SalesError(404, "Customer not found.");
  const creditLimit = Number(row.credit_limit || 0);
  const arOutstanding = round(row.ar_outstanding);
  const unappliedAdvances = round(row.unapplied_receipts);
  const openOrderValue = round(row.open_orders);
  const netExposure = round(Math.max(0, arOutstanding - unappliedAdvances) + openOrderValue);
  return {
    creditLimit,
    arOutstanding,
    unappliedAdvances,
    openOrderValue,
    netExposure,
    availableCredit: creditLimit > 0 ? round(creditLimit - netExposure) : null,
    overLimit: creditLimit > 0 && netExposure > creditLimit,
    currencyCode: row.currency_code ?? null,
  };
}

// ---- F052 advances --------------------------------------------------------------
export async function cancelSalesAdvancePayment(client, c, advanceId, input = {}) {
  need(c, "sales.invoice.request");
  const id = uuid(advanceId, "Advance payment");
  const status = input.refunded ? "refunded" : "cancelled";
  const reason = reasonOf(input.reason);
  const advance = (await client.query(`SELECT * FROM tenant.sales_advance_payments WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!advance) throw new SalesError(404, "Advance payment not found.");
  if (advance.status !== "recorded")
    throw new SalesError(409, `This advance is already ${advance.status}; only an unapplied advance can be ${status}.`, "SALES_ADVANCE_NOT_OPEN");
  await client.query(
    `UPDATE tenant.sales_advance_payments SET status=$3,status_reason=$4,updated_by=$5,updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [c.organizationId, id, status, reason, c.userId],
  );
  await orderEvent(client, c, advance.sales_order_id, `sales_order.advance_${status}`, { advanceId: id, amount: String(advance.amount), reference: advance.payment_reference, reason });
  return { id, status };
}

// Applies recorded advances (oldest first) to a new invoice request, never
// more than it bills, so the deposit is deducted once and only once.
export async function applySalesAdvancesToInvoiceRequest(client, c, orderId, invoiceRequestId, billedValue) {
  let remaining = round(billedValue);
  const advances = (
    await client.query(
      `SELECT id,amount,payment_reference FROM tenant.sales_advance_payments WHERE organization_id=$1 AND sales_order_id=$2 AND status='recorded' ORDER BY received_at,created_at FOR UPDATE`,
      [c.organizationId, orderId],
    )
  ).rows;
  const applied = [];
  for (const advance of advances) {
    if (Number(advance.amount) > remaining + 0.005) continue;
    await client.query(
      `UPDATE tenant.sales_advance_payments SET status='applied',applied_invoice_request_id=$3,applied_at=now(),updated_by=$4,updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [c.organizationId, advance.id, invoiceRequestId, c.userId],
    );
    remaining = round(remaining - Number(advance.amount));
    applied.push({ advanceId: advance.id, amount: String(advance.amount), reference: advance.payment_reference });
  }
  return { applied, amountDue: remaining };
}

// ---- F054 returns -----------------------------------------------------------
export async function decideSalesReturnRequest(client, c, returnId, input = {}) {
  need(c, "sales.order.approve");
  const id = uuid(returnId, "Return request");
  const decision = input.decision === "approved" ? "approved" : input.decision === "rejected" ? "rejected" : null;
  if (!decision) throw new SalesError(400, "Choose approve or reject.");
  const note = decision === "rejected" ? reasonOf(input.note, "reason for rejecting") : text(input.note) || null;
  const request = (await client.query(`SELECT * FROM tenant.sales_return_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!request) throw new SalesError(404, "Return request not found.");
  if (request.status !== "pending") throw new SalesError(409, `This return is already ${request.status}.`);
  if (request.requested_by && request.requested_by === c.userId)
    throw new SalesError(403, "Someone other than the requester must decide this return.", "SALES_RETURN_SELF_DECISION");
  await client.query(
    `UPDATE tenant.sales_return_requests SET status=$3,decided_by=$4,decided_at=now(),decision_note=$5 WHERE organization_id=$1 AND id=$2`,
    [c.organizationId, id, decision, c.userId, note],
  );
  await orderEvent(client, c, request.sales_order_id, `sales_order.return_${decision}`, { returnId: id, requestNumber: request.request_number, reason: note });
  return { id, status: decision };
}

// Receiving the goods back: each line says how much came back and what happens
// to it (restock to a warehouse, or scrap). Sales records the returned
// quantity; the orchestration layer posts the Stock receipt for restocked lines.
export async function completeSalesReturnRequest(client, c, returnId, input = {}) {
  need(c, "sales.fulfillment.request");
  const id = uuid(returnId, "Return request");
  const request = (await client.query(`SELECT * FROM tenant.sales_return_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!request) throw new SalesError(404, "Return request not found.");
  if (request.status === "completed") return { id, status: "completed", restock: [], replayed: true };
  if (request.status !== "approved") throw new SalesError(409, "Only an approved return can be received.", "SALES_RETURN_NOT_APPROVED");
  const requested = new Map((request.lines || []).map((line) => [line.salesOrderLineId, Number(line.quantity)]));
  const lines = Array.isArray(input.lines) && input.lines.length ? input.lines : [...requested].map(([salesOrderLineId, quantity]) => ({ salesOrderLineId, quantity, disposition: "restock" }));
  const restock = [];
  const received = [];
  for (const [index, line] of lines.entries()) {
    const lineId = uuid(line.salesOrderLineId, `Line ${index + 1}`);
    const quantity = Number(line.quantity);
    const disposition = line.disposition === "scrap" ? "scrap" : "restock";
    if (!requested.has(lineId)) throw new SalesError(409, `Line ${index + 1} was not part of this return.`);
    if (!(quantity > 0) || quantity > requested.get(lineId) + 1e-9) throw new SalesError(409, `Line ${index + 1} must be between 0 and the ${requested.get(lineId)} approved.`);
    const progress = (
      await client.query(
        `SELECT line.item_id,line.warehouse_id,line.conversion_factor,line.uom_snapshot,progress.fulfilled_quantity,progress.returned_quantity
           FROM tenant.sales_order_lines line JOIN tenant.sales_order_line_progress progress ON progress.sales_order_line_id=line.id
          WHERE line.organization_id=$1 AND line.id=$2 FOR UPDATE OF progress`,
        [c.organizationId, lineId],
      )
    ).rows[0];
    if (Number(progress.returned_quantity) + quantity > Number(progress.fulfilled_quantity) + 1e-9)
      throw new SalesError(409, `Line ${index + 1} would return more than was delivered.`);
    await client.query(
      `UPDATE tenant.sales_order_line_progress SET returned_quantity=returned_quantity+$3,updated_by=$4,updated_at=now() WHERE organization_id=$1 AND sales_order_line_id=$2`,
      [c.organizationId, lineId, quantity, c.userId],
    );
    received.push({ salesOrderLineId: lineId, quantity: String(quantity), disposition });
    if (disposition === "restock" && progress.warehouse_id)
      restock.push({ salesOrderLineId: lineId, itemId: progress.item_id, warehouseId: progress.warehouse_id, baseQuantity: quantity * (Number(progress.conversion_factor) || 1) });
  }
  await client.query(`UPDATE tenant.sales_return_requests SET status='completed',completed_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, id]);
  await orderEvent(client, c, request.sales_order_id, "sales_order.return_received", { returnId: id, requestNumber: request.request_number, lines: received });
  return { id, status: "completed", restock, requestNumber: request.request_number, salesOrderId: request.sales_order_id };
}

// ---- F055 credit notes and refunds ---------------------------------------------
// What the order has been invoiced for and paid, from Accounting (read only).
export async function salesOrderBillingPosition(client, c, orderId) {
  const { rows } = await client.query(
    `SELECT
       COALESCE((SELECT sum(grand_total) FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND source_sales_order_id=$2 AND invoice_type IS DISTINCT FROM 'credit_note' AND status NOT IN ('draft','cancelled','reversed')),0) AS invoiced,
       COALESCE((SELECT sum(grand_total-outstanding_amount) FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND source_sales_order_id=$2 AND invoice_type IS DISTINCT FROM 'credit_note' AND status NOT IN ('draft','cancelled','reversed')),0) AS paid,
       COALESCE((SELECT sum(amount) FROM tenant.sales_advance_payments WHERE organization_id=$1 AND sales_order_id=$2 AND status IN ('recorded','applied')),0) AS advances,
       COALESCE((SELECT sum(amount) FROM tenant.sales_credit_adjustment_requests WHERE organization_id=$1 AND sales_order_id=$2 AND adjustment_type='credit_note' AND status NOT IN ('rejected','cancelled')),0) AS credited,
       COALESCE((SELECT sum(amount) FROM tenant.sales_credit_adjustment_requests WHERE organization_id=$1 AND sales_order_id=$2 AND adjustment_type='refund' AND status NOT IN ('rejected','cancelled')),0) AS refunded`,
    [c.organizationId, orderId],
  );
  const row = rows[0];
  return { invoiced: round(row.invoiced), paid: round(row.paid), advances: round(row.advances), credited: round(row.credited), refunded: round(row.refunded) };
}

// The cap for a new request: a credit note can't exceed what was invoiced less
// what is already credited; a refund can't exceed what the customer paid
// (invoices paid + advances held) less what is already refunded. A linked
// return must belong to the same order and have been approved.
export async function assertSalesCreditAdjustmentAllowed(client, c, order, { type, amount, returnRequestId }) {
  const position = await salesOrderBillingPosition(client, c, order.id);
  if (type === "credit_note") {
    const room = round(position.invoiced - position.credited);
    if (position.invoiced <= 0) throw new SalesError(409, "Nothing has been invoiced on this order yet, so there is nothing to credit.", "SALES_ADJUSTMENT_NOTHING_INVOICED");
    if (amount > room + 0.005) throw new SalesError(409, `A credit note can be at most ${room} (invoiced ${position.invoiced}, already credited ${position.credited}).`, "SALES_ADJUSTMENT_EXCEEDS_INVOICED");
  } else {
    const room = round(position.paid + position.advances - position.refunded);
    if (amount > room + 0.005) throw new SalesError(409, `A refund can be at most ${room} (paid ${position.paid}, advances ${position.advances}, already refunded ${position.refunded}).`, "SALES_ADJUSTMENT_EXCEEDS_PAID");
  }
  if (returnRequestId) {
    const linked = (await client.query(`SELECT sales_order_id,status FROM tenant.sales_return_requests WHERE organization_id=$1 AND id=$2`, [c.organizationId, returnRequestId])).rows[0];
    if (!linked || linked.sales_order_id !== order.id) throw new SalesError(409, "The linked return does not belong to this order.", "SALES_ADJUSTMENT_RETURN_MISMATCH");
    if (!["approved", "completed"].includes(linked.status)) throw new SalesError(409, "Link an approved or received return.", "SALES_ADJUSTMENT_RETURN_NOT_APPROVED");
  }
  return position;
}

export async function decideSalesCreditAdjustment(client, c, adjustmentId, input = {}) {
  need(c, "sales.credit.override");
  const id = uuid(adjustmentId, "Credit adjustment");
  const decision = input.decision === "approved" ? "approved" : input.decision === "rejected" ? "rejected" : null;
  if (!decision) throw new SalesError(400, "Choose approve or reject.");
  const note = decision === "rejected" ? reasonOf(input.note, "reason for rejecting") : text(input.note) || null;
  const adjustment = (await client.query(`SELECT * FROM tenant.sales_credit_adjustment_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!adjustment) throw new SalesError(404, "Credit adjustment not found.");
  if (adjustment.status !== "pending") throw new SalesError(409, `This request is already ${adjustment.status}.`);
  if (adjustment.created_by === c.userId) throw new SalesError(403, "Someone other than the requester must decide a credit note or refund.", "SALES_ADJUSTMENT_SELF_DECISION");
  await client.query(
    `UPDATE tenant.sales_credit_adjustment_requests SET status=$3,decided_by=$4,decided_at=now(),decision_note=$5,updated_by=$4,updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [c.organizationId, id, decision, c.userId, note],
  );
  await orderEvent(client, c, adjustment.sales_order_id, `sales_order.${adjustment.adjustment_type}_${decision}`, { adjustmentId: id, amount: String(adjustment.amount), reason: note });
  return { id, status: decision };
}

// ---- F056 drop shipping --------------------------------------------------------
const DROP_SHIP_NEXT = { requested: ["ordered", "cancelled"], ordered: ["shipped", "cancelled"], shipped: ["delivered"], acknowledged: ["shipped", "cancelled"] };
export async function updateSalesDropShipStatus(client, c, dropShipId, input = {}) {
  need(c, "sales.fulfillment.request");
  const id = uuid(dropShipId, "Drop-ship request");
  const status = String(input.status || "");
  const request = (await client.query(`SELECT * FROM tenant.sales_drop_ship_requests WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!request) throw new SalesError(404, "Drop-ship request not found.");
  if (!(DROP_SHIP_NEXT[request.status] || []).includes(status))
    throw new SalesError(409, `A ${request.status} drop-ship cannot move to ${status || "that status"}.`, "SALES_DROP_SHIP_TRANSITION_INVALID");
  const updates = { status, status_note: text(input.note, 1000) || null };
  if (status === "ordered") {
    updates.procurement_reference = text(input.procurementReference, 120);
    if (!updates.procurement_reference) throw new SalesError(400, "Enter the supplier purchase order reference.", "SALES_DROP_SHIP_REFERENCE_REQUIRED");
  }
  if (status === "shipped") {
    updates.carrier = text(input.carrier, 120);
    if (!updates.carrier) throw new SalesError(400, "Carrier is required.", "SALES_DROP_SHIP_CARRIER_REQUIRED");
    updates.tracking_number = text(input.trackingNumber, 120) || null;
    updates.shipped_at = new Date();
  }
  if (status === "delivered") updates.delivered_at = new Date();
  if (status === "cancelled") updates.status_note = reasonOf(input.note, "reason for cancelling");
  const columns = Object.keys(updates);
  await client.query(
    `UPDATE tenant.sales_drop_ship_requests SET ${columns.map((column, index) => `${column}=$${index + 3}`).join(",")},updated_by=$${columns.length + 3},updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [c.organizationId, id, ...Object.values(updates), c.userId],
  );
  // Supplier-direct delivery fulfils the Sales line (no stock moves — the
  // goods never pass through our warehouse).
  if (status === "delivered") {
    await client.query(
      `UPDATE tenant.sales_order_line_progress SET fulfilled_quantity=fulfilled_quantity+$3,updated_by=$4,updated_at=now() WHERE organization_id=$1 AND sales_order_line_id=$2`,
      [c.organizationId, request.sales_order_line_id, request.quantity, c.userId],
    );
    await client.query(
      `UPDATE tenant.sales_orders orders SET fulfillment_status=CASE WHEN summary.complete THEN 'fulfilled' ELSE 'partially_fulfilled' END,updated_at=now()
         FROM (SELECT bool_and(progress.fulfilled_quantity>=progress.confirmed_quantity-progress.cancelled_quantity) AS complete
                 FROM tenant.sales_order_lines line JOIN tenant.sales_order_line_progress progress ON progress.sales_order_line_id=line.id
                 JOIN tenant.sales_orders o ON o.current_version_id=line.sales_order_version_id WHERE o.organization_id=$1 AND o.id=$2) summary
        WHERE orders.organization_id=$1 AND orders.id=$2`,
      [c.organizationId, request.sales_order_id],
    );
  }
  await orderEvent(client, c, request.sales_order_id, `sales_order.drop_ship_${status}`, { dropShipId: id, ...updates, shipped_at: undefined, delivered_at: undefined });
  return { id, status };
}

// ---- F057 commissions --------------------------------------------------------------
export async function reverseSalesCommissionsForOrder(client, c, orderId, reason) {
  const result = await client.query(
    `UPDATE tenant.sales_commission_entries SET status='reversed',reversed_at=now(),reversal_reason=$3,updated_by=$4,updated_at=now()
      WHERE organization_id=$1 AND sales_order_id=$2 AND status IN ('accrued','approved') RETURNING id`,
    [c.organizationId, orderId, text(reason, 1000) || "Order cancelled", c.userId || null],
  );
  return result.rows.length;
}

export async function approveSalesCommission(client, c, entryId) {
  need(c, "sales.settings.manage");
  const id = uuid(entryId, "Commission entry");
  const entry = (await client.query(`SELECT * FROM tenant.sales_commission_entries WHERE organization_id=$1 AND id=$2 FOR UPDATE`, [c.organizationId, id])).rows[0];
  if (!entry) throw new SalesError(404, "Commission entry not found.");
  if (entry.status !== "accrued") throw new SalesError(409, `This commission is already ${entry.status}.`);
  if (entry.owner_user_id === c.userId) throw new SalesError(403, "You cannot approve your own commission.", "SALES_COMMISSION_SELF_APPROVAL");
  await client.query(`UPDATE tenant.sales_commission_entries SET status='approved',updated_by=$3,updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, id, c.userId]);
  return { id, status: "approved" };
}
