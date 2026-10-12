import {
  AccountingError,
  asDatabaseDecimal,
  decimal,
  getAccountMapping,
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

const GST_COMPONENTS = new Set(["cgst", "sgst", "igst", "cess"]);

// A posting account that is used only once configured (null when it is not).
export async function optionalMapping(client, context, ledgerId, mappingKey, selectors = {}) {
  try {
    return await getAccountMapping(client, context, ledgerId, mappingKey, selectors);
  } catch (error) {
    if (error?.code === "ACCOUNTING_MAPPING_MISSING") return null;
    throw error;
  }
}

// The tax journal lines of one document line, one per tax component, each to its own account: output CGST / SGST / IGST / cess on sales;
// on purchases the matching input account — or, while the credit still has to be confirmed (GSTR-2B and the statutory conditions), the
// input-GST-awaiting-confirmation account. Any other tax goes to the line's own tax account. Each line carries what the tax ledger records.
// options: { direction: "output" | "input", date, partyId, itcPending, referenceType, referenceId }
export async function taxPostingLines(client, context, ledgerId, line, options) {
  const components = taxComponents(line, options.direction);
  const result = [];
  const fallback = async () => line.tax_account_id
    ? { account_id: line.tax_account_id }
    : getAccountMapping(client, context, ledgerId, options.direction === "output" ? "output_tax" : "input_tax", { date: options.date });
  for (const component of components) {
    let account = null;
    // A blocked credit is part of the line's cost: the bill already points its tax at the cost account.
    const blocked = options.direction === "input" && line.input_tax_eligibility === "blocked";
    if (blocked) account = line.tax_account_id ? { account_id: line.tax_account_id } : null;
    else if (GST_COMPONENTS.has(component.taxType)) {
      if (options.direction === "input" && options.itcPending) account = await getAccountMapping(client, context, ledgerId, "input_tax_pending", { date: options.date });
      else account = await optionalMapping(client, context, ledgerId, `${options.direction}_${component.taxType}`, { date: options.date });
    }
    account ??= await fallback();
    const amount = asDatabaseDecimal(component.taxAmount);
    result.push({
      accountId: account.account_id, partyId: options.partyId, description: `${options.direction === "output" ? "Output" : "Input"} ${component.taxType === "other" ? "tax" : component.taxType.toUpperCase()} ${line.description}`,
      debit: options.direction === "input" ? amount : 0, credit: options.direction === "output" ? amount : 0, referenceType: options.referenceType, referenceId: options.referenceId,
      taxBaseAmount: asDatabaseDecimal(component.taxableAmount), taxCode: component.taxType,
      metadata: { taxRole: "tax", taxType: component.taxType, sourceLineId: line.id, taxableAmount: asDatabaseDecimal(component.taxableAmount), taxAmount: amount,
        itcStatus: options.direction === "input" ? (blocked ? "INELIGIBLE" : GST_COMPONENTS.has(component.taxType) && options.itcPending ? "PENDING" : "ELIGIBLE") : "NOT_APPLICABLE" },
    });
  }
  return result;
}

// Whether input GST waits for the credit to be confirmed before it is claimable (Accounting settings; on unless a company turns it off).
export async function itcRequiresConfirmation(client, organizationId) {
  const row = (await client.query(`SELECT itc_requires_confirmation FROM tenant.accounting_settings WHERE organization_id=$1`, [organizationId])).rows[0];
  return row ? row.itc_requires_confirmation !== false : true;
}

// The GST supply category of a line: its document's tax treatment, and nil-rated when a taxable line carries no tax.
export function supplyCategory(treatment, taxAmount, reverseCharge = false) {
  if (reverseCharge) return "reverse_charge";
  if (treatment === "exempt") return "exempt";
  if (treatment === "zero_rated") return "zero_rated";
  if (treatment === "non_taxable" || treatment === "non_gst") return "non_gst";
  return decimal(taxAmount || 0) > 0n ? "taxable" : "nil_rated";
}

export async function recordDocumentTaxLedger(client, context, document, detailLines, journalEntryId, direction, options = {}) {
  const isCreditNote = document.invoice_type === "credit_note" || document.bill_type === "credit_note";
  const sign = isCreditNote ? -1n : 1n;
  const sourceType = options.sourceType ?? (direction === "output"
    ? isCreditNote ? "customer_credit_note" : "customer_invoice"
    : isCreditNote ? "vendor_credit_note" : "vendor_bill");
  // Journals written by taxPostingLines say on each line what it is: every tax component, and every untaxed line with its supply category.
  const tagged = (await client.query(
    `SELECT id,metadata FROM tenant.accounting_journal_lines WHERE organization_id=$1 AND journal_entry_id=$2 AND metadata ? 'taxRole' ORDER BY sequence`,
    [context.organizationId, journalEntryId])).rows;
  if (tagged.length) {
    const registration = document.customer_snapshot?.gstin || document.supplier_tax_snapshot?.gstin || document.supplier_snapshot?.gstin || document.supplier_gstin || null;
    for (const line of tagged) {
      const meta = line.metadata;
      const source = detailLines.find((detail) => detail.id === meta.sourceLineId) ?? {};
      const isTax = meta.taxRole === "tax";
      if (!isTax && decimal(source.tax_amount || 0) > 0n) continue;
      const tax = isTax ? decimal(meta.taxAmount || 0) : 0n;
      const itcStatus = direction === "input" && isTax ? meta.itcStatus || "ELIGIBLE" : "NOT_APPLICABLE";
      await client.query(
        `INSERT INTO tenant.accounting_tax_ledger (
          organization_id,journal_entry_id,journal_line_id,source_type,source_id,party_id,
          tax_registration,tax_type,direction,tax_period,taxable_amount,tax_amount,recoverable_amount,
          reverse_charge,place_of_supply,hsn_sac_code,status,supply_category,itc_status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,to_char($10::date,'YYYY-MM'),$11,$12,$13,false,$14,$15,'open',$16,$17)
        ON CONFLICT (organization_id,journal_line_id,tax_type,direction) DO NOTHING`,
        [context.organizationId, journalEntryId, line.id, sourceType, document.id, document.party_id ?? null, registration,
          isTax ? meta.taxType : "other", direction, document.accounting_date ?? document.expense_date,
          asDatabaseDecimal(decimal(isTax ? meta.taxableAmount || 0 : source.net_amount || meta.taxableAmount || 0) * sign), asDatabaseDecimal(tax * sign),
          asDatabaseDecimal(itcStatus === "ELIGIBLE" ? tax * sign : 0n), document.place_of_supply || null, source.hsn_sac_code || null,
          isTax ? "taxable" : (options.supplyCategoryOf?.(source) ?? supplyCategory(null, 0)), itcStatus],
      );
    }
    return;
  }
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
          organization_id,journal_entry_id,journal_line_id,source_type,source_id,party_id,
          tax_registration,tax_type,direction,tax_period,taxable_amount,tax_amount,recoverable_amount,
          reverse_charge,place_of_supply,hsn_sac_code,status
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,to_char($10::date,'YYYY-MM'),$11,$12,$13,$14,$15,$16,'open')
        ON CONFLICT (organization_id,journal_line_id,tax_type,direction) DO NOTHING`,
        [context.organizationId, journalEntryId, journalLine.id,
          sourceType, document.id, document.party_id,
          document.customer_snapshot?.gstin || document.supplier_snapshot?.gstin || null,
          component.taxType, direction, document.accounting_date, asDatabaseDecimal(component.taxableAmount * sign),
          asDatabaseDecimal(component.taxAmount * sign), asDatabaseDecimal(component.recoverableAmount * sign),
          Boolean(document.reverse_charge), document.place_of_supply || null, source.hsn_sac_code || null],
      );
    }
  }
}

