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

// ---- Credit control (Sales audit M1/B5/B13): one exposure for the customer page and for confirmation ----------------------------------
// What the customer owes on invoices, less unapplied receipts and credit notes, plus the not-yet-invoiced part of confirmed orders — every
// figure in the company's base currency, like the limit (an invoice in USD counts at its own rate). The same figures confirmation checks,
// so the customer page never says "available" while confirming is held. `orderValue` (base currency) is an order about to be confirmed.
export async function getSalesCustomerCreditExposure(client, c, partyId, { orderValue = 0 } = {}) {
  need(c, "sales.view");
  const id = uuid(partyId, "Customer");
  const { rows } = await client.query(
    `SELECT party.credit_limit, organization.base_currency,
        COALESCE((SELECT sum(outstanding_amount*COALESCE(exchange_rate,1)) FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND party_id=$2 AND invoice_type<>'credit_note' AND status NOT IN ('draft','void','paid','cancelled','reversed')),0) AS ar_outstanding,
        COALESCE((SELECT sum(unapplied_amount*COALESCE(exchange_rate,1)) FROM tenant.accounting_customer_receipts WHERE organization_id=$1 AND party_id=$2 AND status IN ('posted','partially_applied')),0)
          + COALESCE((SELECT sum(outstanding_amount*COALESCE(exchange_rate,1)) FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND party_id=$2 AND invoice_type='credit_note' AND status IN ('posted','partially_paid')),0) AS unapplied_receipts,
        (SELECT tenant.company_today() - min(due_date) FROM tenant.accounting_customer_invoices WHERE organization_id=$1 AND party_id=$2 AND invoice_type<>'credit_note'
            AND status NOT IN ('draft','void','paid','cancelled','reversed') AND outstanding_amount > 0 AND due_date < tenant.company_today()) AS overdue_days,
        COALESCE((SELECT sum(line.line_total*version.exchange_rate*greatest(line.quantity-progress.invoiced_quantity-progress.cancelled_quantity,0)/NULLIF(line.quantity,0))
                    FROM tenant.sales_orders orders
                    JOIN tenant.sales_order_versions version ON version.id=orders.current_version_id
                    JOIN tenant.sales_order_lines line ON line.sales_order_version_id=version.id
                    JOIN tenant.sales_order_line_progress progress ON progress.sales_order_line_id=line.id
                   WHERE orders.organization_id=$1 AND orders.party_id=$2 AND orders.lifecycle_status = 'confirmed' AND orders.billing_status<>'fully_invoiced'),0) AS open_orders
       FROM tenant.business_parties party JOIN public.organizations organization ON organization.id=party.organization_id
      WHERE party.organization_id=$1 AND party.id=$2`,
    [c.organizationId, id],
  );
  const row = rows[0];
  if (!row) throw new SalesError(404, "Customer not found.");
  const settings = (await client.query("SELECT credit_control, credit_overdue_days FROM tenant.sales_settings WHERE organization_id=$1", [c.organizationId])).rows[0];
  const creditLimit = Number(row.credit_limit || 0);
  const arOutstanding = round(row.ar_outstanding);
  const unappliedAdvances = round(row.unapplied_receipts);
  const openOrderValue = round(row.open_orders);
  const netExposure = round(Math.max(0, arOutstanding - unappliedAdvances) + openOrderValue);
  const thisOrder = round(orderValue);
  const withOrder = round(netExposure + thisOrder);
  const overdueDays = row.overdue_days == null ? 0 : Number(row.overdue_days);
  const overdueLimit = settings?.credit_overdue_days == null ? null : Number(settings.credit_overdue_days);
  return {
    creditLimit: creditLimit > 0 ? creditLimit : null,
    arOutstanding,
    unappliedAdvances,
    openOrderValue,
    netExposure,
    orderValue: thisOrder,
    exposureWithOrder: withOrder,
    availableCredit: creditLimit > 0 ? round(creditLimit - netExposure) : null,
    overLimit: creditLimit > 0 && withOrder > creditLimit + 0.005,
    overdueDays,
    overdueLimitDays: overdueLimit,
    overdueTooLong: overdueLimit != null && overdueDays > overdueLimit,
    control: settings?.credit_control ?? "block",
    currencyCode: String(row.base_currency ?? "INR").trim(),
  };
}

// Why an order would be held for credit (empty when it is fine), in the words the confirm dialog shows.
export function creditHoldReasons(credit, orderNumber) {
  const reasons = [];
  if (!credit || credit.control === "off") return reasons;
  const amount = (value) => `${credit.currencyCode} ${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (credit.overLimit)
    reasons.push(`${orderNumber} takes the customer to ${amount(credit.exposureWithOrder)} against a credit limit of ${amount(credit.creditLimit)} (owed ${amount(Math.max(0, credit.arOutstanding - credit.unappliedAdvances))}, open orders ${amount(credit.openOrderValue)}, this order ${amount(credit.orderValue)}).`);
  if (credit.overdueTooLong)
    reasons.push(`The customer has an invoice overdue by ${credit.overdueDays} days; Sales settings hold orders past ${credit.overdueLimitDays} days.`);
  return reasons;
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

