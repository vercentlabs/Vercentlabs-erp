// An order's charges on its invoices (Sales audit B1). Freight, packing, installation and other charges are part of what the customer
// owes: the order's first invoice carries every charge not yet billed — as a line of its own, with the GST it was priced with — and a
// later invoice carries any added since. A charge on another invoice that is not cancelled or reversed is billed.
import { asDatabaseDecimal, decimal } from "../../../core/decimal.js";

const LIVE = "invoice.status NOT IN ('cancelled', 'reversed', 'void')";

// The charges of the order version that no other live invoice bills (except `exceptInvoiceId`).
export async function chargesToBill(client, organizationId, orderVersionId, { exceptInvoiceId = null } = {}) {
  return (await client.query(
    `SELECT charge.* FROM tenant.sales_order_charges charge
      WHERE charge.organization_id = $1 AND charge.sales_order_version_id = $2 AND charge.amount > 0
        AND NOT EXISTS (SELECT 1 FROM tenant.sales_invoice_lines billed
              JOIN tenant.accounting_customer_invoices invoice ON invoice.id = billed.customer_invoice_id AND ${LIVE}
             WHERE billed.organization_id = charge.organization_id AND billed.order_charge_id = charge.id AND ($3::uuid IS NULL OR invoice.id <> $3))
      ORDER BY charge.sequence`, [organizationId, orderVersionId, exceptInvoiceId])).rows;
}

// Whether another live invoice already bills this charge (the posting check).
export async function chargeBilledElsewhere(client, organizationId, chargeId, invoiceId) {
  return Boolean((await client.query(
    `SELECT 1 FROM tenant.sales_invoice_lines billed JOIN tenant.accounting_customer_invoices invoice ON invoice.id = billed.customer_invoice_id AND ${LIVE}
      WHERE billed.organization_id = $1 AND billed.order_charge_id = $2 AND invoice.id <> $3 LIMIT 1`, [organizationId, chargeId, invoiceId])).rows[0]);
}

// The invoice line for each charge, in the shape buildInvoiceLines returns ({ finance, sales, taxes, orderChargeId }).
export function chargeInvoiceLines(charges) {
  return charges.map((charge) => {
    const taxes = (Array.isArray(charge.tax_lines) ? charge.tax_lines : []).map((tax, index) => ({
      sequence: index + 1, taxType: tax.taxType, label: tax.label, rate: decimal(tax.rate), taxableAmount: decimal(tax.taxableAmount), taxAmount: decimal(tax.taxAmount),
    }));
    const taxAmount = taxes.reduce((total, tax) => total + tax.taxAmount, decimal(0));
    return {
      orderChargeId: charge.id,
      finance: {
        sourceSalesOrderLineId: null, sourceSalesDeliveryLineId: null, itemId: null, description: charge.label, hsnSacCode: charge.hsn_sac_code ?? null,
        quantity: "1", uomId: null, unitPrice: charge.amount, discountAmount: "0", taxAmount: asDatabaseDecimal(taxAmount),
        taxDetails: taxes.map((tax) => ({ taxType: tax.taxType, label: tax.label, rate: asDatabaseDecimal(tax.rate), taxableAmount: asDatabaseDecimal(tax.taxableAmount),
          taxAmount: asDatabaseDecimal(tax.taxAmount) })),
      },
      sales: {
        item_code_snapshot: null, item_name_snapshot: charge.label, description_snapshot: charge.label, hsn_sac_kind: charge.hsn_sac_code ? "hsn" : null, // it goes with the goods: their HSN, not a service uom_snapshot: null,
        list_unit_price: charge.amount, gross_amount: charge.amount, line_discount_amount: "0", document_discount_amount: "0", tax_category_id: null,
        tax_rate: charge.tax_rate ?? 0, tax_treatment: Number(charge.tax_amount) > 0 ? "taxable" : "non_taxable",
      },
      taxes,
    };
  });
}

// The charges of an order version, as the pricing core reads them back (re-pricing at confirmation).
export async function orderChargesInput(client, organizationId, version) {
  const rows = (await client.query("SELECT * FROM tenant.sales_order_charges WHERE organization_id = $1 AND sales_order_version_id = $2 ORDER BY sequence",
    [organizationId, version.id])).rows;
  if (rows.length) return rows.map((charge) => ({ chargeType: charge.charge_type, label: charge.label, calculationType: charge.calculation_type, value: charge.value, taxable: charge.taxable }));
  // An order made before charges were kept one by one: its total, as one charge.
  return Number(version.charge_total) ? [{ label: "Charges", calculationType: "fixed", value: version.charge_total }] : [];
}
