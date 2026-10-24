// Rate contracts (Procurement plan Phase 3): a supplier's agreed rate for items over a period, optionally capped by quantity or value. An
// order line for a contracted item (same supplier, item and unit, on a date the contract covers) is priced at the contract rate and records
// the contract line it draws from; what each line has drawn is read from those order lines (orders not cancelled), never stored twice.
// Items on an active contract need no RFQ. Contracts ending within 30 days show on the overview.
//
//   draft → active → (expired, by date)        cancelled at any time before it ends, with a reason
//
// Activating follows the company's approval rules for rate contracts (Settings › Approval rules), on the contract's value (each line's
// value cap, else rate × quantity cap): until every level approved this exact content, Activate asks for the next approval and the contract
// stays a draft. Every step is kept in the contract's history.
import { oneOffView, readOneOffLine } from "../purchase-orders/one-off-lines.js";
import { createHash } from "node:crypto";
import { add, decimal, formatDecimal, mul, roundMoney, sub } from "../../../core/decimal.js";
import { requireRuleApprovals } from "../../../core/platform/approvals/index.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { normalizeQuantityToBase } from "../../products/uom.js";
import { assertSupplierUsable } from "../suppliers/defaults.js";
import { poCan, requirePoAccess, requirePoPermission } from "../purchase-orders/access.js";
import { PO_PERMISSIONS, PurchaseOrderError, dayOf, fail, isUuid, optionalUuid, readDate, requireUuid, text } from "../purchase-orders/constants.js";
import { translated } from "../purchase-orders/document.js";
import { databaseToday } from "../org-day.js";
import { pagedList } from "../paging.js";

export const PURCHASE_RATE_CONTRACT_VIEWS = Object.freeze([
  { key: "active", label: "Active" }, { key: "expiring", label: "Ending in 30 days" }, { key: "draft", label: "Draft" }, { key: "ended", label: "Ended" }, { key: "all", label: "All" },
]);
const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const today = (client, context) => databaseToday(client, context.organizationId);
export const RATE_CONTRACT_APPROVAL = "procurement.rate_contract";

async function recordContractEvent(client, context, contractId, eventType, summary, details = {}) {
  await client.query(`INSERT INTO tenant.purchase_rate_contract_events (organization_id, contract_id, event_type, summary, details, actor_user_id) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [context.organizationId, contractId, eventType, summary, JSON.stringify(details), context.userId ?? null]);
}

// What an approval is for (supplier, period, currency and every line), and the value the approval rules look at.
export async function rateContractApprovalContent(client, organizationId, contract) {
  const lines = (await client.query(`SELECT item_id, uom_id, rate, max_quantity, max_value FROM tenant.purchase_rate_contract_lines WHERE organization_id = $1 AND contract_id = $2 ORDER BY line_number`,
    [organizationId, contract.id])).rows;
  const value = lines.reduce((sum, line) => add(sum, line.max_value !== null ? decimal(line.max_value) : line.max_quantity !== null ? mul(decimal(line.rate), decimal(line.max_quantity)) : 0n), 0n);
  const content = JSON.stringify([contract.supplier_id, dayOf(contract.valid_from), dayOf(contract.valid_to), String(contract.currency_code).trim(),
    lines.map((line) => [line.item_id, line.uom_id, String(line.rate), line.max_quantity === null ? null : String(line.max_quantity), line.max_value === null ? null : String(line.max_value)])]);
  return { amount: formatDecimal(roundMoney(value, 2)), contentKey: createHash("sha256").update(content).digest("hex").slice(0, 24) };
}
// The status a person sees: an active contract past its end date has ended.
const STATUS_SQL = (alias, day) => `CASE WHEN ${alias}.status = 'active' AND ${alias}.valid_to < ${day} THEN 'expired' WHEN ${alias}.status = 'active' AND ${alias}.valid_from > ${day} THEN 'scheduled'
  ELSE ${alias}.status END`;
export const PURCHASE_RATE_CONTRACT_STATUS_LABELS = Object.freeze({ draft: "Draft", active: "Active", scheduled: "Starts later", expired: "Ended", cancelled: "Cancelled" });
const DRAWN_SQL = `(SELECT COALESCE(sum(po_line.ordered_quantity), 0) FROM tenant.purchase_order_lines po_line JOIN tenant.purchase_orders po ON po.organization_id = po_line.organization_id
    AND po.id = po_line.purchase_order_id WHERE po_line.organization_id = line.organization_id AND po_line.source_rate_contract_line_id = line.id AND po.status <> 'cancelled')`;
const DRAWN_VALUE_SQL = `(SELECT COALESCE(sum(po_line.taxable_amount), 0) FROM tenant.purchase_order_lines po_line JOIN tenant.purchase_orders po ON po.organization_id = po_line.organization_id
    AND po.id = po_line.purchase_order_id WHERE po_line.organization_id = line.organization_id AND po_line.source_rate_contract_line_id = line.id AND po.status <> 'cancelled')`;

// filters: view, supplierId, search (number, supplier, item), limit, offset.
export async function listPurchaseRateContracts(client, context, filters = {}) {
  requirePoAccess(context);
  const day = await today(client, context);
  const values = [context.organizationId, day];
  const bind = (value) => `$${values.push(value)}`;
  let where = "";
  const view = PURCHASE_RATE_CONTRACT_VIEWS.some((entry) => entry.key === filters.view) ? filters.view : "all";
  if (view === "active") where += " AND contract.status = 'active' AND contract.valid_to >= $2::date";
  else if (view === "expiring") where += " AND contract.status = 'active' AND contract.valid_to BETWEEN $2::date AND $2::date + 30";
  else if (view === "draft") where += " AND contract.status = 'draft'";
  else if (view === "ended") where += " AND (contract.status IN ('expired', 'cancelled') OR (contract.status = 'active' AND contract.valid_to < $2::date))";
  if (isUuid(filters.supplierId)) where += ` AND contract.supplier_id = ${bind(filters.supplierId)}`;
  const search = text(filters.search, 120);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (contract.contract_number ILIKE ${term} OR party.display_name ILIKE ${term} OR contract.supplier_reference ILIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.purchase_rate_contract_lines line LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
                  WHERE line.organization_id = contract.organization_id AND line.contract_id = contract.id AND (item.name ILIKE ${term} OR item.code ILIKE ${term} OR line.description ILIKE ${term})))`;
  }
  return pagedList(client,
    `SELECT contract.id, contract.contract_number, ${STATUS_SQL("contract", "$2::date")} AS status, contract.valid_from, contract.valid_to, contract.supplier_id, party.display_name AS supplier_name,
            btrim(contract.currency_code) AS currency_code, contract.supplier_reference,
            (SELECT string_agg(COALESCE(item.name, line.description), ', ' ORDER BY line.line_number) FROM tenant.purchase_rate_contract_lines line LEFT JOIN tenant.items item
              ON item.organization_id = line.organization_id AND item.id = line.item_id WHERE line.organization_id = contract.organization_id AND line.contract_id = contract.id) AS items
       FROM tenant.purchase_rate_contracts contract
       JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = contract.organization_id AND supplier.id = contract.supplier_id
       JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
      WHERE contract.organization_id = $1${where} ORDER BY contract.valid_to DESC, contract.created_at DESC`, values, filters, (row) => ({
    id: row.id, number: row.contract_number, status: row.status, statusLabel: PURCHASE_RATE_CONTRACT_STATUS_LABELS[row.status] ?? row.status, validFrom: dayOf(row.valid_from),
    validTo: dayOf(row.valid_to), supplierId: row.supplier_id, supplierName: row.supplier_name, currencyCode: row.currency_code, supplierReference: row.supplier_reference, items: row.items,
  }));
}

async function loadContract(client, context, contractId, { lock = false } = {}) {
  requirePoAccess(context);
  const row = (await client.query(`SELECT * FROM tenant.purchase_rate_contracts WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, requireUuid(contractId, "Rate contract")])).rows[0];
  if (!row) throw new PurchaseOrderError(404, "Rate contract not found.", "RATE_CONTRACT_NOT_FOUND");
  return row;
}

export async function getPurchaseRateContract(client, context, contractId) {
  const row = await loadContract(client, context, contractId);
  const day = await today(client, context);
  const status = (await client.query(`SELECT ${STATUS_SQL("contract", "$3::date")} AS status FROM tenant.purchase_rate_contracts contract WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, day])).rows[0].status;
  const supplier = (await client.query(`SELECT party.display_name FROM tenant.procurement_suppliers supplier JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id
     AND party.id = supplier.party_id WHERE supplier.organization_id = $1 AND supplier.id = $2`, [context.organizationId, row.supplier_id])).rows[0];
  const lines = (await client.query(
    `SELECT line.*, item.code AS item_code, COALESCE(item.name, line.description) AS item_name, uom.code AS uom_code, ${DRAWN_SQL} AS drawn_quantity, ${DRAWN_VALUE_SQL} AS drawn_value
       FROM tenant.purchase_rate_contract_lines line LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
      WHERE line.organization_id = $1 AND line.contract_id = $2 ORDER BY line.line_number`, [context.organizationId, row.id])).rows;
  const orders = (await client.query(
    `SELECT DISTINCT po.id, po.purchase_order_number, po.status, po.order_date FROM tenant.purchase_order_lines po_line
       JOIN tenant.purchase_orders po ON po.organization_id = po_line.organization_id AND po.id = po_line.purchase_order_id
       JOIN tenant.purchase_rate_contract_lines line ON line.organization_id = po_line.organization_id AND line.id = po_line.source_rate_contract_line_id
      WHERE line.organization_id = $1 AND line.contract_id = $2 ORDER BY po.order_date DESC`, [context.organizationId, row.id])).rows;
  const manage = poCan(context, PO_PERMISSIONS.create);
  const history = (await client.query(
    `SELECT event.event_type, event.summary, event.created_at, actor.full_name AS actor_name FROM tenant.purchase_rate_contract_events event
       LEFT JOIN public.users actor ON actor.id = event.actor_user_id WHERE event.organization_id = $1 AND event.contract_id = $2 ORDER BY event.created_at DESC`,
    [context.organizationId, row.id])).rows;
  const waiting = row.status === "draft" ? (await client.query(
    `SELECT request.approval_level FROM public.approval_requests request WHERE request.organization_id = $1 AND request.command_key = 'procurement.rate_contract.approve'
        AND request.entity_id = $2 AND request.status = 'pending' ORDER BY request.requested_at DESC LIMIT 1`, [context.organizationId, row.id])).rows[0] : null;
  return {
    history: history.map((event) => ({ type: event.event_type, summary: event.summary, at: event.created_at, by: event.actor_name })),
    waitingApproval: waiting ? { level: waiting.approval_level } : null,
    contract: { id: row.id, number: row.contract_number, status, statusLabel: PURCHASE_RATE_CONTRACT_STATUS_LABELS[status] ?? status, supplierId: row.supplier_id, supplierName: supplier?.display_name ?? null,
      validFrom: dayOf(row.valid_from), validTo: dayOf(row.valid_to), currencyCode: row.currency_code?.trim(), supplierReference: row.supplier_reference, notes: row.notes,
      activatedAt: row.activated_at, cancelReason: row.cancel_reason ?? null, cancelledAt: row.cancelled_at ?? null },
    lines: lines.map((line) => ({ id: line.id, lineNumber: line.line_number, productId: line.item_id, productCode: line.item_code, productName: line.item_name, uomId: line.uom_id,
      description: line.description ?? null, ...oneOffView(line),
      uomCode: line.uom_code, rate: dec(line.rate), maxQuantity: dec(line.max_quantity), maxValue: dec(line.max_value), drawnQuantity: dec(line.drawn_quantity),
      drawnValue: dec(roundMoney(decimal(line.drawn_value), 2)),
      remainingQuantity: line.max_quantity === null ? null : dec(sub(decimal(line.max_quantity), decimal(line.drawn_quantity))),
      remainingValue: line.max_value === null ? null : dec(roundMoney(sub(decimal(line.max_value), decimal(line.drawn_value)), 2)) })),
    orders: orders.map((order) => ({ id: order.id, number: order.purchase_order_number, status: order.status, date: dayOf(order.order_date), href: `/procurement/purchase-orders/${order.id}` })),
    actions: { edit: row.status === "draft" && manage, activate: row.status === "draft" && manage, cancel: ["draft", "active"].includes(row.status) && status !== "expired" && manage },
  };
}

async function readInput(client, context, input, current = null) {
  const supplierId = requireUuid(input.supplierId ?? current?.supplier_id, "Supplier");
  await translated(() => assertSupplierUsable(client, context.organizationId, supplierId, { purpose: "a rate contract" }));
  const validFrom = readDate(input.validFrom, "Valid from") ?? (current ? dayOf(current.valid_from) : null);
  const validTo = readDate(input.validTo, "Valid to") ?? (current ? dayOf(current.valid_to) : null);
  if (!validFrom || !validTo) fail("Enter the dates the contract covers.", "validFrom", "RATE_CONTRACT_DATES_REQUIRED");
  if (validTo < validFrom) fail("The contract ends before it starts.", "validTo", "RATE_CONTRACT_DATES_INVALID");
  const lines = Array.isArray(input.lines) ? input.lines : null;
  if (!current && (!lines || !lines.length)) fail("Add at least one item with its agreed rate.", "lines", "RATE_CONTRACT_NO_LINES");
  const parsed = [];
  const seen = new Set();
  for (const [index, line] of (lines ?? []).entries()) {
    const label = `Line ${index + 1}`;
    // A line outside the catalogue (an annual maintenance contract, a service): priced on order lines with the same description and unit.
    const oneOff = !line.productId && !line.itemId ? await readOneOffLine(client, context.organizationId, line, label) : null;
    const itemId = oneOff ? null : requireUuid(line.productId ?? line.itemId, `${label} item`);
    const item = oneOff ? null : (await client.query(`SELECT id, uom_id, purchase_uom_id, status FROM tenant.items WHERE organization_id = $1 AND id = $2`, [context.organizationId, itemId])).rows[0];
    if (!oneOff && (!item || item.status !== "active")) fail(`${label}: choose an active item.`, "productId", "RATE_CONTRACT_ITEM_INVALID", 409);
    const uomId = oneOff ? oneOff.uomId : optionalUuid(line.uomId, `${label} unit`) ?? item.purchase_uom_id ?? item.uom_id;
    const key = oneOff ? `one-off:${oneOff.description.toLowerCase()}:${uomId}` : `${itemId}:${uomId}`;
    if (seen.has(key)) fail(`${label}: this is on the contract twice in the same unit.`, "lines", "RATE_CONTRACT_LINE_DUPLICATE");
    seen.add(key);
    if (!oneOff) {
      const unit = await normalizeQuantityToBase(client, context.organizationId, item.id, uomId, decimal(1), { purpose: "purchase" });
      if (!unit.ok) fail(`${label}: ${unit.message}`, "uomId", "RATE_CONTRACT_UOM_INVALID");
    }
    const rate = String(line.rate ?? "").trim();
    if (!/^\d+(\.\d{1,6})?$/.test(rate)) fail(`${label}: enter the agreed rate.`, "rate", "RATE_CONTRACT_RATE_INVALID");
    const cap = (value, name) => {
      if (value === undefined || value === null || value === "") return null;
      const raw = String(value).trim();
      if (!/^\d+(\.\d{1,6})?$/.test(raw) || decimal(raw) <= 0n) fail(`${label}: the ${name} must be more than zero.`, name === "most quantity" ? "maxQuantity" : "maxValue");
      return raw;
    };
    parsed.push({ itemId, uomId, rate, maxQuantity: cap(line.maxQuantity, "most quantity"), maxValue: cap(line.maxValue, "most value"), description: oneOff?.description ?? null,
      oneOffType: oneOff?.oneOffType ?? null, expenseAccountId: oneOff?.expenseAccountId ?? null, taxCategoryId: oneOff?.taxCategoryId ?? null, noTax: Boolean(oneOff?.noTax) });
  }
  const currency = (await client.query(`SELECT default_currency FROM tenant.procurement_suppliers WHERE organization_id = $1 AND id = $2`, [context.organizationId, supplierId])).rows[0]?.default_currency;
  return { supplierId, validFrom, validTo, lines: lines ? parsed : null, currencyCode: String(input.currencyCode ?? current?.currency_code ?? currency ?? "INR").trim().slice(0, 3).toUpperCase(),
    supplierReference: input.supplierReference !== undefined ? text(input.supplierReference, 200) : current?.supplier_reference ?? null,
    notes: input.notes !== undefined ? text(input.notes, 4000) : current?.notes ?? null };
}

async function writeLines(client, context, contractId, lines) {
  await client.query(`DELETE FROM tenant.purchase_rate_contract_lines WHERE organization_id = $1 AND contract_id = $2`, [context.organizationId, contractId]);
  for (const [index, line] of lines.entries())
    await client.query(
      `INSERT INTO tenant.purchase_rate_contract_lines (organization_id, contract_id, line_number, item_id, uom_id, rate, max_quantity, max_value, description, one_off_type, expense_account_id,
         tax_category_id, one_off_no_tax) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [context.organizationId, contractId, index + 1, line.itemId, line.uomId, line.rate, line.maxQuantity, line.maxValue, line.description ?? null, line.oneOffType ?? null,
        line.expenseAccountId ?? null, line.taxCategoryId ?? null, Boolean(line.noTax)]);
}

// createPurchaseRateContract. input: { supplierId, validFrom, validTo, supplierReference?, notes?, currencyCode?, lines: [{ productId, uomId?, rate, maxQuantity?, maxValue? }], activate? }
export async function createPurchaseRateContract(client, context, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to record rate contracts.");
  const data = await readInput(client, context, input);
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "purchase_rate_contract" });
  const row = (await client.query(
    `INSERT INTO tenant.purchase_rate_contracts (organization_id, contract_number, supplier_id, valid_from, valid_to, currency_code, supplier_reference, notes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id, contract_number`,
    [context.organizationId, number, data.supplierId, data.validFrom, data.validTo, data.currencyCode, data.supplierReference, data.notes, context.userId ?? null])).rows[0];
  await writeLines(client, context, row.id, data.lines);
  await recordContractEvent(client, context, row.id, "created", `Recorded ${row.contract_number}`);
  const activated = input.activate ? await activatePurchaseRateContract(client, context, row.id) : null;
  return { id: row.id, number: row.contract_number, status: activated?.status ?? "draft", approvalRequired: Boolean(activated?.approvalRequired) };
}

export async function updatePurchaseRateContract(client, context, contractId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to change rate contracts.");
  const current = await loadContract(client, context, contractId, { lock: true });
  if (current.status !== "draft") throw new PurchaseOrderError(409, "Only a draft rate contract is changed. Cancel it and record a new one.", "RATE_CONTRACT_LOCKED");
  const data = await readInput(client, context, input, current);
  await client.query(`UPDATE tenant.purchase_rate_contracts SET supplier_id = $3, valid_from = $4, valid_to = $5, currency_code = $6, supplier_reference = $7, notes = $8, updated_by = $9,
      updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, current.id, data.supplierId, data.validFrom, data.validTo, data.currencyCode, data.supplierReference, data.notes, context.userId ?? null]);
  if (data.lines) await writeLines(client, context, current.id, data.lines);
  await recordContractEvent(client, context, current.id, "changed", "Draft changed");
  return { id: current.id };
}

// activatePurchaseRateContract: from now on, order lines for its items price at its rates. Two active contracts with the same supplier may not
// cover the same item and unit on the same day.
export async function activatePurchaseRateContract(client, context, contractId) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to activate rate contracts.");
  const current = await loadContract(client, context, contractId, { lock: true });
  if (current.status !== "draft") throw new PurchaseOrderError(409, "Only a draft rate contract is activated.", "RATE_CONTRACT_LOCKED");
  const clash = (await client.query(
    `SELECT other.contract_number, COALESCE(item.name, line.description) AS name FROM tenant.purchase_rate_contract_lines line
       JOIN tenant.purchase_rate_contract_lines other_line ON other_line.organization_id = line.organization_id
         AND (other_line.item_id = line.item_id OR (line.item_id IS NULL AND other_line.item_id IS NULL AND lower(btrim(other_line.description)) = lower(btrim(line.description))))
         AND other_line.uom_id IS NOT DISTINCT FROM line.uom_id AND other_line.contract_id <> line.contract_id
       JOIN tenant.purchase_rate_contracts other ON other.organization_id = other_line.organization_id AND other.id = other_line.contract_id AND other.status = 'active'
       LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      WHERE line.organization_id = $1 AND line.contract_id = $2 AND other.supplier_id = $3 AND other.valid_from <= $5::date AND other.valid_to >= $4::date LIMIT 1`,
    [context.organizationId, current.id, current.supplier_id, dayOf(current.valid_from), dayOf(current.valid_to)])).rows[0];
  if (clash) fail(`${clash.name} is already on rate contract ${clash.contract_number} with this supplier for these dates.`, "lines", "RATE_CONTRACT_OVERLAP", 409);
  const { amount, contentKey } = await rateContractApprovalContent(client, context.organizationId, current);
  const approval = await requireRuleApprovals(client, context, { documentType: RATE_CONTRACT_APPROVAL, documentId: current.id, amount, contentKey,
    title: `Rate contract ${current.contract_number} (${String(current.currency_code).trim()} ${amount})` });
  if (approval.required && !approval.approved) {
    await recordContractEvent(client, context, current.id, "approval_asked", `Sent for approval (level ${approval.pending.level}${approval.pending.approver ? `, ${approval.pending.approver}` : ""})`);
    return { id: current.id, status: "draft", approvalRequired: true, pendingApproval: approval.pending };
  }
  await client.query(`UPDATE tenant.purchase_rate_contracts SET status = 'active', activated_at = now(), activated_by = $3, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, current.id, context.userId ?? null]);
  await recordContractEvent(client, context, current.id, "activated", approval.required ? "Activated after approval" : "Activated");
  return { id: current.id, status: "active", approvalRequired: false };
}

// input: { reason } — kept on the contract and in its history.
export async function cancelPurchaseRateContract(client, context, contractId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to cancel rate contracts.");
  const current = await loadContract(client, context, contractId, { lock: true });
  if (!["draft", "active"].includes(current.status)) throw new PurchaseOrderError(409, "This rate contract has already ended.", "RATE_CONTRACT_LOCKED");
  const reason = text(input.reason, 500);
  if (!reason || reason.length < 3) fail("Give the reason for cancelling the contract.", "reason", "RATE_CONTRACT_REASON_REQUIRED");
  await client.query(`UPDATE tenant.purchase_rate_contracts SET status = 'cancelled', cancel_reason = $4, cancelled_at = now(), cancelled_by = $3, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, current.id, context.userId ?? null, reason]);
  await recordContractEvent(client, context, current.id, "cancelled", `Cancelled: ${reason}`);
  return { id: current.id, status: "cancelled" };
}

// The contract lines that price items for a supplier on a date, in the order's currency (a contract in another currency never prices it):
// Map(`${itemId}:${uomId}` → { lineId, rate, contractNumber, remainingQuantity, remainingValue }).
export async function contractRatesFor(client, organizationId, { supplierId, itemIds = null, date, currencyCode = null }) {
  if (!isUuid(supplierId)) return new Map();
  const rows = (await client.query(
    `SELECT line.id, line.item_id, line.uom_id, line.description, line.rate, line.max_quantity, line.max_value, contract.contract_number, contract.valid_to, ${DRAWN_SQL} AS drawn_quantity,
            ${DRAWN_VALUE_SQL} AS drawn_value
       FROM tenant.purchase_rate_contract_lines line JOIN tenant.purchase_rate_contracts contract ON contract.organization_id = line.organization_id AND contract.id = line.contract_id
      WHERE line.organization_id = $1 AND contract.supplier_id = $2 AND contract.status = 'active' AND contract.valid_from <= $3::date AND contract.valid_to >= $3::date
        AND ($4::uuid[] IS NULL OR line.item_id = ANY($4::uuid[]) OR line.item_id IS NULL) AND ($5::text IS NULL OR btrim(contract.currency_code) = $5)`,
    [organizationId, supplierId, date, itemIds, currencyCode ? String(currencyCode).trim().toUpperCase() : null])).rows;
  return new Map(rows.map((row) => [row.item_id ? `${row.item_id}:${row.uom_id}` : oneOffContractKey(row.description, row.uom_id), {
    lineId: row.id, rate: dec(row.rate), contractNumber: row.contract_number, validTo: dayOf(row.valid_to),
    remainingQuantity: row.max_quantity === null ? null : sub(decimal(row.max_quantity), decimal(row.drawn_quantity)),
    remainingValue: row.max_value === null ? null : sub(decimal(row.max_value), decimal(row.drawn_value)),
  }]));
}

// The key a one-off order line finds its contract line by: the same description (any case and spacing) and unit.
export const oneOffContractKey = (description, uomId) => `one-off:${String(description ?? "").trim().toLowerCase().replace(/\s+/g, " ")}:${uomId}`;

// Contract lines that are active today for any supplier, by item — for "no RFQ needed" hints.
export async function activeContractsByItem(client, organizationId, itemIds, date) {
  if (!itemIds.length) return new Map();
  const rows = (await client.query(
    `SELECT DISTINCT ON (line.item_id) line.item_id, line.rate, contract.contract_number, party.display_name AS supplier_name, contract.supplier_id
       FROM tenant.purchase_rate_contract_lines line JOIN tenant.purchase_rate_contracts contract ON contract.organization_id = line.organization_id AND contract.id = line.contract_id
       JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = contract.organization_id AND supplier.id = contract.supplier_id
       JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
      WHERE line.organization_id = $1 AND line.item_id IS NOT NULL AND line.item_id = ANY($2::uuid[]) AND contract.status = 'active' AND contract.valid_from <= $3::date AND contract.valid_to >= $3::date
      ORDER BY line.item_id, line.rate`, [organizationId, itemIds, date])).rows;
  return new Map(rows.map((row) => [row.item_id, { rate: dec(row.rate), contractNumber: row.contract_number, supplierName: row.supplier_name, supplierId: row.supplier_id }]));
}

// What an order line drawing on a contract exceeds (for a warning): its quantity or value against what the contract still allows.
export function contractOverdraw(contract, quantity, value) {
  const issues = [];
  if (contract.remainingQuantity !== null && decimal(quantity) > contract.remainingQuantity)
    issues.push(`only ${formatDecimal(contract.remainingQuantity)} is left on ${contract.contractNumber}`);
  if (contract.remainingValue !== null && decimal(value) > contract.remainingValue)
    issues.push(`only ${formatDecimal(roundMoney(contract.remainingValue, 2))} of value is left on ${contract.contractNumber}`);
  return issues;
}

