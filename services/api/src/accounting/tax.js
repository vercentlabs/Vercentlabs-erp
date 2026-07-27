import {
  ACCOUNTING_PERMISSIONS,
  AccountingError,
  asDatabaseDecimal,
  decimal,
  loadCompany,
  requirePermission,
  text,
  uuid,
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

export async function createTaxReturn(client, context, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.taxManage);
  const company = await loadCompany(client, context, input.companyId || context.activeCompanyId);
  const periodStart = String(input.periodStart || "").slice(0, 10);
  const periodEnd = String(input.periodEnd || "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(periodStart) || !/^\d{4}-\d{2}-\d{2}$/.test(periodEnd) || periodStart > periodEnd) {
    throw new AccountingError(400, "Tax-return period is invalid.");
  }
  const existing = await client.query(
    `SELECT id,status FROM tenant.accounting_tax_returns
      WHERE organization_id=$1 AND company_id=$2 AND return_type=$3
        AND tax_registration IS NOT DISTINCT FROM $4 AND period_start=$5 AND period_end=$6`,
    [context.organizationId, company.id, text(input.returnType, 50) || "GST",
      text(input.taxRegistration, 100) || null, periodStart, periodEnd],
  );
  if (existing.rows[0] && !["draft", "review"].includes(existing.rows[0].status)) {
    throw new AccountingError(409, "A filed, paid or cancelled tax return cannot be regenerated.");
  }
  const returnType = text(input.returnType, 50) || "GST";
  const ledger = await client.query(
    `SELECT
      COALESCE(sum(taxable_amount) FILTER (WHERE direction='output'),0) AS output_taxable_amount,
      COALESCE(sum(taxable_amount) FILTER (WHERE direction='input'),0) AS input_taxable_amount,
      COALESCE(sum(taxable_amount) FILTER (WHERE direction='withholding'),0) AS withholding_taxable_amount,
      COALESCE(sum(tax_amount) FILTER (WHERE direction='output'),0) AS output_tax,
      COALESCE(sum(recoverable_amount) FILTER (WHERE direction='input'),0) AS input_tax_credit,
      COALESCE(sum(tax_amount) FILTER (WHERE direction='withholding'),0) AS withholding_tax
    FROM tenant.accounting_tax_ledger
    WHERE organization_id=$1 AND company_id=$2 AND tax_period BETWEEN to_char($3::date,'YYYY-MM') AND to_char($4::date,'YYYY-MM')
      AND status IN ('open','reported','carried_forward')`,
    [context.organizationId, company.id, periodStart, periodEnd],
  );
  const totals = ledger.rows[0];
  const taxableAmount = /TDS|WITHHOLD/i.test(returnType)
    ? totals.withholding_taxable_amount
    : /GST/i.test(returnType) ? totals.output_taxable_amount
      : asDatabaseDecimal(decimal(totals.output_taxable_amount || 0) + decimal(totals.input_taxable_amount || 0));
  const netTax = decimal(totals.output_tax || 0) - decimal(totals.input_tax_credit || 0) - decimal(totals.withholding_tax || 0);
  const result = await client.query(
    `INSERT INTO tenant.accounting_tax_returns (
      organization_id,company_id,return_type,tax_registration,period_start,period_end,filing_due_date,
      taxable_amount,output_tax,input_tax_credit,withholding_tax,net_tax_payable,status,created_by,updated_by
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'draft',$13,$13)
    ON CONFLICT (organization_id,company_id,return_type,tax_registration,period_start,period_end)
    DO UPDATE SET taxable_amount=EXCLUDED.taxable_amount,output_tax=EXCLUDED.output_tax,
      input_tax_credit=EXCLUDED.input_tax_credit,withholding_tax=EXCLUDED.withholding_tax,
      net_tax_payable=EXCLUDED.net_tax_payable,updated_by=EXCLUDED.updated_by,updated_at=now()
    RETURNING *`,
    [context.organizationId, company.id, returnType,
      text(input.taxRegistration, 100) || null, periodStart, periodEnd, input.filingDueDate || null,
      taxableAmount, totals.output_tax, totals.input_tax_credit, totals.withholding_tax,
      asDatabaseDecimal(netTax > 0n ? netTax : 0n), context.userId],
  );
  const taxReturn = result.rows[0];
  await client.query(
    `DELETE FROM tenant.accounting_tax_return_lines
      WHERE organization_id=$1 AND tax_return_id=$2`,
    [context.organizationId, taxReturn.id],
  );
  await client.query(
    `INSERT INTO tenant.accounting_tax_return_lines (
       organization_id,tax_return_id,tax_ledger_id,included_amount
     )
     SELECT organization_id,$2,id,
       CASE WHEN direction='input' THEN recoverable_amount ELSE tax_amount END
     FROM tenant.accounting_tax_ledger
     WHERE organization_id=$1 AND company_id=$3
       AND tax_period BETWEEN to_char($4::date,'YYYY-MM') AND to_char($5::date,'YYYY-MM')
       AND status IN ('open','reported','carried_forward')
     ON CONFLICT (organization_id,tax_return_id,tax_ledger_id) DO UPDATE SET
       included_amount=EXCLUDED.included_amount`,
    [context.organizationId, taxReturn.id, company.id, periodStart, periodEnd],
  );
  return taxReturn;
}

export async function updateTaxReturnStatus(client, context, id, input) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.taxManage);
  const taxReturnId = uuid(id, "Tax return");
  const current = await client.query(
    `SELECT * FROM tenant.accounting_tax_returns WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, taxReturnId],
  );
  const taxReturn = current.rows[0];
  if (!taxReturn) throw new AccountingError(404, "Tax return was not found.");
  const next = String(input.status || "");
  const allowed = {
    draft: new Set(["review", "cancelled"]),
    review: new Set(["draft", "filed", "cancelled"]),
    filed: new Set(["paid", "amended"]),
    paid: new Set(["amended"]),
    amended: new Set([]),
    cancelled: new Set([]),
  };
  if (!allowed[taxReturn.status]?.has(next)) {
    throw new AccountingError(409, `Tax return cannot move from ${taxReturn.status} to ${next}.`);
  }
  const externalReference = text(input.externalReference, 200) || null;
  if (["filed", "paid"].includes(next) && !externalReference && !taxReturn.external_reference) {
    throw new AccountingError(400, "A filing or payment reference is required.");
  }
  const updated = await client.query(
    `UPDATE tenant.accounting_tax_returns SET status=$3,
       external_reference=COALESCE($4,external_reference),
       filed_at=CASE WHEN $3='filed' THEN now() ELSE filed_at END,
       filed_by=CASE WHEN $3='filed' THEN $5 ELSE filed_by END,
       updated_by=$5,updated_at=now()
     WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, taxReturnId, next, externalReference, context.userId],
  );
  if (next === "filed") {
    await client.query(
      `UPDATE tenant.accounting_tax_ledger ledger SET status='reported'
       FROM tenant.accounting_tax_return_lines line
       WHERE line.organization_id=$1 AND line.tax_return_id=$2
         AND ledger.organization_id=line.organization_id AND ledger.id=line.tax_ledger_id
         AND ledger.status='open'`,
      [context.organizationId, taxReturnId],
    );
  }
  return updated.rows[0];
}

export async function listTaxReturns(client, context, filters = {}) {
  requirePermission(context, ACCOUNTING_PERMISSIONS.view);
  const values = [context.organizationId];
  let where = "";
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where += ` AND tax_return.company_id=$${values.length}`;
  }
  if (filters.companyId) {
    values.push(uuid(filters.companyId, "Company"));
    where += ` AND tax_return.company_id=$${values.length}`;
  }
  const result = await client.query(
    `SELECT tax_return.*,company.name AS company_name
    FROM tenant.accounting_tax_returns tax_return
    JOIN public.companies company ON company.id=tax_return.company_id
    WHERE tax_return.organization_id=$1${where}
    ORDER BY tax_return.period_end DESC,tax_return.return_type`,
    values,
  );
  return result.rows;
}
