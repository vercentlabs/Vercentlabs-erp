// Debit notes to suppliers: the buyer's documented commercial claim — goods returned, overbilling, a price difference, a deficient service.
// A claim is not a credit: drafted, issued to the supplier, answered (accepted, partly accepted — the rest disputed — or rejected) and then
// resolved by the vendor credits posted against it, or closed. It never touches the payable, tax or the bill.
import { add, decimal, div, mul, roundMoney, sub } from "../../../core/decimal.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { currencyPlaces } from "../supplier-bills/calculate.js";
import {
  CLAIM_ROUNDING, CLAIM_STATUS_LABELS, LIVE_SQL, POSTED_SQL, POSTED_STATUSES, REASON_LABELS, VC_PERMISSIONS, VendorCreditError, can, dayOf, dec, fail, optionalUuid, readAmount, readDate, readReason,
  requireAny, requireClaimView, requireUuid, text,
} from "./constants.js";

const OPEN_FOR_RESPONSE = ["issued", "partially_accepted", "rejected"];
const CREDITABLE = ["accepted", "partially_accepted"];

export async function recordClaimEvent(client, context, claimId, type, summary, details = {}) {
  await client.query(`INSERT INTO tenant.supplier_debit_claim_events (organization_id, claim_id, event_type, summary, details, actor_user_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [context.organizationId, claimId, type, summary, JSON.stringify(details), context.userId ?? null]);
}

export async function loadClaim(client, context, claimId, { lock = false } = {}) {
  requireClaimView(context);
  const row = (await client.query(`SELECT * FROM tenant.supplier_debit_claims WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, requireUuid(claimId, "Debit claim")])).rows[0];
  if (!row) throw new VendorCreditError(404, "Debit claim not found.", "DEBIT_CLAIM_NOT_FOUND");
  return row;
}

export async function supplierOf(client, organizationId, supplierId) {
  const row = (await client.query(
    `SELECT supplier.id, supplier.party_id, supplier.supplier_number, supplier.status, supplier.default_currency, party.display_name, party.legal_name, party.gstin, party.pan
       FROM tenant.procurement_suppliers supplier JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
      WHERE supplier.organization_id = $1 AND supplier.id = $2`, [organizationId, requireUuid(supplierId, "Supplier")])).rows[0];
  if (!row) fail("Choose the supplier from the Supplier Master.", "supplierId", "VENDOR_CREDIT_SUPPLIER_INVALID", 404);
  return row;
}
export const supplierSnapshot = (supplier) => ({ supplierId: supplier.id, supplierNumber: supplier.supplier_number, supplierName: supplier.display_name,
  legalName: supplier.legal_name ?? supplier.display_name, gstin: supplier.gstin, pan: supplier.pan });

// What the credits raised against a claim add up to: live (not cancelled or reversed) and posted.
export async function claimCredited(client, organizationId, claimId, { excludeCreditId = null } = {}) {
  const row = (await client.query(
    `SELECT COALESCE(sum(grand_total) FILTER (WHERE status ${LIVE_SQL}), 0) AS live, COALESCE(sum(grand_total) FILTER (WHERE status IN ${POSTED_SQL}), 0) AS posted
       FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND debit_claim_id = $2 AND bill_type = 'credit_note' AND ($3::uuid IS NULL OR id <> $3)`,
    [organizationId, claimId, excludeCreditId])).rows[0];
  return { live: decimal(row.live), posted: decimal(row.posted) };
}

// A claim is resolved when the credits posted against it cover what the supplier accepted; reversing one of them reopens it.
export async function refreshClaimResolution(client, context, claimId) {
  if (!claimId) return;
  const claim = (await client.query(`SELECT * FROM tenant.supplier_debit_claims WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [context.organizationId, claimId])).rows[0];
  if (!claim || !["accepted", "partially_accepted", "resolved"].includes(claim.status)) return;
  const credited = await claimCredited(client, context.organizationId, claim.id);
  const accepted = decimal(claim.accepted_amount);
  const responded = (await client.query(`SELECT decision FROM tenant.supplier_debit_claim_responses WHERE organization_id = $1 AND claim_id = $2 ORDER BY recorded_at DESC LIMIT 1`,
    [context.organizationId, claim.id])).rows[0]?.decision ?? "accepted";
  const next = accepted > 0n && credited.posted + CLAIM_ROUNDING >= accepted ? "resolved" : responded;
  if (next === claim.status) return;
  await client.query(`UPDATE tenant.supplier_debit_claims SET status = $3, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2`, [context.organizationId, claim.id, next]);
  await recordClaimEvent(client, context, claim.id, next === "resolved" ? "claim.resolved" : "claim.reopened",
    next === "resolved" ? `Resolved: credits of ${dec(credited.posted)} posted` : `Reopened: credits posted now ${dec(credited.posted)} of ${dec(accepted)} accepted`);
}

// ---------------------------------------------------------------- lines

// A claim line: an amount claimed on a posted bill line (or on a returned line, or with no bill at all) and its estimated tax.
async function buildClaimLines(client, context, supplier, input, currency) {
  if (!Array.isArray(input.lines) || !input.lines.length) fail("Add what is being claimed.", "lines", "DEBIT_CLAIM_NO_LINES");
  const organizationId = context.organizationId;
  const places = await currencyPlaces(client, organizationId, currency);
  const lines = [];
  for (const [index, entry] of input.lines.entries()) {
    const label = `Line ${index + 1}`;
    const reason = readReason(entry.reason ?? input.reason, `lines.${index}.reason`);
    let billLine = null;
    let bill = null;
    const billLineId = optionalUuid(entry.supplierBillLineId ?? entry.billLineId, "Bill line");
    if (billLineId) {
      billLine = (await client.query(`SELECT * FROM tenant.accounting_vendor_bill_lines WHERE organization_id = $1 AND id = $2`, [organizationId, billLineId])).rows[0];
      bill = billLine && (await client.query(`SELECT * FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2`, [organizationId, billLine.vendor_bill_id])).rows[0];
      if (!bill || bill.bill_type !== "bill") fail(`${label}: the bill line was not found.`, `lines.${index}.billLineId`, "DEBIT_CLAIM_LINE_INVALID", 404);
      if (bill.party_id !== supplier.party_id) fail(`${label}: ${bill.bill_number} is another supplier's bill.`, `lines.${index}.billLineId`, "DEBIT_CLAIM_SUPPLIER_MISMATCH", 409);
      if (!POSTED_STATUSES.includes(bill.status)) fail(`${label}: ${bill.bill_number} is not posted.`, `lines.${index}.billLineId`, "DEBIT_CLAIM_BILL_NOT_POSTED", 409);
      if (bill.currency_code.trim() !== currency) fail(`${label}: ${bill.bill_number} is in ${bill.currency_code.trim()}, the claim in ${currency}.`, `lines.${index}.billLineId`, "DEBIT_CLAIM_CURRENCY_MISMATCH", 409);
    }
    const basis = entry.basis === "quantity" ? "quantity" : "amount";
    let quantity = null; let unitValue = null; let amount;
    if (basis === "quantity") {
      quantity = readAmount(entry.quantity, `${label} quantity`, `lines.${index}.quantity`);
      unitValue = entry.unitValue !== undefined && entry.unitValue !== null && entry.unitValue !== "" ? readAmount(entry.unitValue, `${label} unit value`, `lines.${index}.unitValue`)
        : billLine ? div(decimal(billLine.net_amount), decimal(billLine.quantity)) : fail(`${label}: enter the unit value.`, `lines.${index}.unitValue`);
      if (billLine && quantity > decimal(billLine.quantity)) fail(`${label}: the bill line billed ${dec(billLine.quantity)}.`, `lines.${index}.quantity`, "DEBIT_CLAIM_EXCEEDS_BILLED", 409);
      amount = roundMoney(mul(quantity, unitValue), places);
    } else {
      amount = roundMoney(readAmount(entry.amount, `${label} amount`, `lines.${index}.amount`), places);
    }
    if (billLine && amount > decimal(billLine.net_amount)) fail(`${label}: the bill line's taxable value is ${dec(billLine.net_amount)}.`, `lines.${index}.amount`, "DEBIT_CLAIM_EXCEEDS_BILLED", 409);
    const tax = entry.taxAmount !== undefined && entry.taxAmount !== null && entry.taxAmount !== "" ? roundMoney(decimal(String(entry.taxAmount)), places)
      : billLine && decimal(billLine.net_amount) > 0n ? roundMoney(div(mul(decimal(billLine.tax_amount), amount), decimal(billLine.net_amount)), places) : 0n;
    if (tax < 0n) fail(`${label}: tax cannot be negative.`, `lines.${index}.taxAmount`);
    lines.push({ lineNumber: index + 1, supplierBillId: bill?.id ?? null, supplierBillLineId: billLine?.id ?? null,
      purchaseReturnLineId: optionalUuid(entry.purchaseReturnLineId, "Purchase return line"), reason,
      description: text(entry.description, 500) ?? (billLine ? `${REASON_LABELS[reason]}: ${billLine.description}` : REASON_LABELS[reason]), basis, quantity, unitValue, amount, tax,
      total: add(amount, tax), notes: text(entry.notes, 1000) });
  }
  return lines;
}

async function writeClaimLines(client, context, claimId, lines) {
  await client.query(`DELETE FROM tenant.supplier_debit_claim_lines WHERE organization_id = $1 AND claim_id = $2`, [context.organizationId, claimId]);
  for (const line of lines)
    await client.query(
      `INSERT INTO tenant.supplier_debit_claim_lines (organization_id, claim_id, line_number, supplier_bill_id, supplier_bill_line_id, purchase_return_line_id, reason, description, basis,
         quantity, unit_value, amount, tax_amount, total, notes) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
      [context.organizationId, claimId, line.lineNumber, line.supplierBillId, line.supplierBillLineId, line.purchaseReturnLineId, line.reason, line.description, line.basis,
        dec(line.quantity), dec(line.unitValue), dec(line.amount), dec(line.tax), dec(line.total), line.notes]);
  return lines.reduce((total, line) => add(total, line.total), 0n);
}

async function claimCurrency(client, context, supplier, input) {
  if (input.currencyCode) return String(input.currencyCode).trim().toUpperCase().slice(0, 3);
  const firstLine = (input.lines ?? []).map((entry) => entry.supplierBillLineId ?? entry.billLineId).find(Boolean);
  if (firstLine) {
    const bill = (await client.query(`SELECT bill.currency_code FROM tenant.accounting_vendor_bill_lines line JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = line.organization_id
       AND bill.id = line.vendor_bill_id WHERE line.organization_id = $1 AND line.id = $2`, [context.organizationId, requireUuid(firstLine, "Bill line")])).rows[0];
    if (bill) return bill.currency_code.trim();
  }
  if (supplier.default_currency) return String(supplier.default_currency).trim();
  return (await client.query(`SELECT base_currency FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0]?.base_currency?.trim() ?? "INR";
}

// ---------------------------------------------------------------- lifecycle

// createSupplierDebitClaim. input: { supplierId, reason, issueDate?, currencyCode?, buyingRegistrationId?, purchaseReturnId?, supplierReference?, notes?,
//   lines: [{ billLineId?, purchaseReturnLineId?, reason, description?, basis: "amount" | "quantity", amount? | quantity + unitValue?, taxAmount?, notes? }], issue? }
export async function createSupplierDebitClaim(client, context, input = {}) {
  requireAny(context, [VC_PERMISSIONS.claimsManage], "You do not have permission to raise debit notes to suppliers.");
  const supplier = await supplierOf(client, context.organizationId, input.supplierId);
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 3) fail("Give the reason for the claim.", "reason", "DEBIT_CLAIM_REASON_REQUIRED");
  const currency = await claimCurrency(client, context, supplier, input);
  const lines = await buildClaimLines(client, context, supplier, input, currency);
  const issueDate = readDate(input.issueDate, "Issue date") ?? (await client.query(`SELECT current_date::text AS d`)).rows[0].d;
  const firstBill = lines.find((line) => line.supplierBillId);
  const registration = optionalUuid(input.buyingRegistrationId, "Company registration") ?? (firstBill
    ? (await client.query(`SELECT buying_registration_id FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND id = $2`, [context.organizationId, firstBill.supplierBillId])).rows[0]?.buying_registration_id
    : null);
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "supplier_debit_claim", at: new Date(`${issueDate}T12:00:00Z`) });
  const row = (await client.query(
    `INSERT INTO tenant.supplier_debit_claims (organization_id, claim_number, supplier_id, party_id, buying_registration_id, currency_code, issue_date, reason, supplier_reference,
       supplier_snapshot, purchase_return_id, notes, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $13) RETURNING *`,
    [context.organizationId, number, supplier.id, supplier.party_id, registration, currency, issueDate, reason, text(input.supplierReference, 100), JSON.stringify(supplierSnapshot(supplier)),
      optionalUuid(input.purchaseReturnId, "Purchase return"), text(input.notes, 2000), context.userId ?? null])).rows[0];
  const total = await writeClaimLines(client, context, row.id, lines);
  await client.query(`UPDATE tenant.supplier_debit_claims SET claimed_amount = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, dec(total)]);
  await recordClaimEvent(client, context, row.id, "claim.created", `Debit claim ${number} drafted for ${dec(total)} ${currency}`);
  if (input.issue) await issueDebitClaim(client, context, row.id);
  return { id: row.id, claimNumber: number, status: input.issue ? "issued" : "draft", claimedAmount: dec(total) };
}

// updateDraftDebitClaim. input: as on creation (supplier fixed), expectedVersion?
export async function updateDraftDebitClaim(client, context, claimId, input = {}) {
  requireAny(context, [VC_PERMISSIONS.claimsManage], "You do not have permission to change debit notes to suppliers.");
  const claim = await loadClaim(client, context, claimId, { lock: true });
  if (claim.status !== "draft") throw new VendorCreditError(409, "Only a draft debit claim can be changed; an issued one is answered by the supplier or closed.", "DEBIT_CLAIM_LOCKED");
  if (input.expectedVersion !== undefined && Number(input.expectedVersion) !== Number(claim.version))
    throw new VendorCreditError(409, "Someone else changed this debit claim. Reload it.", "DEBIT_CLAIM_VERSION_CONFLICT");
  const supplier = await supplierOf(client, context.organizationId, claim.supplier_id);
  const reason = input.reason === undefined ? claim.reason : text(input.reason, 1000);
  if (!reason || reason.length < 3) fail("Give the reason for the claim.", "reason", "DEBIT_CLAIM_REASON_REQUIRED");
  const currency = input.currencyCode ? await claimCurrency(client, context, supplier, input) : claim.currency_code.trim();
  let total = decimal(claim.claimed_amount);
  if (input.lines !== undefined) total = await writeClaimLines(client, context, claim.id, await buildClaimLines(client, context, supplier, input, currency));
  await client.query(
    `UPDATE tenant.supplier_debit_claims SET reason = $3, currency_code = $4, issue_date = COALESCE($5::date, issue_date), supplier_reference = $6, notes = $7, claimed_amount = $8,
       updated_by = $9, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, claim.id, reason, currency, readDate(input.issueDate, "Issue date"), input.supplierReference === undefined ? claim.supplier_reference : text(input.supplierReference, 100),
      input.notes === undefined ? claim.notes : text(input.notes, 2000), dec(total), context.userId ?? null]);
  await recordClaimEvent(client, context, claim.id, "claim.updated", "Draft changed");
  return { id: claim.id, version: Number(claim.version) + 1, claimedAmount: dec(total) };
}

// issueDebitClaim: the claim is sent to the supplier; from now on it changes only by the supplier's response or by closing it.
export async function issueDebitClaim(client, context, claimId, input = {}) {
  requireAny(context, [VC_PERMISSIONS.claimsManage], "You do not have permission to issue debit notes to suppliers.");
  const claim = await loadClaim(client, context, claimId, { lock: true });
  if (claim.status === "issued") return { id: claim.id, status: "issued", replayed: true };
  if (claim.status !== "draft") throw new VendorCreditError(409, `The debit claim is ${CLAIM_STATUS_LABELS[claim.status].toLowerCase()}.`, "DEBIT_CLAIM_LOCKED");
  const lines = (await client.query(`SELECT count(*)::int AS count FROM tenant.supplier_debit_claim_lines WHERE organization_id = $1 AND claim_id = $2`, [context.organizationId, claim.id])).rows[0].count;
  if (!lines || decimal(claim.claimed_amount) <= 0n) fail("Add what is being claimed before issuing.", "lines", "DEBIT_CLAIM_NO_LINES", 409);
  const supplier = await supplierOf(client, context.organizationId, claim.supplier_id);
  if (["blocked", "inactive"].includes(supplier.status)) fail(`${supplier.display_name} is ${supplier.status}.`, "supplierId", "VENDOR_CREDIT_SUPPLIER_INVALID", 409);
  await client.query(`UPDATE tenant.supplier_debit_claims SET status = 'issued', issued_by = $3, issued_at = now(), supplier_snapshot = $4::jsonb, updated_by = $3, updated_at = now(),
     version = version + 1 WHERE organization_id = $1 AND id = $2`, [context.organizationId, claim.id, context.userId ?? null, JSON.stringify(supplierSnapshot(supplier))]);
  await recordClaimEvent(client, context, claim.id, "claim.issued", `Issued to ${supplier.display_name}${text(input.channel, 60) ? ` by ${text(input.channel, 60)}` : ""}`);
  return { id: claim.id, status: "issued", replayed: false };
}

// recordSupplierClaimResponse: what the supplier decided, as recorded — accepted in full, partly (the rest is disputed) or rejected.
// input: { decision: "accepted" | "partially_accepted" | "rejected", acceptedAmount? (partial), supplierReference?, respondedOn?, notes? }
export async function recordSupplierClaimResponse(client, context, claimId, input = {}) {
  requireAny(context, [VC_PERMISSIONS.claimsRespond], "You do not have permission to record supplier responses.");
  const claim = await loadClaim(client, context, claimId, { lock: true });
  if (!OPEN_FOR_RESPONSE.includes(claim.status) && !(claim.status === "accepted" && input.decision !== "accepted"))
    throw new VendorCreditError(409, claim.status === "draft" ? "Issue the debit claim before recording the supplier's response." : `The debit claim is ${CLAIM_STATUS_LABELS[claim.status].toLowerCase()}.`,
      "DEBIT_CLAIM_NOT_OPEN");
  const decision = ["accepted", "partially_accepted", "rejected"].includes(input.decision) ? input.decision : fail("Record whether the supplier accepted, partly accepted or rejected the claim.", "decision");
  const claimed = decimal(claim.claimed_amount);
  let accepted = decision === "accepted" ? claimed : 0n;
  if (decision === "partially_accepted") {
    accepted = readAmount(input.acceptedAmount, "The accepted amount", "acceptedAmount");
    if (accepted >= claimed) fail(`A partial acceptance is less than the ${dec(claimed)} claimed; record a full acceptance instead.`, "acceptedAmount", "DEBIT_CLAIM_ACCEPTED_INVALID");
  }
  const notes = text(input.notes, 2000);
  if (decision !== "accepted" && (!notes || notes.length < 3)) fail("Record what the supplier said (their reason).", "notes", "DEBIT_CLAIM_RESPONSE_NOTES_REQUIRED");
  const credited = await claimCredited(client, context.organizationId, claim.id);
  if (accepted < credited.live) fail(`Credits of ${dec(credited.live)} are already raised against this claim.`, "acceptedAmount", "DEBIT_CLAIM_ACCEPTED_BELOW_CREDITED", 409);
  const rejected = sub(claimed, accepted);
  const respondedOn = readDate(input.respondedOn, "Response date");
  await client.query(
    `INSERT INTO tenant.supplier_debit_claim_responses (organization_id, claim_id, decision, accepted_amount, rejected_amount, supplier_reference, responded_on, notes, recorded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [context.organizationId, claim.id, decision, dec(accepted), dec(rejected), text(input.supplierReference, 100), respondedOn, notes, context.userId ?? null]);
  await client.query(`UPDATE tenant.supplier_debit_claims SET status = $3, accepted_amount = $4, rejected_amount = $5, supplier_reference = COALESCE($6, supplier_reference),
     updated_by = $7, updated_at = now(), version = version + 1 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, claim.id, decision, dec(accepted), dec(rejected), text(input.supplierReference, 100), context.userId ?? null]);
  const summary = decision === "accepted" ? `Supplier accepted ${dec(accepted)}` : decision === "rejected" ? `Supplier rejected the claim: ${notes}`
    : `Supplier accepted ${dec(accepted)}; ${dec(rejected)} disputed: ${notes}`;
  await recordClaimEvent(client, context, claim.id, `claim.${decision}`, summary, { accepted: dec(accepted), rejected: dec(rejected) });
  await refreshClaimResolution(client, context, claim.id);
  return { id: claim.id, status: decision, acceptedAmount: dec(accepted), disputedAmount: dec(rejected) };
}

// recordPartialClaimAcceptance: the supplier accepted part; the rest stays disputed. input: { acceptedAmount, notes, supplierReference?, respondedOn? }
export const recordPartialClaimAcceptance = (client, context, claimId, input = {}) =>
  recordSupplierClaimResponse(client, context, claimId, { ...input, decision: "partially_accepted" });

// closeSupplierDebitClaim: nothing more will come of it — withdrawn (draft), rejected for good, or the rest written off. input: { reason }
export async function closeSupplierDebitClaim(client, context, claimId, input = {}) {
  requireAny(context, [VC_PERMISSIONS.claimsManage], "You do not have permission to close debit notes to suppliers.");
  const claim = await loadClaim(client, context, claimId, { lock: true });
  if (claim.status === "closed") return { id: claim.id, status: "closed", replayed: true };
  const reason = text(input.reason, 1000);
  if (!reason || reason.length < 3) fail("Give the reason for closing the debit claim.", "reason", "DEBIT_CLAIM_REASON_REQUIRED");
  const credited = await claimCredited(client, context.organizationId, claim.id);
  if (credited.live > credited.posted) fail("A draft credit is raised against this claim: post or cancel it first.", "reason", "DEBIT_CLAIM_CREDIT_PENDING", 409);
  await client.query(`UPDATE tenant.supplier_debit_claims SET status = 'closed', closed_by = $3, closed_at = now(), close_reason = $4, updated_by = $3, updated_at = now(), version = version + 1
     WHERE organization_id = $1 AND id = $2`, [context.organizationId, claim.id, context.userId ?? null, reason]);
  await recordClaimEvent(client, context, claim.id, "claim.closed", `Closed: ${reason}`);
  return { id: claim.id, status: "closed", replayed: false };
}

// ---------------------------------------------------------------- read

function claimView(row, credited) {
  const accepted = decimal(row.accepted_amount);
  return {
    id: row.id, claimNumber: row.claim_number, status: row.status, statusLabel: CLAIM_STATUS_LABELS[row.status], supplierId: row.supplier_id,
    supplierName: row.supplier_snapshot?.supplierName ?? row.supplier_name ?? null, supplier: row.supplier_snapshot, currencyCode: row.currency_code.trim(), issueDate: dayOf(row.issue_date),
    reason: row.reason, claimedAmount: dec(row.claimed_amount), acceptedAmount: dec(row.accepted_amount), disputedAmount: dec(row.rejected_amount), supplierReference: row.supplier_reference,
    purchaseReturnId: row.purchase_return_id, notes: row.notes, issuedAt: row.issued_at, closedAt: row.closed_at, closeReason: row.close_reason, version: Number(row.version),
    creditedAmount: dec(credited?.posted ?? 0n), creditPending: dec(credited ? sub(credited.live, credited.posted) : 0n),
    remainingToCredit: dec(CREDITABLE.includes(row.status) && credited && sub(accepted, credited.live) > CLAIM_ROUNDING ? sub(accepted, credited.live) : 0n),
  };
}

// getSupplierDebitClaim: the claim with its lines, the supplier's responses, the credits that resolve it and its history.
export async function getSupplierDebitClaim(client, context, claimId) {
  const claim = await loadClaim(client, context, claimId);
  const organizationId = context.organizationId;
  const lines = await client.query(`SELECT line.*, bill.bill_number, bill_line.sequence AS bill_line_sequence FROM tenant.supplier_debit_claim_lines line
        LEFT JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = line.organization_id AND bill.id = line.supplier_bill_id
        LEFT JOIN tenant.accounting_vendor_bill_lines bill_line ON bill_line.organization_id = line.organization_id AND bill_line.id = line.supplier_bill_line_id
       WHERE line.organization_id = $1 AND line.claim_id = $2 ORDER BY line.line_number`, [organizationId, claim.id]);
  const responses = await client.query(`SELECT response.*, account.full_name AS recorded_by_name FROM tenant.supplier_debit_claim_responses response
        LEFT JOIN public.users account ON account.id = response.recorded_by WHERE response.organization_id = $1 AND response.claim_id = $2 ORDER BY response.recorded_at`, [organizationId, claim.id]);
  const events = await client.query(`SELECT event.*, account.full_name AS actor_name FROM tenant.supplier_debit_claim_events event LEFT JOIN public.users account ON account.id = event.actor_user_id
       WHERE event.organization_id = $1 AND event.claim_id = $2 ORDER BY event.occurred_at, event.id`, [organizationId, claim.id]);
  const credits = await client.query(`SELECT id, bill_number, status, grand_total, outstanding_amount, bill_date FROM tenant.accounting_vendor_bills WHERE organization_id = $1 AND debit_claim_id = $2
       AND bill_type = 'credit_note' ORDER BY created_at`, [organizationId, claim.id]);
  const credited = await claimCredited(client, organizationId, claim.id);

  const view = claimView(claim, credited);
  const manage = can(context, VC_PERMISSIONS.claimsManage);
  return {
    claim: view,
    lines: lines.rows.map((line) => ({ id: line.id, lineNumber: line.line_number, billId: line.supplier_bill_id, billNumber: line.bill_number, billLineId: line.supplier_bill_line_id,
      billLineSequence: line.bill_line_sequence, purchaseReturnLineId: line.purchase_return_line_id, reason: line.reason, reasonLabel: REASON_LABELS[line.reason] ?? line.reason,
      description: line.description, basis: line.basis, quantity: dec(line.quantity), unitValue: dec(line.unit_value), amount: dec(line.amount), taxAmount: dec(line.tax_amount),
      total: dec(line.total), notes: line.notes })),
    responses: responses.rows.map((entry) => ({ id: entry.id, decision: entry.decision, acceptedAmount: dec(entry.accepted_amount), disputedAmount: dec(entry.rejected_amount),
      supplierReference: entry.supplier_reference, respondedOn: dayOf(entry.responded_on), notes: entry.notes, recordedBy: entry.recorded_by_name, recordedAt: entry.recorded_at })),
    credits: credits.rows.map((entry) => ({ id: entry.id, number: entry.bill_number, status: entry.status, total: dec(entry.grand_total), date: dayOf(entry.bill_date),
      href: `/procurement/debit-notes-credits/vendor-credits/${entry.id}` })),
    history: events.rows.map((entry) => ({ id: entry.id, type: entry.event_type, summary: entry.summary, actor: entry.actor_name, at: entry.occurred_at })),
    actions: {
      edit: manage && claim.status === "draft", issue: manage && claim.status === "draft",
      respond: can(context, VC_PERMISSIONS.claimsRespond) && OPEN_FOR_RESPONSE.includes(claim.status),
      createCredit: can(context, VC_PERMISSIONS.creditsManage) && CREDITABLE.includes(claim.status) && decimal(view.remainingToCredit) > 0n,
      close: manage && !["closed", "resolved"].includes(claim.status),
      pdf: true,
    },
  };
}

// getSupplierDebitClaims. filters: { supplierId?, status?, search?, view?, from?, to?, limit? }
export async function getSupplierDebitClaims(client, context, filters = {}) {
  requireClaimView(context);
  const values = [context.organizationId];
  let where = "";
  const push = (value) => { values.push(value); return `$${values.length}`; };
  if (filters.supplierId) where += ` AND claim.supplier_id = ${push(requireUuid(filters.supplierId, "Supplier"))}`;
  if (filters.status) where += ` AND claim.status = ${push(String(filters.status))}`;
  if (filters.view === "awaiting_response") where += " AND claim.status = 'issued'";
  if (filters.view === "accepted_open") where += " AND claim.status IN ('accepted', 'partially_accepted')";
  if (filters.view === "claims_draft") where += " AND claim.status = 'draft'";
  if (filters.view === "claims_issued") where += " AND claim.status <> 'draft' AND claim.status <> 'closed'";
  if (filters.view === "claims_closed") where += " AND claim.status IN ('rejected', 'resolved', 'closed')";
  if (filters.from) where += ` AND claim.issue_date >= ${push(readDate(filters.from, "From"))}`;
  if (filters.to) where += ` AND claim.issue_date <= ${push(readDate(filters.to, "To"))}`;
  if (filters.search) where += ` AND (claim.claim_number ILIKE ${push(`%${String(filters.search).trim()}%`)} OR claim.supplier_snapshot->>'supplierName' ILIKE $${values.length}
    OR claim.supplier_reference ILIKE $${values.length})`;
  const { rows } = await client.query(
    `SELECT claim.*, COALESCE((SELECT sum(grand_total) FROM tenant.accounting_vendor_bills credit WHERE credit.organization_id = claim.organization_id AND credit.debit_claim_id = claim.id
         AND credit.bill_type = 'credit_note' AND credit.status IN ${POSTED_SQL}), 0) AS credited_posted,
       COALESCE((SELECT sum(grand_total) FROM tenant.accounting_vendor_bills credit WHERE credit.organization_id = claim.organization_id AND credit.debit_claim_id = claim.id
         AND credit.bill_type = 'credit_note' AND credit.status ${LIVE_SQL}), 0) AS credited_live
       FROM tenant.supplier_debit_claims claim WHERE claim.organization_id = $1${where} ORDER BY claim.issue_date DESC, claim.created_at DESC LIMIT ${Math.min(Number(filters.limit) || 200, 500)}`,
    values);
  return rows.map((row) => claimView(row, { posted: decimal(row.credited_posted), live: decimal(row.credited_live) }));
}

// getOpenSupplierClaims: what is still to be credited — issued and awaiting the supplier, or accepted and not yet fully credited.
export async function getOpenSupplierClaims(client, context, filters = {}) {
  const claims = await getSupplierDebitClaims(client, context, filters);
  return claims.filter((claim) => claim.status === "issued" || (CREDITABLE.includes(claim.status) && decimal(claim.remainingToCredit) > 0n));
}
