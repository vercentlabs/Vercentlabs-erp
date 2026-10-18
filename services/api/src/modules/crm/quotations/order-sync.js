// A deal follows its confirmed sales order (CRM plan 2.4): when an order raised from the deal's quotation is confirmed, the deal's
// value becomes what was actually ordered — the order's value before tax, in the order's currency — so the pipeline and the win/loss
// figures report what the customer committed to, not the first estimate. An open deal's estimated value changes; a won deal's final
// value does. A lost, abandoned or archived deal is left alone. Each change is recorded on the deal's history.
//
// Called by Sales' confirmSalesOrder; it never stops a confirmation (the caller isolates it).
import { recordOpportunityHistory } from "../opportunities/history.js";

const money = (value) => Math.round(Number(value ?? 0) * 100) / 100;

export async function updateDealFromConfirmedOrder(client, context, orderId) {
  const { rows } = await client.query(
    `SELECT sales_order.id, sales_order.sales_order_number, sales_order.source_opportunity_id, version.grand_total, version.tax_total, version.currency_code,
            version.customer_po_number, opportunity.id AS deal_id, opportunity.status, opportunity.amount, opportunity.won_amount, opportunity.currency_code AS deal_currency,
            opportunity.archived_at
       FROM tenant.sales_orders sales_order
       JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
       JOIN tenant.crm_opportunities opportunity ON opportunity.organization_id = sales_order.organization_id AND opportunity.id = sales_order.source_opportunity_id
      WHERE sales_order.organization_id = $1 AND sales_order.id = $2
      FOR UPDATE OF opportunity`,
    [context.organizationId, orderId],
  );
  const row = rows[0];
  if (!row || row.archived_at || !["open", "won"].includes(row.status)) return null;
  const value = money(Number(row.grand_total) - Number(row.tax_total));
  const currency = String(row.currency_code).trim();
  const column = row.status === "won" ? "won_amount" : "amount";
  const before = money(row.status === "won" ? (row.won_amount ?? row.amount) : row.amount);
  const beforeCurrency = String(row.deal_currency ?? currency).trim();
  if (before === value && beforeCurrency === currency) return { dealId: row.deal_id, changed: false };
  await client.query(
    `UPDATE tenant.crm_opportunities SET ${column} = $3, currency_code = $4, updated_by = $5, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.deal_id, value, currency, context.userId ?? null],
  );
  const label = row.status === "won" ? "Final value" : "Estimated value";
  await recordOpportunityHistory(client, context, row.deal_id, "value_changed",
    `${label} updated from sales order ${row.sales_order_number}: ${beforeCurrency} ${before.toLocaleString("en-IN")} → ${currency} ${value.toLocaleString("en-IN")}`,
    { field: column, from: before, to: value, fromCurrency: beforeCurrency, toCurrency: currency, salesOrderId: row.id, salesOrderNumber: row.sales_order_number,
      customerPoNumber: row.customer_po_number ?? null });
  return { dealId: row.deal_id, changed: true, value, currency };
}
