// How much of a sales order can be invoiced, and the invoice lines for it.
//
// Quantities are worked out from posted invoices, never typed:
//   ordered-based   invoiceable now = ordered − cancelled − posted invoiced
//   delivery-based  invoiceable now = delivered − posted invoiced (goods;
//                   services are always invoiced as ordered)
//   remaining to invoice = ordered − cancelled − posted invoiced, whatever the basis
// A draft is not invoiced: several drafts may bill the same quantity for a
// while (each is warned of the others), and posting checks again, under the
// order's lock, so only what is really left can be posted.
//
// Values come from the order as agreed, never from today's price list or
// discount settings: the unit price, and the line's taxable value and its
// line and document discounts in proportion to the quantity. Each share is a
// difference of running totals over what was posted before, and is worked
// out again when the invoice is posted, so the posted invoices of a line add
// up to the line exactly: the last one takes the rounding residue. Tax is the
// central engine's, on each invoice's own taxable value.
import { getCurrencyPrecision } from "../../accounting/core.js";
import { add, asDatabaseDecimal, decimal, div, mul, roundMoney, sub } from "../../../core/decimal.js";
import { computeTax, loadTaxContext, resolveLineTax } from "../../../core/tax/index.js";
import { loadOrderLineProgress } from "../orders/progress.js";
import { FINANCE_DRAFT, InvoiceError, QUANTITY_BASIS } from "./constants.js";

const EPSILON = 1e-6;
// A rate or amount as stored (a numeric string) or as calculated (fixed-point), as a number for comparison.
const asNumber = (value) => (typeof value === "bigint" ? Number(asDatabaseDecimal(value)) : Number(value ?? 0));
const round = (value) => Math.round(Number(value) * 1e6) / 1e6;

// What draft invoices of the order (other than `exceptInvoiceId`) bill, per order line, with their numbers.
export async function draftQuantities(client, organizationId, orderId, exceptInvoiceId = null) {
  const { rows } = await client.query(
    `SELECT line.source_sales_order_line_id AS line_id, invoice.invoice_number, sum(line.quantity) AS quantity
       FROM tenant.accounting_customer_invoice_lines line
       JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = line.organization_id AND invoice.id = line.customer_invoice_id
      WHERE line.organization_id = $1 AND invoice.source_sales_order_id = $2 AND invoice.invoice_type = 'invoice' AND invoice.status = ANY($3::text[])
        AND ($4::uuid IS NULL OR invoice.id <> $4)
      GROUP BY line.source_sales_order_line_id, invoice.invoice_number`, [organizationId, orderId, FINANCE_DRAFT, exceptInvoiceId]);
  const map = new Map();
  for (const row of rows) {
    const entry = map.get(row.line_id) ?? { quantity: 0, invoices: [] };
    entry.quantity = round(entry.quantity + Number(row.quantity));
    entry.invoices.push({ invoiceNumber: row.invoice_number, quantity: Number(row.quantity) });
    map.set(row.line_id, entry);
  }
  return map;
}

// The invoicing position of one order line on a basis.
export function invoicingOfLine(line, basis) {
  const open = Math.max(0, line.ordered - line.cancelled);
  // Delivery-based: what the customer kept (delivered less returned) is what can be billed.
  const kept = Math.max(0, line.delivered - (line.returned ?? 0));
  const cap = basis === QUANTITY_BASIS.delivered && line.deliverable ? Math.min(kept, open) : open;
  return {
    remainingToInvoice: round(Math.max(0, open - line.invoiced)),
    invoiceableNow: round(Math.max(0, cap - line.invoiced)),
    // Delivery-based: what cannot be invoiced until it is delivered.
    pendingDelivery: basis === QUANTITY_BASIS.delivered && line.deliverable ? round(Math.max(0, open - Math.max(line.delivered, line.invoiced))) : 0,
    returned: line.returned ?? 0,
  };
}

// Each order line with what an invoice can bill now on the given basis, and what other drafts bill.
export async function invoiceableLines(client, organizationId, order, basis, { exceptInvoiceId = null } = {}) {
  const progress = await loadOrderLineProgress(client, organizationId, order.current_version_id);
  const drafts = await draftQuantities(client, organizationId, order.id, exceptInvoiceId);
  return progress.map((line) => {
    const position = invoicingOfLine(line, basis);
    const onDrafts = drafts.get(line.lineId) ?? { quantity: 0, invoices: [] };
    return { ...line, ...position, eligible: position.invoiceableNow, onDrafts: onDrafts.quantity, draftInvoices: onDrafts.invoices };
  });
}

// The order's lines and the version it was priced with.
export async function orderSource(client, organizationId, versionId) {
  const [lines, version] = [
    await client.query(`SELECT * FROM tenant.sales_order_lines WHERE organization_id = $1 AND sales_order_version_id = $2`, [organizationId, versionId]),
    await client.query(`SELECT * FROM tenant.sales_order_versions WHERE organization_id = $1 AND id = $2`, [organizationId, versionId]),
  ];
  return { lines: new Map(lines.rows.map((row) => [row.id, row])), version: version.rows[0] };
}

// The central tax engine for one invoice: the seller's registration, the place of supply, the
// supply type and the invoice date. Returns (orderLine) → the components that apply to it.
// invoice: { seller_registration_id, seller_snapshot, place_of_supply, supply_type, invoice_date }
export async function taxEngineFor(client, context, invoice) {
  const tax = await loadTaxContext(client, { organizationId: context.organizationId, sellerRegistrationId: invoice.seller_registration_id ?? null });
  const sellerStateCode = invoice.seller_snapshot?.stateCode ?? tax.registration?.stateCode ?? null;
  return async (row) => {
    // A line the order carries without tax (exempt, zero-rated, overridden) stays so.
    if (row.tax_treatment && row.tax_treatment !== "taxable") return [];
    const resolved = await resolveLineTax(client, tax, {
      taxCategoryId: row.tax_category_id, date: invoice.invoice_date, sellerStateCode, placeOfSupply: invoice.place_of_supply, supplyType: invoice.supply_type, allowInactive: true,
    });
    return resolved.components;
  };
}

// The invoice lines for `chosen` ([{ line (from invoiceableLines), quantity, deliveryLineId? }]).
// taxOf(orderLine) → the tax components ([{ type, label, rate }]) the line is taxed with.
// Returns [{ finance (a customer-invoice line), sales (its snapshot), taxes (its components) }].
export async function buildInvoiceLines(client, context, source, chosen, taxOf) {
  const precision = await getCurrencyPrecision(client, context, String(source.version.currency_code).trim());
  const built = [];
  for (const { line, quantity, deliveryLineId } of chosen) {
    const row = source.lines.get(line.lineId);
    if (!row) throw new InvoiceError(409, `${line.itemName} is no longer on the order.`, "SALES_INVOICE_ORDER_CHANGED");
    const ordered = decimal(row.quantity);
    const qty = decimal(quantity);
    // Billed before this invoice: posted invoices only.
    const before = decimal(round(line.invoiced));
    const portion = (amount) => {
      const upTo = (billed) => roundMoney(div(mul(decimal(amount ?? 0), billed), ordered), precision);
      return sub(upTo(add(before, qty)), upTo(before));
    };
    const gross = roundMoney(mul(qty, decimal(row.unit_price)), precision);
    const taxable = portion(row.taxable_amount);
    const lineDiscount = portion(row.discount_amount);
    const documentDiscount = sub(sub(gross, taxable), lineDiscount);
    const computed = computeTax({ base: taxable, inclusive: false, components: await taxOf(row), decimalPlaces: precision });
    const taxes = computed.components.map((component, index) => ({
      sequence: index + 1, taxType: component.type, label: component.label, rate: component.rate, taxableAmount: component.taxableAmount, taxAmount: component.taxAmount,
    }));
    built.push({
      finance: {
        sourceSalesOrderLineId: row.id, sourceSalesDeliveryLineId: deliveryLineId ?? null, itemId: row.item_id,
        description: row.description_snapshot || row.item_name_snapshot, hsnSacCode: row.hsn_sac_snapshot, quantity: asDatabaseDecimal(qty), uomId: row.uom_id,
        unitPrice: row.unit_price, discountAmount: asDatabaseDecimal(gross > taxable ? sub(gross, taxable) : decimal(0)), taxAmount: asDatabaseDecimal(computed.taxAmount),
        taxDetails: taxes.map((component) => ({
          taxType: component.taxType, label: component.label, rate: asDatabaseDecimal(component.rate),
          taxableAmount: asDatabaseDecimal(component.taxableAmount), taxAmount: asDatabaseDecimal(component.taxAmount),
        })),
      },
      sales: {
        item_code_snapshot: row.item_code_snapshot, item_name_snapshot: row.item_name_snapshot, description_snapshot: row.description_snapshot, hsn_sac_kind: row.hsn_sac_kind,
        uom_snapshot: row.uom_snapshot, list_unit_price: row.list_unit_price, gross_amount: asDatabaseDecimal(gross), line_discount_amount: asDatabaseDecimal(lineDiscount),
        document_discount_amount: asDatabaseDecimal(documentDiscount < 0n ? decimal(0) : documentDiscount), tax_category_id: row.tax_category_id, tax_rate: row.tax_rate,
        tax_treatment: row.tax_treatment,
      },
      taxes,
    });
  }
  return built;
}

// The tax each line should carry on the invoice date, from the central tax engine. Returns
// the differences from what the lines carry ([] when they agree).
// lines: [{ source_sales_order_line_id | orderLine, item_name_snapshot, taxes }]; orderLines: Map(id → order line)
export async function taxDifferences(client, context, invoice, lines, orderLines) {
  const taxOf = await taxEngineFor(client, context, invoice);
  const differences = [];
  for (const line of lines) {
    const row = orderLines.get(line.source_sales_order_line_id);
    if (!row) continue;
    const expected = await taxOf(row);
    const want = expected.filter((component) => asNumber(component.rate) !== 0).map((component) => `${component.type}:${asNumber(component.rate)}`).sort().join(",");
    const have = line.taxes.filter((component) => asNumber(component.rate) !== 0)
      .map((component) => `${component.tax_type ?? component.taxType}:${asNumber(component.rate)}`).sort().join(",");
    if (want !== have) differences.push({ item: line.item_name_snapshot, invoiced: have || "no tax", expected: want || "no tax" });
  }
  return differences;
}

export { EPSILON };
