// Vendor credits: the supplier's financial credit, recorded as Finance's credit_note vendor document (VC-…) and posted through Finance.
//
//   origin          the supplier's credit note (number and date; never recorded twice), a debit note the supplier accepted (never more than
//                   accepted), or another authorised basis — on account, with the exceptional permission and its justification
//   lines           a quantity or an amount off a line of a posted bill — one credit may correct several bills of the same supplier, company
//                   and currency — a returned line's billed quantity, or an amount on account with no bill. What a bill line or a return line
//                   may still be credited counts every credit not cancelled or reversed (a draft holds its share until it is cancelled); the
//                   posting checks it again under the credit's lock.
//   tax             GST-adjusting: the bill line's tax components reduce proportionally; financial only: no tax. Withholding (TDS) follows the
//                   credited value in both. Reverse-charge lines are corrected by Finance's own GST adjustment, never here.
//
// Posting never applies the credit: allocating it to bills and refunds are their own Finance steps (settlement.js).
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { add, decimal, div, formatDecimal, mul, roundMoney, sub } from "../../../core/decimal.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import {
  AccountingError, approveSubledgerDocument, cancelDraftVendorBill, createVendorBill, postVendorBill, reverseVendorCreditNote, submitSubledgerDocument, updateDraftVendorBill,
} from "../../accounting/index.js";
import { recordPoEvent } from "../purchase-orders/persist.js";
import { recordReturnEvent } from "../purchase-returns/returns.js";
import { currencyPlaces } from "../supplier-bills/calculate.js";
import { claimCredited, loadClaim, recordClaimEvent, refreshClaimResolution, supplierOf, supplierSnapshot } from "./claims.js";
import {
  CLAIM_ROUNDING, LIVE_SQL, POSTED_STATUSES, REASON_LABELS, VC_PERMISSIONS, VendorCreditError, can, dayOf, dec, drafting, fail, fin, normalizedNumber, optionalUuid, readAmount, readDate, readReason,
  requireAny, requireCreditView, requireUuid, text,
} from "./constants.js";

const CREDITABLE_CLAIM = ["accepted", "partially_accepted"];
const ORIGINS = ["supplier_credit_note", "accepted_claim", "other_authorized"];

export async function finance(work) {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AccountingError) throw new VendorCreditError(error.status ?? 409, error.message, error.code === "ACCOUNTING_ERROR" ? "VENDOR_CREDIT_FINANCE" : error.code);
    throw error;
  }
}

export async function loadCredit(client, context, creditId, { lock = false } = {}) {
  requireCreditView(context);
  const row = (await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, requireUuid(creditId, "Vendor credit")])).rows[0];
  if (!row || row.bill_type !== "credit_note") throw new VendorCreditError(404, "Vendor credit not found.", "VENDOR_CREDIT_NOT_FOUND");
  return row;
}
const requirePrepare = (context) => requireAny(context, [VC_PERMISSIONS.creditsManage, VC_PERMISSIONS.payablesManage, VC_PERMISSIONS.creditsExceptional], "You do not have permission to prepare vendor credits.");

// ---------------------------------------------------------------- entitlement

// What each bill line was already credited by (credits not cancelled or reversed, other than `excludeCreditId`): quantity and taxable value.
export async function creditedOnBillLines(client, organizationId, billLineIds, { excludeCreditId = null } = {}) {
  if (!billLineIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT line.source_bill_line_id, COALESCE(sum(line.quantity) FILTER (WHERE line.adjustment_kind = 'quantity'), 0) AS quantity, COALESCE(sum(line.net_amount), 0) AS taxable
       FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills credit ON credit.organization_id = line.organization_id AND credit.id = line.vendor_bill_id
      WHERE line.organization_id = $1 AND line.source_bill_line_id = ANY($2::uuid[]) AND credit.bill_type = 'credit_note' AND credit.status ${LIVE_SQL} AND ($3::uuid IS NULL OR credit.id <> $3)
      GROUP BY line.source_bill_line_id`, [organizationId, billLineIds, excludeCreditId]);
  return new Map(rows.map((row) => [row.source_bill_line_id, { quantity: decimal(row.quantity), taxable: decimal(row.taxable) }]));
}

// What a returned line may still be credited, per bill line that billed it: its billed share less credits not cancelled or reversed.
export async function returnLineEntitlement(client, organizationId, returnLineId, { excludeCreditId = null } = {}) {
  const { rows } = await client.query(
    `SELECT allocation.supplier_bill_id, allocation.supplier_bill_line_id, sum(allocation.allocated_quantity) AS billed,
            COALESCE((SELECT sum(credited.allocated_quantity) FROM tenant.purchase_return_financial_allocations credited
               JOIN tenant.accounting_vendor_bills credit ON credit.organization_id = credited.organization_id AND credit.id = credited.debit_note_id
              WHERE credited.organization_id = allocation.organization_id AND credited.purchase_return_line_id = allocation.purchase_return_line_id AND credited.allocation_type = 'debit_note'
                AND credited.supplier_bill_line_id = allocation.supplier_bill_line_id AND credit.status ${LIVE_SQL} AND ($3::uuid IS NULL OR credit.id <> $3)), 0) AS credited
       FROM tenant.purchase_return_financial_allocations allocation
      WHERE allocation.organization_id = $1 AND allocation.purchase_return_line_id = $2 AND allocation.allocation_type = 'billed'
      GROUP BY allocation.supplier_bill_id, allocation.supplier_bill_line_id, allocation.purchase_return_line_id, allocation.organization_id`, [organizationId, returnLineId, excludeCreditId]);
  return rows.map((row) => ({ billId: row.supplier_bill_id, billLineId: row.supplier_bill_line_id, billed: decimal(row.billed), credited: decimal(row.credited),
    open: sub(decimal(row.billed), decimal(row.credited)) > 0n ? sub(decimal(row.billed), decimal(row.credited)) : 0n }));
}

// calculateAvailableCreditEntitlement: what a bill line (quantity and taxable value) or a returned line (billed quantity) may still be credited.
// input: { billLineId } | { purchaseReturnLineId }, excludeCreditId?
export async function calculateAvailableCreditEntitlement(client, context, input = {}) {
  requireCreditView(context);
  const organizationId = context.organizationId;
  const excludeCreditId = optionalUuid(input.excludeCreditId, "Vendor credit");
  if (input.purchaseReturnLineId) {
    const lines = await returnLineEntitlement(client, organizationId, requireUuid(input.purchaseReturnLineId, "Purchase return line"), { excludeCreditId });
    return { purchaseReturnLineId: input.purchaseReturnLineId, billed: dec(lines.reduce((total, line) => add(total, line.billed), 0n)),
      credited: dec(lines.reduce((total, line) => add(total, line.credited), 0n)), open: dec(lines.reduce((total, line) => add(total, line.open), 0n)),
      byBillLine: lines.map((line) => ({ ...line, billed: dec(line.billed), credited: dec(line.credited), open: dec(line.open) })) };
  }
  const line = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND id = $2`, [organizationId, requireUuid(input.billLineId, "Bill line")])).rows[0];
  if (!line) throw new VendorCreditError(404, "Bill line not found.", "VENDOR_CREDIT_LINE_INVALID");
  const before = (await creditedOnBillLines(client, organizationId, [line.id], { excludeCreditId })).get(line.id) ?? { quantity: 0n, taxable: 0n };
  return { billLineId: line.id, billedQuantity: dec(line.quantity), billedTaxable: dec(line.net_amount), creditedQuantity: dec(before.quantity), creditedTaxable: dec(before.taxable),
    openQuantity: dec(sub(decimal(line.quantity), before.quantity)), openTaxable: dec(sub(decimal(line.net_amount), before.taxable)) };
}

// ---------------------------------------------------------------- building a credit

async function loadBillLine(client, organizationId, billLineId, label) {
  const line = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND id = $2`, [organizationId, billLineId])).rows[0];
  const bill = line && (await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2`, [organizationId, line.vendor_bill_id])).rows[0];
  if (!bill || bill.bill_type !== "bill") throw new VendorCreditError(404, `${label}: the bill line was not found.`, "VENDOR_CREDIT_LINE_INVALID");
  return { line, bill };
}

// The header and Finance lines of a credit from its input, with every source checked. Returns { header, lines, sources, issues, totals }.
// Throws on the first blocking problem; `issues` are warnings.
// revalidate: a stored credit checked again (posting, preview) — its recorded authorisation stands; whoever posts need not hold the exceptional permission.
export async function buildVendorCredit(client, context, input, { current = null, revalidate = false } = {}) {
  const organizationId = context.organizationId;
  const excludeCreditId = current?.id ?? null;
  const supplier = await supplierOf(client, organizationId, current?.supplier_id ?? input.supplierId);
  if (supplier.status === "blocked") fail(`${supplier.display_name} is blocked.`, "supplierId", "VENDOR_CREDIT_SUPPLIER_INVALID", 409);
  const origin = ORIGINS.includes(input.origin) ? input.origin : fail("Choose where the credit comes from.", "origin", "VENDOR_CREDIT_ORIGIN_REQUIRED");
  const taxTreatment = input.taxTreatment === "financial_only" ? "financial_only" : "gst_adjusting";
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 3) fail("Give the reason for the credit.", "reason", "VENDOR_CREDIT_REASON_REQUIRED");
  const issues = [];

  // Origin.
  const supplierNoteNumber = text(input.supplierCreditNoteNumber, 100);
  const supplierNoteDate = readDate(input.supplierCreditNoteDate, "Supplier credit note date");
  if (origin === "supplier_credit_note") {
    if (!supplierNoteNumber) fail("Enter the supplier's credit note number.", "supplierCreditNoteNumber", "VENDOR_CREDIT_SUPPLIER_NOTE_REQUIRED");
    if (!supplierNoteDate) fail("Enter the supplier's credit note date.", "supplierCreditNoteDate", "VENDOR_CREDIT_SUPPLIER_NOTE_REQUIRED");
  }
  if (supplierNoteNumber) {
    const duplicate = await findDuplicateSupplierCreditNote(client, organizationId, supplier.party_id, supplierNoteNumber, excludeCreditId);
    if (duplicate) throw new VendorCreditError(409, `Supplier credit note ${supplierNoteNumber} is already recorded as ${duplicate.bill_number}.`, "VENDOR_CREDIT_DUPLICATE_SUPPLIER_NOTE",
      { field: "supplierCreditNoteNumber", duplicate: { id: duplicate.id, number: duplicate.bill_number } });
  }
  let claim = null;
  const claimId = optionalUuid(input.debitClaimId ?? current?.debit_claim_id, "Debit claim");
  if (origin === "accepted_claim" && !claimId) fail("Choose the debit claim the supplier accepted.", "debitClaimId", "VENDOR_CREDIT_CLAIM_REQUIRED");
  if (claimId) {
    claim = await loadClaim(client, context, claimId, { lock: true });
    if (claim.supplier_id !== supplier.id) fail(`${claim.claim_number} is another supplier's debit claim.`, "debitClaimId", "VENDOR_CREDIT_SUPPLIER_MISMATCH", 409);
    if (!CREDITABLE_CLAIM.includes(claim.status))
      fail(`${claim.claim_number} is ${claim.status.replace("_", " ")}: only what the supplier accepted is credited.`, "debitClaimId", "VENDOR_CREDIT_CLAIM_NOT_ACCEPTED", 409);
  }
  let authorization = null;
  if (origin === "other_authorized") {
    const recorded = revalidate && current?.credit_authorized_by;
    if (!recorded && !can(context, VC_PERMISSIONS.creditsExceptional))
      throw new VendorCreditError(403, "A credit without a supplier credit note or an accepted debit claim needs the exceptional-credit permission.", "VENDOR_CREDIT_EXCEPTIONAL_PERMISSION");
    authorization = text(input.authorizationReason, 1000);
    if (!authorization || authorization.length < 10) fail("Explain the documented basis for this credit (at least 10 characters).", "authorizationReason", "VENDOR_CREDIT_AUTHORIZATION_REQUIRED");
  }

  // Lines.
  if (!Array.isArray(input.lines) || !input.lines.length) fail("Add what is being credited.", "lines", "VENDOR_CREDIT_NO_LINES");
  const planned = [];
  const returnIds = new Set();
  for (const [index, entry] of input.lines.entries()) {
    const label = `Line ${index + 1}`;
    const lineReason = readReason(entry.reason ?? input.lineReason ?? (entry.purchaseReturnLineId ? "returned_goods" : null), `lines.${index}.reason`);
    if (entry.purchaseReturnLineId) {
      const returnLineId = requireUuid(entry.purchaseReturnLineId, "Purchase return line");
      const returnLine = (await client.query(`SELECT line.*, ret.return_number, ret.document_status, ret.supplier_id, ret.id AS return_id FROM tenant.purchase_return_lines line
          JOIN tenant.purchase_returns ret ON ret.organization_id = line.organization_id AND ret.id = line.purchase_return_id WHERE line.organization_id = $1 AND line.id = $2`,
        [organizationId, returnLineId])).rows[0];
      if (!returnLine) throw new VendorCreditError(404, `${label}: the returned line was not found.`, "VENDOR_CREDIT_LINE_INVALID");
      if (returnLine.supplier_id !== supplier.id) fail(`${label}: ${returnLine.return_number} is another supplier's return.`, `lines.${index}`, "VENDOR_CREDIT_SUPPLIER_MISMATCH", 409);
      if (returnLine.document_status !== "posted") fail(`${label}: ${returnLine.return_number} is not posted — only goods that actually went back are credited.`, `lines.${index}`,
        "VENDOR_CREDIT_RETURN_NOT_POSTED", 409);
      const entitlement = (await returnLineEntitlement(client, organizationId, returnLineId, { excludeCreditId }))
        .filter((share) => !entry.billLineId || share.billLineId === entry.billLineId);
      const billedTotal = entitlement.reduce((total, share) => add(total, share.billed), 0n);
      if (billedTotal <= 0n) fail(`${label}: nothing of the returned ${dec(returnLine.quantity)} was billed — unbilled goods need no credit (they are simply not billed).`, `lines.${index}`,
        "VENDOR_CREDIT_RETURN_NOT_BILLED", 409);
      let wanted = entry.quantity !== undefined && entry.quantity !== null && entry.quantity !== "" ? readAmount(entry.quantity, `${label} quantity`, `lines.${index}.quantity`)
        : entitlement.reduce((total, share) => add(total, share.open), 0n);
      const open = entitlement.reduce((total, share) => add(total, share.open), 0n);
      if (wanted <= 0n || wanted > open)
        throw new VendorCreditError(409, `${label}: ${dec(open)} of the ${dec(billedTotal)} billed and returned on ${returnLine.return_number} is left to credit.`, "VENDOR_CREDIT_EXCEEDS_RETURNED",
          { field: `lines.${index}.quantity` });
      returnIds.add(returnLine.return_id);
      for (const share of entitlement) {
        if (wanted <= 0n) break;
        const take = share.open < wanted ? share.open : wanted;
        if (take <= 0n) continue;
        planned.push({ index, label, reason: lineReason, basis: "quantity", billLineId: share.billLineId, quantity: take, purchaseReturnLineId: returnLineId,
          purchaseReturnId: returnLine.return_id, description: entry.description });
        wanted = sub(wanted, take);
      }
    } else if (entry.billLineId) {
      const basis = entry.basis === "amount" || entry.kind === "value" ? "amount" : "quantity";
      planned.push({ index, label, reason: lineReason, basis, billLineId: requireUuid(entry.billLineId, "Bill line"),
        quantity: basis === "quantity" ? readAmount(entry.quantity, `${label} quantity`, `lines.${index}.quantity`) : null,
        amount: basis === "amount" ? readAmount(entry.amount, `${label} amount`, `lines.${index}.amount`) : null, description: entry.description });
    } else {
      planned.push({ index, label, reason: lineReason, basis: "amount", billLineId: null, amount: readAmount(entry.amount, `${label} amount`, `lines.${index}.amount`),
        description: text(entry.description, 500) ?? fail(`${label}: describe what is credited.`, `lines.${index}.description`), accountId: optionalUuid(entry.accountId, "Account"),
        taxAmount: entry.taxAmount, hsnSacCode: text(entry.hsnSacCode, 30) });
    }
  }

  // The bills the lines correct: posted, the supplier's, one currency and one company.
  const bills = new Map();
  const billLines = new Map();
  for (const plan of planned.filter((entry) => entry.billLineId)) {
    if (!billLines.has(plan.billLineId)) {
      const { line, bill } = await loadBillLine(client, organizationId, plan.billLineId, plan.label);
      billLines.set(line.id, line);
      bills.set(bill.id, bill);
    }
  }
  for (const bill of bills.values()) {
    if (bill.party_id !== supplier.party_id) fail(`${bill.bill_number} is another supplier's bill.`, "lines", "VENDOR_CREDIT_SUPPLIER_MISMATCH", 409);
    if (!POSTED_STATUSES.includes(bill.status)) fail(`${bill.bill_number} is ${bill.status === "reversed" ? "reversed" : "not posted"}: only a posted bill is credited.`, "lines", "VENDOR_CREDIT_BILL_NOT_POSTED", 409);
  }
  const billList = [...bills.values()];
  const currencies = new Set(billList.map((bill) => bill.currency_code.trim()));
  if (currencies.size > 1) fail("One credit corrects bills in one currency.", "lines", "VENDOR_CREDIT_CURRENCY_MISMATCH", 409);
  const registrations = new Set(billList.map((bill) => bill.buying_registration_id ?? "none"));
  if (registrations.size > 1) fail("One credit corrects bills of one company registration (GSTIN).", "lines", "VENDOR_CREDIT_COMPANY_MISMATCH", 409);
  const firstBill = billList[0] ?? null;
  const currency = firstBill?.currency_code.trim() ?? (input.currencyCode ? String(input.currencyCode).trim().toUpperCase().slice(0, 3) : claim?.currency_code.trim())
    ?? (supplier.default_currency ? String(supplier.default_currency).trim() : (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [organizationId])).rows[0].base_currency.trim());
  if (claim && claim.currency_code.trim() !== currency) fail(`${claim.claim_number} is in ${claim.currency_code.trim()}.`, "debitClaimId", "VENDOR_CREDIT_CURRENCY_MISMATCH", 409);
  const places = await currencyPlaces(client, organizationId, currency);

  // Entitlement per bill line (credits not cancelled or reversed, and the lines before this one).
  const credited = await creditedOnBillLines(client, organizationId, [...billLines.keys()], { excludeCreditId });
  const components = billLines.size ? (await client.query(`SELECT * FROM tenant.supplier_bill_line_taxes WHERE organization_id = $1 AND vendor_bill_line_id = ANY($2::uuid[])`,
    [organizationId, [...billLines.keys()]])).rows : [];
  const lines = [];
  const sources = [];
  for (const plan of planned) {
    if (!plan.billLineId) {
      const amount = roundMoney(plan.amount, places);
      const tax = taxTreatment === "gst_adjusting" && plan.taxAmount !== undefined && plan.taxAmount !== null && plan.taxAmount !== "" ? roundMoney(decimal(String(plan.taxAmount)), places) : 0n;
      if (tax < 0n) fail(`${plan.label}: tax cannot be negative.`, `lines.${plan.index}.taxAmount`);
      lines.push({ description: plan.description, hsnSacCode: plan.hsnSacCode ?? undefined, quantity: "1", unitPrice: dec(amount), grossAmount: dec(amount), discountAmount: "0", netAmount: dec(amount),
        taxAmount: dec(tax), withholdingAmount: "0", accountId: plan.accountId ?? undefined, creditReason: plan.reason, creditBasis: "amount" });
      sources.push({ plan, billLine: null });
      continue;
    }
    const line = billLines.get(plan.billLineId);
    const bill = bills.get(line.vendor_bill_id);
    const label = `${plan.label} (${bill.bill_number} line ${line.sequence})`;
    if (line.reverse_charge) fail(`${label} is taxed under reverse charge: Finance corrects reverse-charge tax through its own GST adjustment.`, `lines.${plan.index}`, "VENDOR_CREDIT_REVERSE_CHARGE", 409);
    const before = credited.get(line.id) ?? { quantity: 0n, taxable: 0n };
    const net = decimal(line.net_amount);
    let quantity; let taxable;
    if (plan.basis === "quantity") {
      quantity = plan.quantity;
      const left = sub(decimal(line.quantity), before.quantity);
      if (quantity > left) throw new VendorCreditError(409, `${label}: only ${dec(left)} of the ${dec(line.quantity)} billed is left to credit.`, "VENDOR_CREDIT_EXCEEDS_BILLED",
        { field: `lines.${plan.index}.quantity` });
      taxable = add(before.quantity, quantity) === decimal(line.quantity) ? sub(net, before.taxable) : roundMoney(div(mul(net, quantity), decimal(line.quantity)), places);
    } else {
      taxable = roundMoney(plan.amount, places);
      quantity = decimal(1);
    }
    const leftValue = sub(net, before.taxable);
    if (taxable > leftValue) throw new VendorCreditError(409, `${label}: only ${dec(leftValue)} of its value is left to credit.`, "VENDOR_CREDIT_EXCEEDS_BILLED", { field: `lines.${plan.index}` });
    if (taxable <= 0n) fail(`${label}: nothing is left to credit.`, `lines.${plan.index}`, "VENDOR_CREDIT_EXCEEDS_BILLED", 409);
    credited.set(line.id, { quantity: add(before.quantity, plan.basis === "quantity" ? quantity : 0n), taxable: add(before.taxable, taxable) });
    const scale = (amount) => (net === 0n ? 0n : roundMoney(div(mul(decimal(amount ?? 0), taxable), net), places));
    const scaled = taxTreatment === "gst_adjusting"
      ? components.filter((component) => component.vendor_bill_line_id === line.id && component.tax_classification === "input").map((component) => ({ taxType: component.tax_type,
        label: component.label, rate: dec(component.tax_rate), taxableAmount: dec(taxable), taxAmount: dec(scale(component.tax_amount)), classification: "input" }))
      : [];
    const tax = taxTreatment === "financial_only" ? 0n : scaled.length ? scaled.reduce((total, component) => add(total, decimal(component.taxAmount)), 0n) : scale(line.tax_amount);
    lines.push({
      itemId: line.item_id ?? undefined, description: text(plan.description, 500) ?? `${REASON_LABELS[plan.reason]}: ${line.description}`, hsnSacCode: line.hsn_sac_code,
      quantity: dec(quantity), uomId: plan.basis === "quantity" ? line.uom_id ?? undefined : undefined, unitPrice: dec(plan.basis === "quantity" ? line.unit_price : taxable),
      grossAmount: dec(taxable), discountAmount: "0", netAmount: dec(taxable), taxAmount: dec(tax), withholdingAmount: dec(scale(line.withholding_amount)), accountId: line.expense_account_id,
      varianceAccountId: decimal(line.variance_amount) !== 0n ? line.variance_account_id : undefined, varianceAmount: dec(scale(line.variance_amount)), productType: line.product_type,
      productSnapshot: line.product_snapshot, uomSnapshot: line.uom_snapshot, taxCategoryId: line.tax_category_id ?? undefined, withholdingRate: dec(line.withholding_rate),
      inputTaxEligibility: line.input_tax_eligibility === "blocked" ? "blocked" : undefined,
      purchaseOrderLineId: plan.basis === "quantity" ? line.purchase_order_line_id ?? undefined : undefined, sourceBillLineId: line.id, adjustmentKind: plan.basis === "quantity" ? "quantity" : "value",
      taxDetails: scaled.map((component) => ({ taxType: component.taxType, taxableAmount: component.taxableAmount, taxAmount: component.taxAmount })), taxComponents: scaled,
      creditReason: plan.reason, creditBasis: plan.basis, purchaseReturnLineId: plan.purchaseReturnLineId ?? undefined,
    });
    sources.push({ plan, billLine: line, bill });
  }
  const totals = lines.reduce((sum, line) => ({ taxable: add(sum.taxable, decimal(line.netAmount)), tax: add(sum.tax, decimal(line.taxAmount)),
    withholding: add(sum.withholding, decimal(line.withholdingAmount ?? "0")) }), { taxable: 0n, tax: 0n, withholding: 0n });
  totals.total = sub(add(totals.taxable, totals.tax), totals.withholding);
  if (totals.total <= 0n) fail("The credit total must be more than zero.", "lines", "VENDOR_CREDIT_AMOUNT_INVALID");
  if (claim) {
    const claimed = await claimCredited(client, organizationId, claim.id, { excludeCreditId });
    const room = sub(decimal(claim.accepted_amount), claimed.live);
    if (totals.total > room) throw new VendorCreditError(409, `${claim.claim_number}: ${dec(room > 0n ? room : 0n)} of the ${dec(claim.accepted_amount)} the supplier accepted is left to credit.`,
      "VENDOR_CREDIT_EXCEEDS_ACCEPTED", { field: "lines" });
  }
  if (supplierNoteDate && firstBill && supplierNoteDate < dayOf(firstBill.bill_date)) issues.push("The supplier's credit note is dated before the bill it corrects.");
  const creditDate = readDate(input.creditDate, "Credit date") ?? (current ? dayOf(current.bill_date) : null) ?? (await client.query(`SELECT current_date::text AS d`)).rows[0].d;
  const earliest = billList.map((bill) => dayOf(bill.bill_date)).sort()[0];
  if (earliest && creditDate < earliest) fail("A credit cannot be dated before the bill it corrects.", "creditDate", "VENDOR_CREDIT_DATE_INVALID");
  const orders = new Set(billList.map((bill) => bill.source_purchase_order_id).filter(Boolean));
  const purchaseReturnId = returnIds.size === 1 ? [...returnIds][0] : optionalUuid(input.purchaseReturnId, "Purchase return");
  const header = {
    billType: "credit_note", partyId: supplier.party_id, supplierId: supplier.id, sourceBillId: bills.size === 1 ? firstBill.id : undefined,
    sourcePurchaseOrderId: orders.size === 1 ? [...orders][0] : undefined, supplierInvoiceReference: supplierNoteNumber, billDate: creditDate,
    accountingDate: readDate(input.postingDate, "Posting date") ?? creditDate, dueDate: creditDate, currencyCode: currency,
    exchangeRate: firstBill ? formatDecimal(firstBill.exchange_rate) : undefined, paymentTermSnapshot: firstBill?.payment_term_snapshot ?? undefined, matchingStatus: "not_required",
    notes: text(input.notes, 2000), supplierSnapshot: firstBill?.supplier_snapshot ?? { id: supplier.party_id, displayName: supplier.display_name, legalName: supplier.legal_name, gstin: supplier.gstin, pan: supplier.pan },
    sourceType: firstBill?.source_type ?? "direct", supplierTaxRegistrationId: firstBill?.supplier_tax_registration_id ?? undefined, supplierTaxSnapshot: firstBill?.supplier_tax_snapshot ?? undefined,
    supplierAddressSnapshot: firstBill?.supplier_address_snapshot ?? undefined, buyingRegistrationId: firstBill?.buying_registration_id ?? claim?.buying_registration_id ?? undefined,
    buyingRegistrationSnapshot: firstBill?.buying_registration_snapshot ?? undefined, placeOfSupply: firstBill?.place_of_supply ?? undefined, supplyNature: firstBill?.supply_nature ?? undefined,
    priceMode: "exclusive", withholdingSectionId: firstBill?.withholding_section_id ?? undefined, debitNoteReason: reason, sourcePurchaseReturnId: purchaseReturnId ?? undefined,
    creditOrigin: origin, supplierCreditNoteDate: supplierNoteDate, taxTreatment, debitClaimId: claim?.id ?? null,
    creditAuthorizationReason: authorization, creditAuthorizedBy: authorization ? (revalidate && current?.credit_authorized_by) || context.userId || null : null, lines,
  };
  return { header, sources, issues, totals, supplier, claim, bills: billList };
}

export async function findDuplicateSupplierCreditNote(client, organizationId, partyId, number, excludeCreditId = null) {
  const key = normalizedNumber(number);
  if (!key) return null;
  return (await client.query(
    `SELECT id, bill_number FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND party_id = $2 AND bill_type = 'credit_note' AND status ${LIVE_SQL}
        AND upper(regexp_replace(COALESCE(supplier_invoice_reference, ''), '[[:space:]_/.-]+', '', 'g')) = $3 AND ($4::uuid IS NULL OR id <> $4) LIMIT 1`,
    [organizationId, partyId, key, excludeCreditId])).rows[0] ?? null;
}

// checkDuplicateSupplierCreditNote. input: { supplierId, supplierCreditNoteNumber, excludeCreditId? }
export async function checkDuplicateSupplierCreditNote(client, context, input = {}) {
  requireCreditView(context);
  const supplier = await supplierOf(client, context.organizationId, input.supplierId);
  const duplicate = await findDuplicateSupplierCreditNote(client, context.organizationId, supplier.party_id, input.supplierCreditNoteNumber, optionalUuid(input.excludeCreditId, "Vendor credit"));
  return { duplicate: Boolean(duplicate), existing: duplicate ? { id: duplicate.id, number: duplicate.bill_number } : null };
}

// The return lines a credit corrects, recorded on the return (they count once the credit is posted; a draft holds its share).
async function linkReturnLines(client, context, creditId, sources) {
  await client.query(`DELETE FROM tenant.purchase_return_financial_allocations WHERE organization_id = $1 AND debit_note_id = $2 AND allocation_type = 'debit_note'`, [context.organizationId, creditId]);
  const creditLines = (await client.query(`SELECT id, sequence, net_amount FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND vendor_bill_id = $2 ORDER BY sequence`,
    [context.organizationId, creditId])).rows;
  for (const [index, source] of sources.entries()) {
    if (!source.plan.purchaseReturnLineId) continue;
    const creditLine = creditLines[index];
    await client.query(
      `INSERT INTO tenant.purchase_return_financial_allocations (organization_id, purchase_return_id, purchase_return_line_id, allocation_type, supplier_bill_id, supplier_bill_line_id,
         debit_note_id, debit_note_line_id, allocated_quantity, allocated_value, created_by) VALUES ($1, $2, $3, 'debit_note', $4, $5, $6, $7, $8, $9, $10)`,
      [context.organizationId, source.plan.purchaseReturnId, source.plan.purchaseReturnLineId, source.bill.id, source.billLine.id, creditId, creditLine.id, dec(source.plan.quantity),
        dec(creditLine.net_amount), context.userId ?? null]);
  }
}

// ---------------------------------------------------------------- create / change

// createVendorCredit. input: { supplierId, origin, reason, supplierCreditNoteNumber?, supplierCreditNoteDate?, creditDate?, postingDate?, taxTreatment?, debitClaimId?,
//   authorizationReason? (other_authorized), currencyCode? (on account), notes?, lines: [{ billLineId? | purchaseReturnLineId?, basis: "quantity" | "amount", quantity?, amount?,
//   reason, description?, accountId?, taxAmount? }], post?, idempotencyKey? }
export async function createVendorCredit(client, context, input = {}) {
  requirePrepare(context);
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "procurement.vendor_credit.create", key: text(input.idempotencyKey, 200), payload: { ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const built = await buildVendorCredit(client, context, input);
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "vendor_credit", at: new Date(`${built.header.billDate}T12:00:00Z`) });
  const created = await finance(() => createVendorBill(client, drafting(context), built.header, { documentNumber: number }));
  const creditId = created.bill.id;
  await linkReturnLines(client, context, creditId, built.sources);
  if (built.claim) await recordClaimEvent(client, context, built.claim.id, "claim.credit_created", `Vendor credit ${number} drafted for ${dec(created.bill.grand_total)}`, { creditId });
  for (const returnId of new Set(built.sources.map((source) => source.plan.purchaseReturnId).filter(Boolean)))
    await recordReturnEvent(client, context, returnId, "purchase_return.credit_created", `Vendor credit ${number} drafted for the billed goods returned`, { creditId });
  let response = { id: creditId, creditNumber: number, status: "draft", total: dec(created.bill.grand_total), warnings: built.issues, replayed: false };
  if (input.post) response = { ...response, ...(await postVendorCredit(client, context, creditId)), creditNumber: number, total: dec(created.bill.grand_total) };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "vendor_bill", aggregateId: creditId });
  return response;
}

// createCreditFromSupplierBill: a credit correcting lines of one posted bill. input: as createVendorCredit, lines: [{ billLineId, basis | kind, quantity? | amount?, reason }]
export async function createCreditFromSupplierBill(client, context, billId, input = {}) {
  requirePrepare(context);
  const bill = (await client.query(`SELECT id, bill_type, supplier_id, party_id FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, requireUuid(billId, "Supplier bill")])).rows[0];
  if (!bill || bill.bill_type !== "bill") throw new VendorCreditError(404, "Supplier bill not found.", "SUPPLIER_BILL_NOT_FOUND");
  if (!Array.isArray(input.lines) || !input.lines.length) fail("Choose what is being credited.", "lines", "VENDOR_CREDIT_NO_LINES");
  const own = new Set((await client.query(`SELECT id FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND vendor_bill_id = $2`, [context.organizationId, bill.id])).rows.map((row) => row.id));
  if (input.lines.some((line) => !own.has(line.billLineId))) throw new VendorCreditError(404, "That line is not on this bill.", "VENDOR_CREDIT_LINE_INVALID");
  return createVendorCredit(client, context, { origin: input.debitClaimId ? "accepted_claim" : "supplier_credit_note", ...input, supplierId: bill.supplier_id });
}

// createCreditFromPurchaseReturn: a credit for the billed part of a posted return — every returned line still to be credited, or the lines given.
// input: as createVendorCredit; lines?: [{ purchaseReturnLineId, quantity? }]
export async function createCreditFromPurchaseReturn(client, context, returnId, input = {}) {
  requirePrepare(context);
  const ret = (await client.query(`SELECT id, return_number, supplier_id, document_status FROM tenant.purchase_returns WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, requireUuid(returnId, "Purchase return")])).rows[0];
  if (!ret) throw new VendorCreditError(404, "Purchase return not found.", "PURCHASE_RETURN_NOT_FOUND");
  if (ret.document_status !== "posted") throw new VendorCreditError(409, `${ret.return_number} is not posted: only goods that actually went back are credited.`, "VENDOR_CREDIT_RETURN_NOT_POSTED");
  let lines = input.lines;
  if (!Array.isArray(lines) || !lines.length) {
    const returnLines = (await client.query(`SELECT id FROM tenant.purchase_return_lines WHERE organization_id = $1 AND purchase_return_id = $2 ORDER BY line_number`, [context.organizationId, ret.id])).rows;
    lines = [];
    for (const line of returnLines) {
      const open = (await returnLineEntitlement(client, context.organizationId, line.id)).reduce((total, share) => add(total, share.open), 0n);
      if (open > 0n) lines.push({ purchaseReturnLineId: line.id, quantity: dec(open), reason: "returned_goods" });
    }
    if (!lines.length) throw new VendorCreditError(409, `Nothing billed on ${ret.return_number} is left to credit.`, "PURCHASE_RETURN_NOTHING_TO_CREDIT");
  }
  return createVendorCredit(client, context, { origin: input.debitClaimId ? "accepted_claim" : "supplier_credit_note", reason: `Goods returned on ${ret.return_number}`, ...input,
    supplierId: ret.supplier_id, purchaseReturnId: ret.id, lines: lines.map((line) => ({ reason: "returned_goods", ...line })) });
}

// createCreditFromAcceptedClaim: a credit for what the supplier accepted of a debit note and is not yet credited — the claim's lines, scaled
// to it — or the lines given. input: as createVendorCredit
export async function createCreditFromAcceptedClaim(client, context, claimId, input = {}) {
  requirePrepare(context);
  const claim = await loadClaim(client, context, claimId);
  if (!CREDITABLE_CLAIM.includes(claim.status)) throw new VendorCreditError(409, `${claim.claim_number} is not accepted by the supplier.`, "VENDOR_CREDIT_CLAIM_NOT_ACCEPTED");
  let lines = input.lines;
  if (!Array.isArray(lines) || !lines.length) {
    const credited = await claimCredited(client, context.organizationId, claim.id);
    const room = sub(decimal(claim.accepted_amount), credited.live);
    if (room <= CLAIM_ROUNDING) throw new VendorCreditError(409, `${claim.claim_number} is fully credited.`, "VENDOR_CREDIT_EXCEEDS_ACCEPTED");
    const claimLines = (await client.query(`SELECT * FROM tenant.supplier_debit_claim_lines WHERE organization_id = $1 AND claim_id = $2 ORDER BY line_number`, [context.organizationId, claim.id])).rows;
    const places = await currencyPlaces(client, context.organizationId, claim.currency_code.trim());
    const claimed = decimal(claim.claimed_amount);
    const factor = (amount) => roundMoney(div(mul(decimal(amount), room), claimed), places);
    const full = room === claimed;
    lines = claimLines.map((line) => ({
      reason: line.reason, description: line.description,
      ...(line.supplier_bill_line_id
        ? (full && line.basis === "quantity" ? { billLineId: line.supplier_bill_line_id, basis: "quantity", quantity: dec(line.quantity) }
          : { billLineId: line.supplier_bill_line_id, basis: "amount", amount: dec(factor(line.amount)) })
        : { basis: "amount", amount: dec(factor(line.amount)), taxAmount: dec(factor(line.tax_amount)) }),
    })).filter((line) => line.basis === "quantity" || decimal(line.amount) > 0n);
  }
  return createVendorCredit(client, context, { reason: `Debit claim ${claim.claim_number} accepted by the supplier`, ...input, origin: "accepted_claim", supplierId: claim.supplier_id,
    debitClaimId: claim.id, currencyCode: claim.currency_code.trim(), lines });
}

// updateDraftVendorCredit: a draft's origin, dates, treatment and lines, rebuilt and checked as on creation. input: as createVendorCredit (supplier fixed)
export async function updateDraftVendorCredit(client, context, creditId, input = {}) {
  requirePrepare(context);
  const current = await loadCredit(client, context, creditId, { lock: true });
  if (current.status !== "draft") throw new VendorCreditError(409, "Only a draft vendor credit can be changed.", "VENDOR_CREDIT_LOCKED");
  const stored = await storedInput(client, context, current);
  const built = await buildVendorCredit(client, context, { ...stored, ...input, supplierId: current.supplier_id }, { current });
  await finance(() => updateDraftVendorBill(client, drafting(context), current.id, built.header));
  await linkReturnLines(client, context, current.id, built.sources);
  const updated = await loadCredit(client, context, current.id);
  return { id: current.id, creditNumber: current.bill_number, status: "draft", total: dec(updated.grand_total), warnings: built.issues };
}

// A stored credit as input again (to rebuild and re-check it).
async function storedInput(client, context, credit) {
  const lines = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND vendor_bill_id = $2 ORDER BY sequence`, [context.organizationId, credit.id])).rows;
  const merged = [];
  for (const line of lines) {
    const basis = line.credit_basis ?? (line.adjustment_kind === "quantity" ? "quantity" : "amount");
    const previous = merged[merged.length - 1];
    if (line.purchase_return_line_id && previous?.purchaseReturnLineId === line.purchase_return_line_id) {
      previous.quantity = dec(add(decimal(previous.quantity), decimal(line.quantity)));
      continue;
    }
    merged.push(line.purchase_return_line_id ? { purchaseReturnLineId: line.purchase_return_line_id, quantity: dec(line.quantity), reason: line.credit_reason ?? "returned_goods",
      description: line.description }
      : line.source_bill_line_id ? { billLineId: line.source_bill_line_id, basis, quantity: basis === "quantity" ? dec(line.quantity) : undefined,
        amount: basis === "amount" ? dec(line.net_amount) : undefined, reason: line.credit_reason ?? "other", description: line.description }
        : { basis: "amount", amount: dec(line.net_amount), taxAmount: dec(line.tax_amount), accountId: line.expense_account_id, reason: line.credit_reason ?? "other", description: line.description,
          hsnSacCode: line.hsn_sac_code });
  }
  return { supplierId: credit.supplier_id, origin: credit.credit_origin ?? "supplier_credit_note", reason: credit.debit_note_reason, supplierCreditNoteNumber: credit.supplier_invoice_reference,
    supplierCreditNoteDate: dayOf(credit.supplier_credit_note_date), creditDate: dayOf(credit.bill_date), postingDate: dayOf(credit.accounting_date), taxTreatment: credit.tax_treatment ?? "gst_adjusting",
    debitClaimId: credit.debit_claim_id, authorizationReason: credit.credit_authorization_reason, currencyCode: credit.currency_code.trim(), notes: credit.notes, lines: merged };
}

// ---------------------------------------------------------------- validation and calculation

// validateVendorCreditForPosting: everything the posting checks — the source documents, entitlement, duplicates, the claim — as issues.
export async function validateVendorCreditForPosting(client, context, creditId) {
  const credit = await loadCredit(client, context, creditId);
  const issues = [];
  try {
    const stored = await storedInput(client, context, credit);
    const built = await buildVendorCredit(client, context, stored, { current: credit, revalidate: true });
    if (built.totals.total !== decimal(credit.grand_total)) issues.push({ code: "VENDOR_CREDIT_STALE", message: "The source bills changed since the draft was saved: open and save it again." });
  } catch (error) {
    if (!(error instanceof VendorCreditError)) throw error;
    issues.push({ code: error.code, message: error.message });
  }
  return { ready: issues.length === 0, issues };
}
export const validateVendorCreditSource = (client, context, input) => buildVendorCredit(client, context, input).then((built) => ({ ok: true, warnings: built.issues }));
export const validateSupplierCreditNote = (client, context, input) => checkDuplicateSupplierCreditNote(client, context, input);
export const validatePurchaseReturnCreditEligibility = (client, context, purchaseReturnLineId) => calculateAvailableCreditEntitlement(client, context, { purchaseReturnLineId });
export const validateVendorCreditQuantities = (client, context, input) => buildVendorCredit(client, context, input).then(() => ({ ok: true }));

// calculateVendorCreditTotals / calculateVendorCreditTaxes: what a credit would be, from the server's calculation, without recording anything.
export async function calculateVendorCreditTotals(client, context, input = {}) {
  requireCreditView(context);
  const current = input.creditId ? await loadCredit(client, context, input.creditId) : null;
  const built = await buildVendorCredit(client, context, current ? { ...(await storedInput(client, context, current)), ...input } : input, { current, revalidate: Boolean(current) });
  return {
    currencyCode: built.header.currencyCode, taxTreatment: built.header.taxTreatment, warnings: built.issues,
    totals: { taxable: dec(built.totals.taxable), tax: dec(built.totals.tax), withholding: dec(built.totals.withholding), total: dec(built.totals.total) },
    lines: built.header.lines.map((line, index) => ({ description: line.description, billNumber: built.sources[index].bill?.bill_number ?? null, billLineId: line.sourceBillLineId ?? null,
      purchaseReturnLineId: line.purchaseReturnLineId ?? null, basis: line.creditBasis, quantity: line.quantity, taxable: line.netAmount, tax: line.taxAmount, withholding: line.withholdingAmount ?? "0",
      components: (line.taxComponents ?? []).map((component) => ({ taxType: component.taxType, label: component.label, rate: component.rate, amount: component.taxAmount })) })),
  };
}
export const calculateVendorCreditTaxes = calculateVendorCreditTotals;

// ---------------------------------------------------------------- post / approve / cancel / reverse

async function afterPosting(client, context, credit) {
  await refreshClaimResolution(client, context, credit.debit_claim_id);
  if (credit.debit_claim_id) await recordClaimEvent(client, context, credit.debit_claim_id, "claim.credit_posted", `Vendor credit ${credit.bill_number} posted (${dec(credit.grand_total)})`);
  const returns = (await client.query(`SELECT DISTINCT purchase_return_id FROM tenant.purchase_return_financial_allocations WHERE organization_id = $1 AND debit_note_id = $2`,
    [context.organizationId, credit.id])).rows;
  for (const row of returns)
    await recordReturnEvent(client, context, row.purchase_return_id, "purchase_return.credit_posted", `Vendor credit ${credit.bill_number} posted for the billed goods returned`, { creditId: credit.id });
  if (credit.source_purchase_order_id)
    await recordPoEvent(client, context, credit.source_purchase_order_id, "purchase_order.vendor_credit", `Vendor credit ${credit.bill_number} posted: ${credit.debit_note_reason ?? ""}`.trim(),
      { details: { creditId: credit.id } });
}

async function postApproved(client, context, credit) {
  const check = await validateVendorCreditForPosting(client, context, credit.id);
  if (!check.ready) throw new VendorCreditError(409, check.issues[0].message, check.issues[0].code, { issues: check.issues });
  const posted = await finance(() => postVendorBill(client, fin(context), credit.id));
  await afterPosting(client, context, credit);
  return { id: credit.id, status: "posted", journalEntryId: posted.bill.journal_entry_id, replayed: false };
}

// postVendorCredit: Accounts Payable posts the credit through Finance (or submits it for approval). It is never applied to a bill by itself.
export async function postVendorCredit(client, context, creditId) {
  requireAny(context, [VC_PERMISSIONS.payablesManage], "You do not have permission to post vendor credits.");
  const credit = await loadCredit(client, context, creditId, { lock: true });
  if (POSTED_STATUSES.includes(credit.status)) return { id: credit.id, status: "posted", replayed: true };
  if (credit.status === "pending_approval") return { id: credit.id, status: "awaiting_approval", replayed: true };
  if (credit.status !== "draft") throw new VendorCreditError(409, `The credit is ${credit.status}.`, "VENDOR_CREDIT_LOCKED");
  const check = await validateVendorCreditForPosting(client, context, credit.id);
  if (!check.ready) throw new VendorCreditError(409, check.issues[0].message, check.issues[0].code, { issues: check.issues });
  const submitted = await finance(() => submitSubledgerDocument(client, fin(context), "vendor_bill", credit.id));
  if (submitted.status === "pending_approval") return { id: credit.id, status: "awaiting_approval", replayed: false };
  return postApproved(client, context, credit);
}

// approveVendorCredit: Finance's approver approves a credit awaiting approval, and it is posted.
export async function approveVendorCredit(client, context, creditId) {
  requireAny(context, [VC_PERMISSIONS.payablesApprove], "You do not have permission to approve vendor credits.");
  const credit = await loadCredit(client, context, creditId, { lock: true });
  if (credit.status !== "pending_approval") throw new VendorCreditError(409, "The credit is not awaiting approval.", "VENDOR_CREDIT_NOT_PENDING");
  await finance(() => approveSubledgerDocument(client, fin(context), "vendor_bill", credit.id, credit.content_hash));
  return postApproved(client, { ...context, permissions: [...new Set([...(context.permissions ?? []), VC_PERMISSIONS.payablesManage])] }, credit);
}

// cancelDraftVendorCredit: a draft that will not be posted; what it held of bills, returns and the claim is free again. input: { reason }
export async function cancelDraftVendorCredit(client, context, creditId, input = {}) {
  requirePrepare(context);
  const credit = await loadCredit(client, context, creditId, { lock: true });
  if (credit.status === "cancelled") return { id: credit.id, status: "cancelled", replayed: true };
  await finance(() => cancelDraftVendorBill(client, drafting(context), credit.id, { reason: input.reason }));
  if (credit.debit_claim_id) await recordClaimEvent(client, context, credit.debit_claim_id, "claim.credit_cancelled", `Draft vendor credit ${credit.bill_number} cancelled`);
  return { id: credit.id, status: "cancelled", replayed: false };
}

// reverseVendorCredit: a posted credit entered in error — never while a supplier refund stands; its applications are taken off the bills first.
// Its bills, returns and claim may be credited again. input: { reason }
export async function reverseVendorCredit(client, context, creditId, input = {}) {
  requireAny(context, [VC_PERMISSIONS.payablesApprove], "You do not have permission to reverse vendor credits.");
  const credit = await loadCredit(client, context, creditId, { lock: true });
  if (credit.status === "reversed") return { id: credit.id, status: "reversed", replayed: true };
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 3) fail("Give the reason for the reversal.", "reason", "VENDOR_CREDIT_REASON_REQUIRED");
  const result = await finance(() => reverseVendorCreditNote(client, fin(context), credit.id, { reason }));
  await refreshClaimResolution(client, context, credit.debit_claim_id);
  if (credit.debit_claim_id) await recordClaimEvent(client, context, credit.debit_claim_id, "claim.credit_reversed", `Vendor credit ${credit.bill_number} reversed: ${reason}`);
  if (credit.source_purchase_order_id)
    await recordPoEvent(client, context, credit.source_purchase_order_id, "purchase_order.vendor_credit_reversed", `Vendor credit ${credit.bill_number} reversed: ${reason}`, { details: { creditId: credit.id } });
  return { id: credit.id, status: "reversed", unapplied: result.unapplied, replayed: false };
}
