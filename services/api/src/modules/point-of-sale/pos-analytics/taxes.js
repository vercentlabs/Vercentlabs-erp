// POS tax figures, always from finished sales and completed returns (never from bills in progress), as they were recorded at the time:
// a sale's own tax snapshot — the seller registration, place of supply, document, and per line the HSN/SAC, classification, rate, taxable
// value and components — and the return lines' reversed share of it. Filing GST returns belongs to Finance; these are the POS figures it
// reconciles against.
import { requirePermission, accessiblePosStoreIds, assertPosStoreAccess } from "../shared/access-control.js";
import { posError } from "../shared/errors.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const parse = (value) => (Array.isArray(value) ? value : typeof value === "string" ? JSON.parse(value || "[]") : value ?? []);

// A finished sale's tax exactly as it was charged (for the receipt, a reprint and lookups), with what returns have reversed since.
export async function getPosSaleTaxes(client, context, saleId) {
  requirePermission(context, "pos.view");
  if (!UUID.test(String(saleId ?? ""))) throw posError(404, "Sale not found.", "POS_SALE_NOT_FOUND");
  const sale = (await client.query(
    `SELECT id, store_id, receipt_number, currency_code, completed_at, tax_date, seller_tax_snapshot, place_of_supply_snapshot, supply_mode_snapshot, tax_document_type,
            taxable_total::text, tax_total::text, grand_total::text, rounding_adjustment::text, tax_breakdown, tax_treatment_snapshot, buyer_tax_details, customer_mode
       FROM tenant.pos_sales WHERE organization_id = $1 AND id = $2`, [context.organizationId, saleId])).rows[0];
  if (!sale) throw posError(404, "Sale not found.", "POS_SALE_NOT_FOUND");
  await assertPosStoreAccess(client, context, sale.store_id);
  const lines = (await client.query(
    `SELECT id, line_number, description, quantity::text, hsn_sac_snapshot, tax_classification, tax_rate::text, price_includes_tax, taxable_amount::text, tax_amount::text,
            line_total::text, tax_components, place_of_supply
       FROM tenant.pos_sale_lines WHERE organization_id = $1 AND sale_id = $2 ORDER BY line_number`, [context.organizationId, saleId])).rows;
  const reversed = (await client.query(
    `SELECT COALESCE(sum(line.taxable_amount), 0)::text AS taxable, COALESCE(sum(line.tax_amount), 0)::text AS tax
       FROM tenant.pos_return_lines line JOIN tenant.pos_returns ret ON ret.organization_id = line.organization_id AND ret.id = line.return_id
      WHERE line.organization_id = $1 AND ret.sale_id = $2 AND ret.status = 'completed'`, [context.organizationId, saleId])).rows[0];
  return {
    saleId: sale.id, receiptNumber: sale.receipt_number, currency: String(sale.currency_code ?? "").trim(), taxDate: sale.tax_date, documentType: sale.tax_document_type ?? null,
    seller: sale.seller_tax_snapshot ?? null, placeOfSupply: sale.place_of_supply_snapshot ?? null, supplyMode: sale.supply_mode_snapshot ?? null,
    buyer: { mode: sale.customer_mode, treatment: sale.tax_treatment_snapshot ?? null, gstin: sale.buyer_tax_details?.gstin ?? null },
    taxableTotal: sale.taxable_total, taxTotal: sale.tax_total, roundingAdjustment: sale.rounding_adjustment, grandTotal: sale.grand_total, breakdown: parse(sale.tax_breakdown),
    lines: lines.map((line) => ({
      id: line.id, lineNumber: line.line_number, description: line.description, quantity: line.quantity, hsnSac: line.hsn_sac_snapshot, classification: line.tax_classification,
      rate: line.tax_rate, priceIncludesTax: line.price_includes_tax, taxableAmount: line.taxable_amount, taxAmount: line.tax_amount, lineTotal: line.line_total,
      components: parse(line.tax_components), placeOfSupply: line.place_of_supply,
    })),
    reversedByReturns: { taxableAmount: reversed.taxable, taxAmount: reversed.tax },
  };
}

// The POS tax summary for a period (default: this month to today): totals; tax by component and rate; sales by classification and rate;
// by HSN/SAC; by outlet and seller registration; B2B against B2C; what returns reversed; and a reconciliation check (a sale whose tax does
// not equal its lines', or a line whose components do not add up to its tax). input: from, to, storeId.
export async function getPosTaxSummary(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const now = new Date();
  const from = DATE.test(String(input.from ?? "")) ? input.from : `${now.toISOString().slice(0, 8)}01`;
  const to = DATE.test(String(input.to ?? "")) ? input.to : now.toISOString().slice(0, 10);
  const values = [context.organizationId, from, to];
  const filters = [];
  const stores = await accessiblePosStoreIds(client, context);
  if (stores) { values.push(stores); filters.push(`sale.store_id = ANY($${values.length}::uuid[])`); }
  if (UUID.test(String(input.storeId ?? ""))) { values.push(input.storeId); filters.push(`sale.store_id = $${values.length}::uuid`); }
  const sales = `sale.organization_id = $1 AND sale.status IN ('completed', 'partially_returned', 'returned') AND sale.sale_date >= $2::date AND sale.sale_date < $3::date + 1${filters.length ? ` AND ${filters.join(" AND ")}` : ""}`;
  const query = async (sql) => (await client.query(sql, values)).rows;
  const lineTaxable = "COALESCE(line.taxable_amount, line.line_total - line.tax_amount)";

  const [totals] = await query(
    `SELECT count(DISTINCT sale.id)::int AS sales, COALESCE(sum(${lineTaxable}), 0)::text AS taxable, COALESCE(sum(line.tax_amount), 0)::text AS tax,
            COALESCE(sum(line.line_total), 0)::text AS gross
       FROM tenant.pos_sales sale JOIN tenant.pos_sale_lines line ON line.organization_id = sale.organization_id AND line.sale_id = sale.id WHERE ${sales}`);
  const byComponent = await query(
    `SELECT upper(component->>'type') AS type, (component->>'rate')::numeric::text AS rate, COALESCE(sum((component->>'taxableAmount')::numeric), 0)::text AS taxable,
            COALESCE(sum((component->>'taxAmount')::numeric), 0)::text AS tax
       FROM tenant.pos_sales sale JOIN tenant.pos_sale_lines line ON line.organization_id = sale.organization_id AND line.sale_id = sale.id
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(line.tax_components, '[]'::jsonb)) component
      WHERE ${sales} GROUP BY 1, 2 ORDER BY 1, min((component->>'rate')::numeric)`);
  const byClassification = await query(
    `SELECT COALESCE(line.tax_classification, 'not_recorded') AS classification, COALESCE(line.tax_rate::text, '') AS rate, count(*)::int AS lines,
            COALESCE(sum(${lineTaxable}), 0)::text AS taxable, COALESCE(sum(line.tax_amount), 0)::text AS tax
       FROM tenant.pos_sales sale JOIN tenant.pos_sale_lines line ON line.organization_id = sale.organization_id AND line.sale_id = sale.id
      WHERE ${sales} GROUP BY 1, 2 ORDER BY 1, 2`);
  const byHsn = await query(
    `SELECT COALESCE(line.hsn_sac_snapshot, 'not recorded') AS hsn, COALESCE(sum(line.quantity), 0)::text AS quantity, COALESCE(sum(${lineTaxable}), 0)::text AS taxable,
            COALESCE(sum(line.tax_amount), 0)::text AS tax
       FROM tenant.pos_sales sale JOIN tenant.pos_sale_lines line ON line.organization_id = sale.organization_id AND line.sale_id = sale.id
      WHERE ${sales} GROUP BY 1 ORDER BY sum(${lineTaxable}) DESC LIMIT 50`);
  const byOutlet = await query(
    `SELECT store.code, store.name, COALESCE(sale.seller_tax_snapshot->>'gstin', '') AS gstin, count(DISTINCT sale.id)::int AS sales,
            COALESCE(sum(${lineTaxable}), 0)::text AS taxable, COALESCE(sum(line.tax_amount), 0)::text AS tax
       FROM tenant.pos_sales sale JOIN tenant.pos_stores store ON store.organization_id = sale.organization_id AND store.id = sale.store_id
       JOIN tenant.pos_sale_lines line ON line.organization_id = sale.organization_id AND line.sale_id = sale.id
      WHERE ${sales} GROUP BY 1, 2, 3 ORDER BY 1`);
  const byBuyer = await query(
    `SELECT COALESCE(sale.tax_treatment_snapshot, 'b2c') AS treatment, sale.customer_mode AS mode, count(DISTINCT sale.id)::int AS sales,
            COALESCE(sum(${lineTaxable}), 0)::text AS taxable, COALESCE(sum(line.tax_amount), 0)::text AS tax
       FROM tenant.pos_sales sale JOIN tenant.pos_sale_lines line ON line.organization_id = sale.organization_id AND line.sale_id = sale.id
      WHERE ${sales} GROUP BY 1, 2 ORDER BY 1, 2`);
  const returns = await query(
    `SELECT count(DISTINCT ret.id)::int AS returns, COALESCE(sum(line.taxable_amount), 0)::text AS taxable, COALESCE(sum(line.tax_amount), 0)::text AS tax,
            COALESCE(sum(line.refund_amount), 0)::text AS refunded
       FROM tenant.pos_returns ret JOIN tenant.pos_sales sale ON sale.organization_id = ret.organization_id AND sale.id = ret.sale_id
       JOIN tenant.pos_return_lines line ON line.organization_id = ret.organization_id AND line.return_id = ret.id
      WHERE ret.status = 'completed' AND ${sales.replace("sale.status IN ('completed', 'partially_returned', 'returned') AND ", "")}`);
  const returnComponents = await query(
    `SELECT upper(component->>'type') AS type, (component->>'rate')::numeric::text AS rate, COALESCE(sum((component->>'taxAmount')::numeric), 0)::text AS tax
       FROM tenant.pos_returns ret JOIN tenant.pos_sales sale ON sale.organization_id = ret.organization_id AND sale.id = ret.sale_id
       JOIN tenant.pos_return_lines line ON line.organization_id = ret.organization_id AND line.return_id = ret.id
       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(line.tax_components, '[]'::jsonb)) component
      WHERE ret.status = 'completed' AND ${sales.replace("sale.status IN ('completed', 'partially_returned', 'returned') AND ", "")} GROUP BY 1, 2 ORDER BY 1, 2`);
  const [reconciliation] = await query(
    `SELECT count(*) FILTER (WHERE sale_mismatch)::int AS sales_not_matching_lines, COALESCE(sum(component_mismatches), 0)::int AS lines_not_matching_components FROM (
       SELECT abs(sale.tax_total - COALESCE((SELECT sum(line.tax_amount) FROM tenant.pos_sale_lines line WHERE line.organization_id = sale.organization_id AND line.sale_id = sale.id), 0)) > 0.005 AS sale_mismatch,
              (SELECT count(*) FROM tenant.pos_sale_lines line WHERE line.organization_id = sale.organization_id AND line.sale_id = sale.id
                  AND abs(line.tax_amount - COALESCE((SELECT sum((component->>'taxAmount')::numeric) FROM jsonb_array_elements(COALESCE(line.tax_components, '[]'::jsonb)) component), 0)) > 0.005) AS component_mismatches
         FROM tenant.pos_sales sale WHERE ${sales}) checked`);
  const currency = (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0]?.base_currency?.trim() ?? "INR";
  return {
    from, to, currency, totals, byComponent, byClassification, byHsn, byOutlet, byBuyer,
    returns: { ...(returns[0] ?? { returns: 0, taxable: "0", tax: "0", refunded: "0" }), byComponent: returnComponents },
    reconciliation: { ...reconciliation, ok: !reconciliation.sales_not_matching_lines && !reconciliation.lines_not_matching_components },
  };
}
