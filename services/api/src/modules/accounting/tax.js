import {
  AccountingError,
  asDatabaseDecimal,
  decimal,
} from "./core.js";

const TAX_TYPES = new Set([
  "cgst", "sgst", "igst", "cess", "vat", "sales_tax", "tds", "tcs", "withholding", "other",
]);

function taxComponents(line, direction) {
  const expected = decimal(line.tax_amount || 0);
  if (expected <= 0n) return [];
  const source = Array.isArray(line.tax_details) ? line.tax_details : [];
  const components = source.map((component) => ({
    taxType: TAX_TYPES.has(String(component.taxType || component.tax_type || "").toLowerCase())
      ? String(component.taxType || component.tax_type).toLowerCase()
      : "other",
    taxableAmount: decimal(component.taxableAmount || component.taxable_amount || line.net_amount || 0),
    taxAmount: decimal(component.taxAmount || component.tax_amount || 0),
    recoverableAmount: direction === "input"
      ? decimal(component.recoverableAmount || component.recoverable_amount || component.taxAmount || component.tax_amount || 0)
      : 0n,
  })).filter((component) => component.taxAmount > 0n);
  const componentTotal = components.reduce((total, component) => total + component.taxAmount, 0n);
  if (!components.length || componentTotal !== expected) {
    return [{
      taxType: "other",
      taxableAmount: decimal(line.net_amount || 0),
      taxAmount: expected,
      recoverableAmount: direction === "input" ? expected : 0n,
    }];
  }
  return components;
}

export async function recordDocumentTaxLedger(client, context, document, detailLines, journalEntryId, direction) {
  const isCreditNote = document.invoice_type === "credit_note" || document.bill_type === "credit_note";
  const sign = isCreditNote ? -1n : 1n;
  const sourceType = direction === "output"
    ? isCreditNote ? "customer_credit_note" : "customer_invoice"
    : isCreditNote ? "vendor_credit_note" : "vendor_bill";
  const journalLines = await client.query(
    `SELECT id,tax_base_amount FROM tenant.accounting_journal_lines
      WHERE organization_id=$1 AND journal_entry_id=$2 AND tax_base_amount<>0
      ORDER BY sequence`,
    [context.organizationId, journalEntryId],
  );
  const sourceLines = detailLines.filter((line) => decimal(line.tax_amount || 0) > 0n);
  if (journalLines.rows.length !== sourceLines.length) {
    throw new AccountingError(409, "Tax posting trace could not be reconciled to the source document.");
  }
  for (let index = 0; index < sourceLines.length; index += 1) {
    const source = sourceLines[index];
    const journalLine = journalLines.rows[index];
    for (const component of taxComponents(source, direction)) {
      await client.query(
        `INSERT INTO tenant.accounting_tax_ledger (
          organization_id,company_id,journal_entry_id,journal_line_id,source_type,source_id,party_id,
          tax_registration,tax_type,direction,tax_period,taxable_amount,tax_amount,recoverable_amount,
          reverse_charge,place_of_supply,hsn_sac_code,status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,to_char($11::date,'YYYY-MM'),$12,$13,$14,$15,$16,$17,'open')
        ON CONFLICT (organization_id,journal_line_id,tax_type,direction) DO NOTHING`,
        [context.organizationId, document.company_id, journalEntryId, journalLine.id,
          sourceType, document.id, document.party_id,
          document.customer_snapshot?.gstin || document.supplier_snapshot?.gstin || null,
          component.taxType, direction, document.accounting_date, asDatabaseDecimal(component.taxableAmount * sign),
          asDatabaseDecimal(component.taxAmount * sign), asDatabaseDecimal(component.recoverableAmount * sign),
          Boolean(document.reverse_charge), document.place_of_supply || null, source.hsn_sac_code || null],
      );
    }
  }
}

