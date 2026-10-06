import { SalesError } from "./index.js";

// After-sales helpers: the customer's credit exposure and reversing an order's
// commissions. Credit notes are their own documents (credit-notes/).

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
                   WHERE orders.organization_id=$1 AND orders.party_id=$2 AND orders.lifecycle_status = 'confirmed' AND orders.billing_status<>'fully_invoiced'),0) AS open_orders
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

// ---- F057 commissions --------------------------------------------------------------
export async function reverseSalesCommissionsForOrder(client, c, orderId, reason) {
  const result = await client.query(
    `UPDATE tenant.sales_commission_entries SET status='reversed',reversed_at=now(),reversal_reason=$3,updated_by=$4,updated_at=now()
      WHERE organization_id=$1 AND sales_order_id=$2 AND status IN ('accrued','approved') RETURNING id`,
    [c.organizationId, orderId, text(reason, 1000) || "Order cancelled", c.userId || null],
  );
  return result.rows.length;
}

