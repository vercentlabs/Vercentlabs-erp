// Assets — Purchase Invoice-to-Asset Creation, capacity and commands. Each invoice line's registerable quantity is the lesser of what was
// invoiced and what was received (net of returns) where a receipt is required, less what is already registered through the invoice, its
// receipt or its purchase order line. A registration request is one idempotent operation over one invoice: each line registers on its own
// through the Register's shared registration (one asset per unit, the invoice line its acquisition source), the rest still register when
// one line needs work, and eligible assets can be handed to Finance's capitalization in the same step. Nothing here posts.
import { normalizeIdentifier } from "../asset-identification/ident-rules.js";
import { has, text, uuid } from "../common.js";
import { ELIGIBLE_BILL, INV, dayOfDb, invError, seesInvoiceCost } from "./inv-rules.js";

const idOf = (v, label, code = "ASSET_INVOICE_NOT_ELIGIBLE") => { try { return uuid(v, label); } catch { throw invError(404, code); } };
export async function loadInvoice(client, c, invoiceId) {
  const id = idOf(invoiceId, "Invoice", "ASSET_INVOICE_COMPANY_MISMATCH");
  const bill = (await client.query(`SELECT bill.*, party.display_name AS supplier_name, to_char(bill.bill_date, 'YYYY-MM-DD') AS bill_day FROM tenant.accounting_vendor_bills bill
      LEFT JOIN tenant.business_parties party ON party.id = bill.party_id WHERE bill.organization_id = $1 AND bill.id = $2`, [c.organizationId, id])).rows[0];
  if (!bill) throw invError(404, "ASSET_INVOICE_COMPANY_MISMATCH");
  return bill;
}
export function invoiceBlock(bill) {
  if (bill.bill_type !== "bill") return "Only a supplier invoice creates assets (not a credit or debit note).";
  if (["cancelled", "reversed"].includes(bill.status)) return `This invoice is ${bill.status}; it cannot create assets.`;
  if (!ELIGIBLE_BILL.includes(bill.status)) return "Finance has not approved this invoice yet.";
  return null;
}
// One line's registration capacity, with the reason it cannot be used (if any).
export async function lineCapacity(client, c, line, { unitsPerQuantity = 1 } = {}) {
  const invoiced = Number(line.invoiced_quantity ?? line.quantity ?? 0);
  const kind = line.product_type ?? "non_stock";
  let received = null;
  let receiptRequired = false;
  let returned = 0;
  if (line.purchase_order_line_id && kind !== "service") {
    receiptRequired = true;
    const p = (await client.query(`SELECT accepted_quantity, returned_quantity FROM tenant.purchase_order_line_progress WHERE organization_id = $1 AND purchase_order_line_id = $2`,
      [c.organizationId, line.purchase_order_line_id]).catch(() => ({ rows: [] }))).rows[0];
    returned = Number(p?.returned_quantity ?? 0);
    received = Math.max(0, Number(p?.accepted_quantity ?? 0) - returned);
  } else if (line.goods_receipt_line_id && kind !== "service") {
    receiptRequired = true;
    const g = (await client.query(`SELECT COALESCE(gl.accepted_quantity, gl.base_quantity, 0) AS q FROM tenant.goods_receipt_lines gl JOIN tenant.goods_receipts g ON g.id = gl.goods_receipt_id
        WHERE gl.organization_id = $1 AND gl.id = $2 AND g.status = 'posted'`, [c.organizationId, line.goods_receipt_line_id])).rows[0];
    received = Number(g?.q ?? 0);
  }
  // Already registered: on this line, and on the purchase order line it belongs to (its receipt registered the same units).
  const lineClaims = Number((await client.query(`SELECT COALESCE(sum(allocated_quantity), 0) AS n FROM tenant.asset_acquisition_allocations WHERE organization_id = $1 AND status = 'ACTIVE' AND source_line_id = $2`, [c.organizationId, line.id])).rows[0].n);
  const rootClaims = line.purchase_order_line_id ? Number((await client.query(`SELECT COALESCE(sum(allocated_quantity), 0) AS n FROM tenant.asset_acquisition_allocations WHERE organization_id = $1 AND status = 'ACTIVE'
      AND (root_po_line_id = $2 OR source_line_id = $2)`, [c.organizationId, line.purchase_order_line_id])).rows[0].n) : lineClaims;
  const registered = Math.max(lineClaims, rootClaims);
  let remaining = invoiced - lineClaims;
  if (line.purchase_order_line_id) remaining = Math.min(remaining, invoiced - rootClaims);
  if (receiptRequired) remaining = Math.min(remaining, (received ?? 0) - rootClaims);
  remaining = Math.max(0, Math.round(remaining * 10000) / 10000);
  const units = Math.floor(remaining * unitsPerQuantity + 1e-9);
  let reason = null;
  let code = null;
  if (kind === "stock") { code = "ASSET_INVOICE_LINE_NOT_ELIGIBLE"; reason = "A stock item is valued in Inventory: issue it to assets through an authorized stock issue, so the value is never in both."; }
  else if (units < 1 && registered >= invoiced - 1e-9) { code = "ASSET_INVOICE_ALREADY_REGISTERED"; reason = "Every unit on this line is already registered."; }
  else if (units < 1 && receiptRequired) { code = "ASSET_INVOICE_NOT_RECEIVED"; reason = received ? "The received units are already registered; the rest have not been received." : "Nothing on this line has been received yet."; }
  else if (units < 1) { code = "ASSET_INVOICE_ALREADY_REGISTERED"; reason = "Nothing left to register."; }
  return { invoiced, received, returned, receiptRequired, registered, remaining, units, kind, suggested: kind !== "service" && kind !== "stock", serviceReview: kind === "service", code, reason };
}

// ------------------------------------------------------------------ validation
async function linesOf(client, bill) {
  return (await client.query(`SELECT line.*, uom.code AS uom_code FROM tenant.accounting_vendor_bill_lines line LEFT JOIN tenant.units_of_measure uom ON uom.id = line.uom_id WHERE line.vendor_bill_id = $1 ORDER BY line.sequence`, [bill.id])).rows;
}
// input lines: [{ sourceLineId, quantity, unitsPerQuantity?, categoryId, name?, manufacturer?, model?, tracking?, eligibilityReason?, receiptEvidence?, locationId?, departmentId?, custodianUserId?,
//   units?: [{ serialNumber?, tagCode?, locationId?, departmentId?, custodianUserId? }] }]
async function checkLines(client, c, bill, requested) {
  const all = await linesOf(client, bill);
  const byId = new Map(all.map((l) => [l.id, l]));
  const serialsSeen = new Map();
  const out = [];
  for (const [i, r] of (Array.isArray(requested) ? requested : []).entries()) {
    const errors = [];
    const warnings = [];
    const line = byId.get(String(r.sourceLineId ?? ""));
    if (!line) { out.push({ index: i, sourceLineId: r.sourceLineId, errors: [{ code: "ASSET_INVOICE_LINE_NOT_ELIGIBLE", message: "That line is not on this invoice." }], warnings }); continue; }
    const factor = r.unitsPerQuantity === undefined || r.unitsPerQuantity === null || r.unitsPerQuantity === "" ? 1 : Number(r.unitsPerQuantity);
    if (!Number.isInteger(factor) || factor < 1 || factor > 10000) errors.push({ code: "ASSET_INVOICE_INVALID", message: "Units per invoice quantity must be a whole number of 1 or more." });
    const cap = await lineCapacity(client, c, line, { unitsPerQuantity: Number.isInteger(factor) && factor > 0 ? factor : 1 });
    const qty = Number(r.quantity);
    if (cap.code) errors.push({ code: cap.code, message: cap.reason });
    if (cap.serviceReview && text(r.eligibilityReason, 500).length < 3) errors.push({ code: "ASSET_INVOICE_LINE_NOT_ELIGIBLE", message: "A service line becomes an asset only when it is genuinely an identifiable asset: give the reason (otherwise allocate it as an additional cost)." });
    if (!Number.isInteger(qty) || qty < 1) errors.push({ code: "ASSET_INVOICE_INVALID", message: "Enter how many assets to register." });
    else if (qty > cap.units) errors.push({ code: "ASSET_INVOICE_QUANTITY_EXCEEDED", message: `Only ${cap.units} unit(s) can still be registered from this line.` });
    if (!cap.receiptRequired && !line.purchase_order_line_id && text(r.receiptEvidence, 500).length < 3) errors.push({ code: "ASSET_INVOICE_NOT_RECEIVED", message: "A direct purchase without a purchase order needs its receipt evidence (who received it, when)." });
    const category = r.categoryId ? (await client.query(`SELECT * FROM tenant.asset_categories WHERE organization_id = $1 AND id = $2 AND active AND deleted_at IS NULL`, [c.organizationId, String(r.categoryId).match(/^[0-9a-f-]{36}$/i) ? r.categoryId : null])).rows[0] : null;
    if (!category) errors.push({ code: "ASSET_INVOICE_CATEGORY_INVALID", message: "Select a valid Asset Category." });
    const units = Array.isArray(r.units) ? r.units : [];
    if (units.length && units.length !== qty) errors.push({ code: "ASSET_INVOICE_INVALID", message: `Give the details of each of the ${qty} unit(s), or none to use the common values.` });
    if (category?.serial_number_policy === "REQUIRED" && (units.length !== qty || units.some((u) => !text(u.serialNumber, 120)))) errors.push({ code: "ASSET_INVOICE_SERIAL_DUPLICATE", message: `${category.name} requires each unit's manufacturer serial number.` });
    if (category?.location_required && !r.locationId && units.some((u) => !u.locationId)) errors.push({ code: "ASSET_INVOICE_INVALID", message: `${category.name} requires each asset's location.` });
    for (const [k, u] of units.entries()) {
      const key = normalizeIdentifier(u.serialNumber);
      if (!key) continue;
      if (serialsSeen.has(key)) errors.push({ code: "ASSET_INVOICE_SERIAL_DUPLICATE", message: `Serial ${u.serialNumber} is entered twice.` });
      serialsSeen.set(key, `${i}:${k}`);
      const taken = (await client.query(`SELECT asset_number, manufacturer FROM tenant.assets WHERE organization_id = $1 AND serial_normalized = $2 AND archived_at IS NULL LIMIT 1`, [c.organizationId, key])).rows[0];
      if (taken && (!r.manufacturer || !taken.manufacturer || normalizeIdentifier(taken.manufacturer) === normalizeIdentifier(r.manufacturer))) errors.push({ code: "ASSET_INVOICE_SERIAL_DUPLICATE", message: `Serial ${u.serialNumber} already belongs to ${taken.asset_number}.` });
    }
    const unitCost = cap.invoiced > 0 && seesInvoiceCost(c) ? (Math.round((Number(line.net_amount) / (cap.invoiced * (Number.isInteger(factor) && factor > 0 ? factor : 1))) * 100) / 100).toFixed(2) : undefined;
    if (Number(line.tax_amount) > 0) warnings.push({ code: "TAX", message: "Recoverable GST is excluded from the asset cost; Finance decides any nonrecoverable tax." });
    if (Number(line.line_discount_amount ?? 0) > 0 || Number(line.allocated_document_discount ?? 0) > 0) warnings.push({ code: "DISCOUNT", message: "The line's discounts (and its share of the invoice discount) are already in its net amount." });
    out.push({ index: i, sourceLineId: line.id, description: line.description, quantity: qty, unitsPerQuantity: factor, capacity: cap, categoryId: category?.id ?? null, category, line, unitCost,
      allocation: unitCost !== undefined && Number.isInteger(qty) ? (Math.round(Number(unitCost) * qty * 100) / 100).toFixed(2) : undefined, errors, warnings });
  }
  return out;
}
export async function previewAssetsFromInvoice(client, c, input = {}) {
  if (!has(c, INV.create) && !has(c, INV.bulk) && !has(c, INV.view)) throw invError(403, "ASSET_INVOICE_PERMISSION_DENIED");
  const bill = await loadInvoice(client, c, input.invoiceId);
  const block = invoiceBlock(bill);
  const lines = await checkLines(client, c, bill, input.lines);
  return { invoiceId: bill.id, invoice: bill.bill_number, eligible: !block, block, ready: !block && lines.length > 0 && lines.every((l) => !l.errors.length),
    lines: lines.map((l) => ({ index: l.index, sourceLineId: l.sourceLineId, description: l.description, quantity: l.quantity, remainingUnits: l.capacity?.units ?? 0, remainingAfter: l.capacity ? Math.max(0, l.capacity.units - (l.quantity || 0)) : 0,
      unitCost: l.unitCost, allocation: l.allocation, errors: l.errors, warnings: l.warnings })) };
}

// ------------------------------------------------------------------ registration
// input: { invoiceId, idempotencyKey, lines: [...], commission?: { availableForUseDate }, requestCapitalization?: boolean, capitalizationDate? }
export async function createAssetsFromInvoice(client, c, input = {}) {
  if (!has(c, INV.create) && !has(c, INV.bulk)) throw invError(403, "ASSET_INVOICE_PERMISSION_DENIED");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw invError(400, "ASSET_INVOICE_INVALID", "A registration key is required so a retry cannot create the assets twice.");
  const done = (await client.query(`SELECT * FROM tenant.asset_invoice_registration_batches WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
  if (done) {
    if (done.status === "PROCESSING" || done.status === "RECOVERY_REQUIRED") throw invError(409, "ASSET_INVOICE_OUTCOME_UNKNOWN");
    return { ...batchView(done), replayed: true };
  }
  const bill = await loadInvoice(client, c, input.invoiceId);
  await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`asset-invoice:${bill.id}`]);
  const block = invoiceBlock(bill);
  if (block) throw invError(409, "ASSET_INVOICE_NOT_ELIGIBLE", block);
  const requested = Array.isArray(input.lines) ? input.lines : [];
  if (!requested.length || requested.length > 100) throw invError(400, "ASSET_INVOICE_INVALID", "Choose the invoice lines to register.");
  const totalUnits = requested.reduce((t, r) => t + (Number(r.quantity) || 0), 0);
  if ((requested.length > 1 || totalUnits > 1) && !has(c, INV.bulk)) throw invError(403, "ASSET_INVOICE_PERMISSION_DENIED", "Registering several assets at once needs the bulk permission.");
  if (totalUnits > 500) throw invError(400, "ASSET_INVOICE_INVALID", "Register at most 500 assets at once.");
  const checked = await checkLines(client, c, bill, requested);
  // Nothing in the request can be registered: refused as a whole, nothing recorded.
  if (checked.every((l) => l.errors.length)) { const e = checked[0].errors[0]; throw invError(e.code === "ASSET_INVOICE_INVALID" ? 400 : 409, e.code, e.message, { lines: checked.map((l) => ({ sourceLineId: l.sourceLineId, errors: l.errors })) }); }
  const batch = (await client.query(`INSERT INTO tenant.asset_invoice_registration_batches (organization_id, vendor_bill_id, idempotency_key, request, requested_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [c.organizationId, bill.id, key, JSON.stringify({ lines: requested.map((r) => ({ sourceLineId: r.sourceLineId, quantity: r.quantity, categoryId: r.categoryId })), requestCapitalization: Boolean(input.requestCapitalization) }), c.userId])).rows[0];
  const { registerAssetsFromSource, transitionAsset } = await import("../asset-register/register-commands.js");
  // The Register's shared registration does the work: the invoice permission stands in for its own.
  const reg = { ...c, permissions: [...new Set([...(c.permissions ?? []), "assets.acquisition.register"])] };
  const lineResults = [];
  const created = [];
  for (const [i, l] of checked.entries()) {
    const r = requested[i];
    let result = { sourceLineId: l.sourceLineId, description: l.description, requested: Number(r.quantity) || 0, registered: 0, status: "FAILED", errors: l.errors, assets: [] };
    if (!l.errors.length) {
      await client.query("SAVEPOINT invoice_line");
      try {
        const units = (Array.isArray(r.units) && r.units.length ? r.units : Array.from({ length: l.quantity }, () => ({}))).map((u) => ({
          serialNumber: u.serialNumber || undefined, tagCode: u.tagCode || undefined, locationId: u.locationId || r.locationId || undefined, departmentId: u.departmentId || r.departmentId || undefined,
          custodianUserId: u.custodianUserId || r.custodianUserId || undefined }));
        const made = await registerAssetsFromSource(client, reg, { sourceType: "SUPPLIER_INVOICE_LINE", sourceLineId: l.sourceLineId, name: text(r.name, 200) || l.description, categoryId: l.categoryId,
          capitalizationClass: r.tracking === "TRACKED_ONLY" ? "TRACKED_ONLY" : "PENDING", manufacturer: r.manufacturer || undefined, model: r.model || undefined, purchaseDate: bill.bill_day ?? undefined,
          units, unitsPerQuantity: l.unitsPerQuantity > 1 ? l.unitsPerQuantity : undefined, idempotencyKey: `${key}:line:${i + 1}` });
        if (input.commission?.availableForUseDate) {
          for (const x of made.created) await transitionAsset(client, reg, x.assetId, "activate", { availableForUseDate: input.commission.availableForUseDate });
        }
        await client.query("RELEASE SAVEPOINT invoice_line");
        result = { ...result, registered: made.created.length, status: "REGISTERED", errors: [], assets: made.created.map((x) => x.assetId), registrationBatchId: made.batchId };
        for (const x of made.created) created.push({ assetId: x.assetId, assetNumber: x.assetNumber, sourceLineId: l.sourceLineId, tracking: r.tracking === "TRACKED_ONLY" ? "TRACKED_ONLY" : "PENDING" });
      } catch (failure) {
        await client.query("ROLLBACK TO SAVEPOINT invoice_line");
        result = { ...result, errors: [...(failure.details?.units ?? []).flatMap((u) => u.errors.map((m) => ({ code: failure.code, message: `Unit ${u.unit}: ${m}` }))),
          ...(failure.details?.units ? [] : [{ code: failure.code === "ASSET_SOURCE_ALREADY_ALLOCATED" ? "ASSET_INVOICE_QUANTITY_EXCEEDED" : failure.code ?? "ASSET_INVOICE_INVALID", message: failure.message }])] };
      }
    }
    if (l.line) await client.query(`INSERT INTO tenant.asset_invoice_registration_lines (organization_id, batch_id, source_line_id, requested_quantity, registered_quantity, units_per_quantity, category_id, registration_batch_id, status,
        eligibility_reason, receipt_evidence, validation, asset_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [c.organizationId, batch.id, l.line.id, Math.max(1, result.requested), result.registered, Number.isInteger(l.unitsPerQuantity) && l.unitsPerQuantity > 0 ? l.unitsPerQuantity : 1, l.categoryId,
        result.registrationBatchId ?? null, result.status, text(r.eligibilityReason, 500) || null, text(r.receiptEvidence, 500) || null, JSON.stringify(result.errors), JSON.stringify(result.assets)]);
    lineResults.push(result);
  }
  // Finance's capitalization: each fixed asset gets its request now if its cost is ready; otherwise it waits as cost pending.
  const outcomes = [];
  const canRequest = input.requestCapitalization && has(c, "assets.capitalization.request");
  for (const a of created) {
    let outcome = a.tracking === "TRACKED_ONLY" ? "TRACKED_ONLY" : "REGISTERED_COST_PENDING";
    let note = null;
    if (canRequest && a.tracking !== "TRACKED_ONLY") {
      await client.query("SAVEPOINT invoice_cap");
      try {
        const { requestCapitalization } = await import("../asset-capitalization/cap-commands.js");
        await requestCapitalization(client, c, { assetId: a.assetId, capitalizationDate: dayOfDb(input.capitalizationDate) ?? undefined, note: `From invoice ${bill.bill_number}` });
        await client.query("RELEASE SAVEPOINT invoice_cap");
        outcome = "REGISTERED_CAPITALIZATION_PENDING";
      } catch (failure) { await client.query("ROLLBACK TO SAVEPOINT invoice_cap"); note = failure.message; }
    }
    outcomes.push({ ...a, outcome, note });
  }
  const ok = lineResults.filter((r) => r.status === "REGISTERED").length;
  const status = ok === lineResults.length ? "COMPLETED" : ok > 0 ? "PARTIAL" : "FAILED";
  const result = { lines: lineResults, assets: outcomes };
  const final = (await client.query(`UPDATE tenant.asset_invoice_registration_batches SET status = $2, result = $3, assets_created = $4, completed_at = clock_timestamp() WHERE id = $1 RETURNING *`,
    [batch.id, status, JSON.stringify(result), created.length])).rows[0];
  const { logCapEvent } = await import("../asset-capitalization/cap-commands.js");
  await logCapEvent(client, c, "INVOICE_REGISTERED", {}, { invoice: bill.bill_number, batch: `AIR-${batch.batch_number}`, created: created.length, status });
  return { ...batchView(final), code: status === "PARTIAL" ? "ASSET_INVOICE_PARTIAL_COMPLETION" : undefined };
}
export const batchView = (b) => ({ batchId: b.id, number: `AIR-${b.batch_number}`, invoiceId: b.vendor_bill_id, status: b.status, assetsCreated: b.assets_created, lines: b.result?.lines ?? [], assets: b.result?.assets ?? [],
  createdAt: b.created_at, completedAt: b.completed_at });
