// What a posted invoice can still be credited for, and the credit note lines for it.
//
// Per invoice line, from posted credit notes only (a draft credits nothing yet):
//   quantity left to credit = invoiced − credited by quantity
//   value left to credit    = the line's taxable value − credited (quantity and amount credits)
// Several drafts may credit the same line for a while (each is warned of the
// others); posting checks again, under the invoice's lock.
//
// Values always come from the invoice line, never from today's price list,
// discounts or tax rates. A quantity credit takes the line's taxable value,
// line and document discounts and each tax component in proportion to the
// quantity, as a difference of running totals over what was credited by
// quantity before, so crediting a line in full gives back exactly what it
// billed. An amount credit is a taxable value taxed at the line's own
// component rates (CGST/SGST, IGST, cess).
import { getCurrencyPrecision } from "../../accounting/core.js";
import { add, asDatabaseDecimal, decimal, div, mul, roundMoney, sub } from "../../../core/decimal.js";
import { computeTax } from "../../../core/tax/index.js";
import { invoiceLines } from "../invoices/records.js";
import { CREDIT_TYPES, CreditNoteError, FINANCE_DRAFT, FINANCE_POSTED } from "./constants.js";

export const EPSILON = 1e-6;
export const round = (value) => Math.round(Number(value) * 1e6) / 1e6;
const money = (value) => Math.round(Number(value) * 100) / 100;

// Each line of the invoice with what is credited and what is left. exceptCreditNoteId: a draft being changed or posted.
export async function creditableLines(client, organizationId, invoiceId, { exceptCreditNoteId = null } = {}) {
  const lines = await invoiceLines(client, organizationId, invoiceId);
  const credits = (await client.query(
    `SELECT note_line.source_invoice_line_id, note_line.credit_type, credit.id AS credit_note_id, credit.invoice_number, credit.status, line.quantity, line.net_amount, line.tax_amount
       FROM tenant.sales_credit_note_lines note_line
       JOIN tenant.accounting_customer_invoice_lines line ON line.id = note_line.customer_invoice_line_id
       JOIN tenant.accounting_customer_invoices credit ON credit.id = note_line.customer_invoice_id
      WHERE note_line.organization_id = $1 AND credit.source_invoice_id = $2 AND ($3::uuid IS NULL OR credit.id <> $3)
        AND credit.status = ANY($4::text[])`, [organizationId, invoiceId, exceptCreditNoteId, [...FINANCE_POSTED, ...FINANCE_DRAFT]])).rows;
  const componentCredits = (await client.query(
    `SELECT note_line.source_invoice_line_id, tax.tax_type, sum(tax.tax_amount) AS tax_amount
       FROM tenant.sales_credit_note_line_taxes tax
       JOIN tenant.sales_credit_note_lines note_line ON note_line.customer_invoice_line_id = tax.customer_invoice_line_id
       JOIN tenant.accounting_customer_invoices credit ON credit.id = tax.customer_invoice_id
      WHERE tax.organization_id = $1 AND credit.source_invoice_id = $2 AND ($3::uuid IS NULL OR credit.id <> $3) AND credit.status = ANY($4::text[])
      GROUP BY note_line.source_invoice_line_id, tax.tax_type`, [organizationId, invoiceId, exceptCreditNoteId, FINANCE_POSTED])).rows;
  return lines.map((line) => {
    const mine = credits.filter((credit) => credit.source_invoice_line_id === line.id);
    const posted = mine.filter((credit) => FINANCE_POSTED.includes(credit.status));
    const drafts = mine.filter((credit) => FINANCE_DRAFT.includes(credit.status));
    const creditedQuantity = round(posted.filter((credit) => credit.credit_type === CREDIT_TYPES.quantity).reduce((total, credit) => total + Number(credit.quantity), 0));
    const creditedValue = money(posted.reduce((total, credit) => total + Number(credit.net_amount), 0));
    const creditedTax = money(posted.reduce((total, credit) => total + Number(credit.tax_amount), 0));
    const draftQuantity = round(drafts.filter((credit) => credit.credit_type === CREDIT_TYPES.quantity).reduce((total, credit) => total + Number(credit.quantity), 0));
    const draftValue = money(drafts.reduce((total, credit) => total + Number(credit.net_amount), 0));
    return {
      ...line,
      invoicedQuantity: Number(line.quantity),
      creditedQuantity,
      creditedValue,
      creditedTax,
      creditedTaxByType: Object.fromEntries(componentCredits.filter((row) => row.source_invoice_line_id === line.id).map((row) => [row.tax_type, Number(row.tax_amount)])),
      quantityLeft: round(Math.max(0, Number(line.quantity) - creditedQuantity)),
      valueLeft: money(Math.max(0, Number(line.net_amount) - creditedValue)),
      taxLeft: money(Math.max(0, Number(line.tax_amount) - creditedTax)),
      draftQuantity,
      draftValue,
      draftCreditNotes: [...new Map(drafts.map((credit) => [credit.credit_note_id, credit.invoice_number])).values()],
    };
  });
}

// Checks the requested lines against what each invoice line has left; returns [{ line, type, quantity?, amount?, salesReturnLineId? }].
// requested: [{ invoiceLineId, creditType, quantity?, amount?, salesReturnLineId? }]
export function settleCreditLines(lines, requested) {
  const byId = new Map(lines.map((line) => [line.id, line]));
  const chosen = [];
  const seen = new Set();
  for (const entry of Array.isArray(requested) ? requested : []) {
    const type = entry.creditType === CREDIT_TYPES.amount ? CREDIT_TYPES.amount : CREDIT_TYPES.quantity;
    const value = Number(type === CREDIT_TYPES.amount ? entry.amount : entry.quantity);
    if (value === 0 || entry.quantity === "" || entry.amount === "") continue;
    const line = byId.get(entry.invoiceLineId);
    if (!line) throw new CreditNoteError(404, "That line is not on the invoice.", "SALES_CREDIT_NOTE_LINE_NOT_FOUND");
    if (seen.has(line.id)) throw new CreditNoteError(400, `${line.item_name_snapshot} is on the credit note twice.`, "SALES_CREDIT_NOTE_VALIDATION");
    seen.add(line.id);
    if (!Number.isFinite(value) || value < 0)
      throw new CreditNoteError(400, `${line.item_name_snapshot}: enter the ${type === CREDIT_TYPES.amount ? "amount" : "quantity"} to credit.`, "SALES_CREDIT_NOTE_VALIDATION");
    if (type === CREDIT_TYPES.quantity) {
      if (value > line.quantityLeft + EPSILON)
        throw new CreditNoteError(409, `${line.item_name_snapshot}: only ${line.quantityLeft} ${line.uom_snapshot ?? ""} is left to credit (invoiced ${line.invoicedQuantity}, credited ${line.creditedQuantity}).`.replace("  ", " "),
          "SALES_CREDIT_NOTE_EXCEEDS_QUANTITY");
      chosen.push({ line, type, quantity: round(value), salesReturnLineId: entry.salesReturnLineId ?? null });
    } else {
      if (value > line.valueLeft + 0.005)
        throw new CreditNoteError(409, `${line.item_name_snapshot}: only ${line.valueLeft.toFixed(2)} of its taxable value is left to credit.`, "SALES_CREDIT_NOTE_EXCEEDS_VALUE");
      chosen.push({ line, type, amount: money(value), salesReturnLineId: null });
    }
  }
  if (!chosen.length) throw new CreditNoteError(400, "Choose what to credit: a quantity or an amount on at least one line.", "SALES_CREDIT_NOTE_EMPTY");
  return chosen;
}

// Drafts crediting the same lines, where together with this one they credit more than is left.
export function draftWarnings(chosen) {
  return chosen.flatMap(({ line, type, quantity, amount }) => {
    if (!line.draftCreditNotes.length) return [];
    const over = type === CREDIT_TYPES.quantity ? quantity + line.draftQuantity > line.quantityLeft + EPSILON : amount + line.draftValue > line.valueLeft + 0.005;
    if (!over) return [];
    return [{ item: line.item_name_snapshot, otherDrafts: line.draftCreditNotes,
      message: `${line.item_name_snapshot}: draft ${line.draftCreditNotes.join(", ")} also credit this line; together they credit more than is left, so only the first posted goes through.` }];
  });
}

// The credit note lines for `chosen` (from settleCreditLines).
// Returns [{ finance (a customer-invoice line), sales (its snapshot), taxes (its components) }].
export async function buildCreditLines(client, context, currencyCode, chosen) {
  const precision = await getCurrencyPrecision(client, context, currencyCode);
  const built = [];
  for (const entry of chosen) {
    const { line } = entry;
    let qty;
    let gross;
    let taxable;
    let lineDiscount = decimal(0);
    let taxes;
    if (entry.type === CREDIT_TYPES.quantity) {
      const invoiced = decimal(line.quantity);
      const before = decimal(line.creditedQuantity);
      qty = decimal(entry.quantity);
      const portion = (value) => {
        const upTo = (credited) => roundMoney(div(mul(decimal(value ?? 0), credited), invoiced), precision);
        return sub(upTo(add(before, qty)), upTo(before));
      };
      gross = roundMoney(mul(qty, decimal(line.unit_price)), precision);
      taxable = portion(line.net_amount);
      lineDiscount = portion(line.line_discount_amount ?? 0);
      taxes = line.taxes.map((tax, index) => ({
        sequence: index + 1, taxType: tax.tax_type, label: tax.label, rate: decimal(tax.rate), taxableAmount: portion(tax.taxable_amount), taxAmount: portion(tax.tax_amount),
      }));
    } else {
      qty = decimal(1);
      taxable = roundMoney(decimal(entry.amount), precision);
      gross = taxable;
      const computed = computeTax({ base: taxable, inclusive: false, components: line.taxes.map((tax) => ({ type: tax.tax_type, label: tax.label, rate: decimal(tax.rate) })), decimalPlaces: precision });
      taxes = computed.components.map((component, index) => ({
        sequence: index + 1, taxType: component.type, label: component.label, rate: component.rate, taxableAmount: component.taxableAmount, taxAmount: component.taxAmount,
      }));
    }
    const documentDiscount = sub(sub(gross, taxable), lineDiscount);
    const taxAmount = taxes.reduce((total, tax) => add(total, tax.taxAmount), decimal(0));
    built.push({
      type: entry.type,
      finance: {
        sourceSalesOrderLineId: line.source_sales_order_line_id, itemId: line.item_id, description: line.description, hsnSacCode: line.hsn_sac_code, quantity: asDatabaseDecimal(qty),
        uomId: entry.type === CREDIT_TYPES.quantity ? line.uom_id : null,
        unitPrice: entry.type === CREDIT_TYPES.quantity ? line.unit_price : asDatabaseDecimal(taxable),
        discountAmount: asDatabaseDecimal(gross > taxable ? sub(gross, taxable) : decimal(0)), taxAmount: asDatabaseDecimal(taxAmount),
        taxDetails: taxes.map((tax) => ({ taxType: tax.taxType, label: tax.label, rate: asDatabaseDecimal(tax.rate), taxableAmount: asDatabaseDecimal(tax.taxableAmount), taxAmount: asDatabaseDecimal(tax.taxAmount) })),
      },
      sales: {
        source_invoice_line_id: line.id, sales_return_line_id: entry.salesReturnLineId ?? null, credit_type: entry.type, item_code_snapshot: line.item_code_snapshot,
        item_name_snapshot: line.item_name_snapshot, description_snapshot: line.description_snapshot, hsn_sac_kind: line.hsn_sac_kind, uom_snapshot: line.uom_snapshot,
        gross_amount: asDatabaseDecimal(gross), line_discount_amount: asDatabaseDecimal(lineDiscount),
        document_discount_amount: asDatabaseDecimal(documentDiscount < 0n ? decimal(0) : documentDiscount),
      },
      taxes,
    });
  }
  return built;
}

// Writes the Sales side of the lines Finance created (ids in order).
export async function writeCreditLines(client, context, creditNoteId, lineIds, built) {
  for (let index = 0; index < built.length; index += 1) {
    const { sales, taxes } = built[index];
    const lineId = lineIds[index];
    await client.query(
      `INSERT INTO tenant.sales_credit_note_lines (customer_invoice_line_id, organization_id, customer_invoice_id, source_invoice_line_id, sales_return_line_id, credit_type,
          item_code_snapshot, item_name_snapshot, description_snapshot, hsn_sac_kind, uom_snapshot, gross_amount, line_discount_amount, document_discount_amount)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [lineId, context.organizationId, creditNoteId, sales.source_invoice_line_id, sales.sales_return_line_id, sales.credit_type, sales.item_code_snapshot, sales.item_name_snapshot,
        sales.description_snapshot, sales.hsn_sac_kind, sales.uom_snapshot, sales.gross_amount, sales.line_discount_amount, sales.document_discount_amount]);
    for (const tax of taxes)
      await client.query(
        `INSERT INTO tenant.sales_credit_note_line_taxes (organization_id, customer_invoice_id, customer_invoice_line_id, sequence, tax_type, label, rate, taxable_amount, tax_amount)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [context.organizationId, creditNoteId, lineId, tax.sequence, tax.taxType, tax.label, asDatabaseDecimal(tax.rate), asDatabaseDecimal(tax.taxableAmount), asDatabaseDecimal(tax.taxAmount)]);
  }
}

// The credit note's lines as Sales shows them: Finance's values, the product snapshot, the source invoice line and the tax components.
export async function creditNoteLines(client, organizationId, creditNoteId) {
  const lines = (await client.query(
    `SELECT line.id, line.sequence, line.source_sales_order_line_id, line.item_id, line.description, line.hsn_sac_code, line.quantity, line.uom_id, line.unit_price, line.discount_amount,
            line.net_amount, line.tax_amount, line.line_total, note_line.source_invoice_line_id, note_line.sales_return_line_id, note_line.credit_type, note_line.item_code_snapshot,
            COALESCE(note_line.item_name_snapshot, line.description) AS item_name_snapshot, note_line.description_snapshot, note_line.hsn_sac_kind, note_line.uom_snapshot,
            note_line.gross_amount, note_line.line_discount_amount, note_line.document_discount_amount, source_line.quantity AS invoiced_quantity, source_line.unit_price AS invoiced_unit_price,
            source_line.net_amount AS invoiced_net_amount, return_line.sales_return_id, sales_return.return_number
       FROM tenant.accounting_customer_invoice_lines line
       JOIN tenant.sales_credit_note_lines note_line ON note_line.customer_invoice_line_id = line.id
       JOIN tenant.accounting_customer_invoice_lines source_line ON source_line.id = note_line.source_invoice_line_id
       LEFT JOIN tenant.sales_return_lines return_line ON return_line.id = note_line.sales_return_line_id
       LEFT JOIN tenant.sales_returns sales_return ON sales_return.id = return_line.sales_return_id
      WHERE line.organization_id = $1 AND line.customer_invoice_id = $2 ORDER BY line.sequence`, [organizationId, creditNoteId])).rows;
  const taxes = (await client.query(
    `SELECT customer_invoice_line_id, sequence, tax_type, label, rate, taxable_amount, tax_amount FROM tenant.sales_credit_note_line_taxes
      WHERE organization_id = $1 AND customer_invoice_id = $2 ORDER BY customer_invoice_line_id, sequence`, [organizationId, creditNoteId])).rows;
  return lines.map((line) => ({ ...line, taxes: taxes.filter((tax) => tax.customer_invoice_line_id === line.id) }));
}

// The tax of the lines by component and rate.
export function taxSummaryOf(lines) {
  const summary = new Map();
  for (const line of lines)
    for (const tax of line.taxes) {
      const key = `${tax.tax_type}:${Number(tax.rate)}`;
      const group = summary.get(key) ?? { taxType: tax.tax_type, label: tax.label, rate: Number(tax.rate), taxableAmount: 0, taxAmount: 0 };
      group.taxableAmount = money(group.taxableAmount + Number(tax.taxable_amount));
      group.taxAmount = money(group.taxAmount + Number(tax.tax_amount));
      summary.set(key, group);
    }
  return [...summary.values()];
}
