// RFQs (Procurement plan Phase 2): one request for prices sent to 2–5 suppliers, built blank or from approved indent lines; each supplier's
// answer is recorded as an ordinary supplier quotation linked to the RFQ (each quoted line to its RFQ line); the comparison puts them side
// by side — rate, GST, freight, landed rate, lead time, payment terms, the last price paid and the MSME flag — and the buyer awards each
// line (or the whole RFQ) to a supplier. Awarding opens one draft purchase order per supplier from its quotation's prices.
//
//   draft → sent → awarded          cancelled before award; closed when nothing will be bought
// RFQs are optional per company (Procurement Setup › Use RFQs).
import { purchaseWarningsFor } from "../warnings.js";
import { add, decimal, div, formatDecimal, mul, roundMoney, sub } from "../../../core/decimal.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { loadTaxContext, resolveLineTax } from "../../../core/tax/index.js";
import { normalizeQuantityToBase } from "../../products/uom.js";
import { assertSupplierUsable } from "../suppliers/defaults.js";
import { poCan, requirePoAccess, requirePoPermission } from "../purchase-orders/access.js";
import { PO_PERMISSIONS, PurchaseOrderError, STATUS, dayOf, fail, isUuid, optionalUuid, readDate, requireUuid, text } from "../purchase-orders/constants.js";
import { procurementSettings, resolveOrderDocument, translated } from "../purchase-orders/document.js";
import { insertOrder, recordPoEvent } from "../purchase-orders/persist.js";
import { createSupplierQuotation } from "../purchase-orders/quotations.js";
import { listIndentLinesToOrder } from "../indents/index.js";
import { databaseToday } from "../org-day.js";
import { oneOffOrderLine, oneOffView, readOneOffLine } from "../purchase-orders/one-off-lines.js";
import { pagedList } from "../paging.js";

export const RFQ_STATUS_LABELS = Object.freeze({ draft: "Draft", sent: "Sent", awarded: "Awarded", closed: "Closed", cancelled: "Cancelled" });
export const RFQ_VIEWS = Object.freeze([
  { key: "open", label: "Open" }, { key: "to_award", label: "To award" }, { key: "awarded", label: "Awarded" }, { key: "all", label: "All" },
]);
const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const RESPONDED_SQL = `(SELECT count(DISTINCT quotation.supplier_id) FROM tenant.supplier_quotations quotation WHERE quotation.organization_id = rfq.organization_id
    AND quotation.rfq_id = rfq.id AND quotation.status <> 'cancelled')`;

async function requireRfqsOn(client, context) {
  if (!(await procurementSettings(client, context.organizationId)).useRfqs)
    throw new PurchaseOrderError(409, "RFQs are turned off. Turn them on in Procurement Setup › Purchasing Rules.", "PURCHASE_RFQS_OFF");
}

// filters: view, search (number, title, supplier, item), limit, offset.
export async function listPurchaseRfqs(client, context, filters = {}) {
  requirePoAccess(context);
  const values = [context.organizationId];
  const bind = (value) => `$${values.push(value)}`;
  let where = "";
  const view = RFQ_VIEWS.some((entry) => entry.key === filters.view) ? filters.view : "all";
  if (view === "open") where += " AND rfq.status IN ('draft', 'sent')";
  else if (view === "to_award") where += ` AND rfq.status = 'sent' AND ${RESPONDED_SQL} > 0`;
  else if (view === "awarded") where += " AND rfq.status = 'awarded'";
  const search = text(filters.search, 120);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (rfq.rfq_number ILIKE ${term} OR rfq.title ILIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.purchase_rfq_suppliers invited JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = invited.organization_id AND supplier.id = invited.supplier_id
                   JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
                  WHERE invited.organization_id = rfq.organization_id AND invited.rfq_id = rfq.id AND party.display_name ILIKE ${term})
      OR EXISTS (SELECT 1 FROM tenant.purchase_rfq_lines line LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
                  WHERE line.organization_id = rfq.organization_id AND line.rfq_id = rfq.id AND (item.name ILIKE ${term} OR item.code ILIKE ${term} OR line.description ILIKE ${term})))`;
  }
  return pagedList(client,
    `SELECT rfq.id, rfq.rfq_number, rfq.status, rfq.title, rfq.response_due_date, rfq.created_at, rfq.sent_at,
            (SELECT count(*) FROM tenant.purchase_rfq_lines line WHERE line.organization_id = rfq.organization_id AND line.rfq_id = rfq.id)::int AS line_count,
            (SELECT count(*) FROM tenant.purchase_rfq_suppliers invited WHERE invited.organization_id = rfq.organization_id AND invited.rfq_id = rfq.id)::int AS supplier_count,
            ${RESPONDED_SQL}::int AS responded
       FROM tenant.purchase_rfqs rfq WHERE rfq.organization_id = $1${where} ORDER BY rfq.created_at DESC`, values, filters, (row) => ({
    id: row.id, number: row.rfq_number, status: row.status, statusLabel: RFQ_STATUS_LABELS[row.status], title: row.title, responseDueDate: dayOf(row.response_due_date),
    lineCount: row.line_count, supplierCount: row.supplier_count, responded: row.responded, createdAt: row.created_at, sentAt: row.sent_at,
  }));
}

async function loadRfq(client, context, rfqId, { lock = false } = {}) {
  requirePoAccess(context);
  const row = (await client.query(`SELECT * FROM tenant.purchase_rfqs WHERE organization_id = $1 AND id = $2${lock ? " FOR UPDATE" : ""}`,
    [context.organizationId, requireUuid(rfqId, "RFQ")])).rows[0];
  if (!row) throw new PurchaseOrderError(404, "RFQ not found.", "PURCHASE_RFQ_NOT_FOUND");
  return row;
}

export async function getPurchaseRfq(client, context, rfqId) {
  const row = await loadRfq(client, context, rfqId);
  const lines = (await client.query(
    `SELECT line.*, item.code AS item_code, COALESCE(item.name, line.description) AS item_name, uom.code AS uom_code, indent.indent_number, indent.id AS indent_id
       FROM tenant.purchase_rfq_lines line LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
       LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
       LEFT JOIN tenant.purchase_indent_lines indent_line ON indent_line.organization_id = line.organization_id AND indent_line.id = line.indent_line_id
       LEFT JOIN tenant.purchase_indents indent ON indent.organization_id = indent_line.organization_id AND indent.id = indent_line.indent_id
      WHERE line.organization_id = $1 AND line.rfq_id = $2 ORDER BY line.line_number`, [context.organizationId, row.id])).rows;
  const suppliers = (await client.query(
    `SELECT invited.*, party.display_name AS supplier_name, supplier.supplier_number, supplier.msme_classification, party.gstin, party.tax_treatment,
            (SELECT json_build_object('id', quotation.id, 'number', quotation.quotation_number, 'status', quotation.status, 'convertedPurchaseOrderId', quotation.converted_purchase_order_id)
               FROM tenant.supplier_quotations quotation WHERE quotation.organization_id = invited.organization_id AND quotation.rfq_id = invited.rfq_id
                AND quotation.supplier_id = invited.supplier_id AND quotation.status <> 'cancelled' ORDER BY quotation.created_at DESC LIMIT 1) AS quotation,
            (SELECT contact.email FROM tenant.procurement_supplier_contacts link JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
              WHERE link.organization_id = invited.organization_id AND link.supplier_id = invited.supplier_id AND contact.email IS NOT NULL
              ORDER BY link.is_primary DESC NULLS LAST LIMIT 1) AS email,
            (SELECT COALESCE(contact.mobile, contact.phone) FROM tenant.procurement_supplier_contacts link JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
              WHERE link.organization_id = invited.organization_id AND link.supplier_id = invited.supplier_id AND COALESCE(contact.mobile, contact.phone) IS NOT NULL
              ORDER BY link.is_primary DESC NULLS LAST LIMIT 1) AS phone
       FROM tenant.purchase_rfq_suppliers invited
       JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = invited.organization_id AND supplier.id = invited.supplier_id
       JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
      WHERE invited.organization_id = $1 AND invited.rfq_id = $2 ORDER BY party.display_name`, [context.organizationId, row.id])).rows;
  const orders = (await client.query(
    `SELECT DISTINCT po.id, po.purchase_order_number, po.status FROM tenant.supplier_quotations quotation
       JOIN tenant.purchase_orders po ON po.organization_id = quotation.organization_id AND po.id = quotation.converted_purchase_order_id
      WHERE quotation.organization_id = $1 AND quotation.rfq_id = $2`, [context.organizationId, row.id])).rows;
  const responded = suppliers.filter((entry) => entry.quotation).length;
  const manage = poCan(context, PO_PERMISSIONS.create);
  return {
    rfq: { id: row.id, number: row.rfq_number, status: row.status, statusLabel: RFQ_STATUS_LABELS[row.status], title: row.title, responseDueDate: dayOf(row.response_due_date),
      currencyCode: row.currency_code?.trim(), warehouseId: row.warehouse_id, notes: row.notes, sentAt: row.sent_at, awardedAt: row.awarded_at, createdAt: row.created_at },
    lines: lines.map((line) => ({ id: line.id, lineNumber: line.line_number, productId: line.item_id, productCode: line.item_code, productName: line.item_name, description: line.description,
      quantity: dec(line.quantity), uomId: line.uom_id, uomCode: line.uom_code, requiredBy: dayOf(line.required_by), indentLineId: line.indent_line_id, indentId: line.indent_id,
      indentNumber: line.indent_number, awardedQuotationLineId: line.awarded_quotation_line_id, ...oneOffView(line) })),
    suppliers: suppliers.map((entry) => ({ id: entry.id, supplierId: entry.supplier_id, supplierName: entry.supplier_name, supplierNumber: entry.supplier_number, gstin: entry.gstin, taxTreatment: entry.tax_treatment,
      msme: ["micro", "small"].includes(entry.msme_classification), email: entry.email, phone: entry.phone, status: entry.quotation ? "responded" : entry.status, sentAt: entry.sent_at,
      declinedReason: entry.declined_reason, quotation: entry.quotation })),
    orders: orders.map((order) => ({ id: order.id, number: order.purchase_order_number, status: order.status, href: `/procurement/purchase-orders/${order.id}` })),
    actions: {
      edit: row.status === "draft" && manage, send: ["draft", "sent"].includes(row.status) && manage && suppliers.length > 0,
      recordQuote: row.status === "sent" && poCan(context, PO_PERMISSIONS.quotations), award: row.status === "sent" && responded > 0 && manage,
      cancel: ["draft", "sent"].includes(row.status) && manage, close: row.status === "sent" && manage,
    },
  };
}

async function readRfqInput(client, context, input, current = null) {
  const title = text(input.title, 200) ?? current?.title ?? null;
  const responseDueDate = readDate(input.responseDueDate, "Reply by") ?? (current ? dayOf(current.response_due_date) : null);
  const warehouseId = optionalUuid(input.warehouseId, "Warehouse") ?? current?.warehouse_id ?? null;
  let lines = null;
  if (Array.isArray(input.indentLineIds) && input.indentLineIds.length) {
    // From approved indent lines: what each still has to order.
    const open = new Map((await listIndentLinesToOrder(client, context, { ids: input.indentLineIds })).map((line) => [line.id, line]));
    lines = input.indentLineIds.map((id, index) => {
      const line = open.get(id);
      if (!line) fail(`Line ${index + 1}: the indent line is not approved or has nothing left to order.`, "indentLineIds", "PURCHASE_INDENT_LINE_INVALID", 409);
      return { itemId: line.productId, quantity: line.remaining, uomId: line.uomId, requiredBy: line.requiredBy, indentLineId: line.id, description: line.oneOff ? line.description : null,
        ...(line.oneOff ? { oneOffType: line.oneOffType, expenseAccountId: line.expenseAccountId, taxCategoryId: line.taxCategoryId, noTax: line.noTax } : {}) };
    });
  } else if (Array.isArray(input.lines)) {
    lines = [];
    for (const [index, line] of input.lines.entries()) {
      const label = `Line ${index + 1}`;
      if (!line.productId && !line.itemId) {
        // Outside the catalogue: described, with a unit.
        const quantity = String(line.quantity ?? "").trim();
        if (!/^\d+(\.\d{1,6})?$/.test(quantity) || decimal(quantity) <= 0n) fail(`${label}: the quantity must be more than zero.`, "quantity");
        lines.push({ ...(await readOneOffLine(client, context.organizationId, line, label)), quantity, requiredBy: readDate(line.requiredBy, `${label} required by`),
          indentLineId: optionalUuid(line.indentLineId, `${label} indent line`) });
        continue;
      }
      const itemId = requireUuid(line.productId ?? line.itemId, `${label} item`);
      const item = (await client.query(`SELECT id, uom_id, purchase_uom_id, status FROM tenant.items WHERE organization_id = $1 AND id = $2`, [context.organizationId, itemId])).rows[0];
      if (!item || item.status !== "active") fail(`${label}: choose an active item.`, "productId", "PURCHASE_RFQ_ITEM_INVALID", 409);
      const quantity = String(line.quantity ?? "").trim();
      if (!/^\d+(\.\d{1,6})?$/.test(quantity) || decimal(quantity) <= 0n) fail(`${label}: the quantity must be more than zero.`, "quantity");
      const uomId = optionalUuid(line.uomId, `${label} unit`) ?? item.purchase_uom_id ?? item.uom_id;
      const unit = await normalizeQuantityToBase(client, context.organizationId, item.id, uomId, decimal(quantity), { purpose: "purchase" });
      if (!unit.ok) fail(`${label}: ${unit.message}`, "uomId", "PURCHASE_RFQ_UOM_INVALID");
      lines.push({ itemId, quantity, uomId, requiredBy: readDate(line.requiredBy, `${label} required by`), indentLineId: optionalUuid(line.indentLineId, `${label} indent line`),
        description: text(line.description, 1000) });
    }
  }
  if (!current && (!lines || !lines.length)) fail("Add at least one item to ask prices for.", "lines", "PURCHASE_RFQ_NO_LINES");
  if (lines) await purchaseWarningsFor(client, context.organizationId, { lines: lines.map((line, index) => ({ itemId: line.itemId, label: `Line ${index + 1}` })) });
  let supplierIds = null;
  if (Array.isArray(input.supplierIds)) {
    supplierIds = [...new Set(input.supplierIds.map((id) => requireUuid(id, "Supplier")))];
    if (supplierIds.length > 10) fail("Ask at most 10 suppliers.", "supplierIds");
    for (const id of supplierIds) await translated(() => assertSupplierUsable(client, context.organizationId, id, { purpose: "an RFQ" }));
  }
  return { title, responseDueDate, warehouseId, notes: input.notes !== undefined ? text(input.notes, 4000) : current?.notes ?? null, lines, supplierIds };
}

async function writeRfqParts(client, context, rfqId, data) {
  if (data.lines) {
    await client.query(`DELETE FROM tenant.purchase_rfq_lines WHERE organization_id = $1 AND rfq_id = $2`, [context.organizationId, rfqId]);
    for (const [index, line] of data.lines.entries())
      await client.query(
        `INSERT INTO tenant.purchase_rfq_lines (organization_id, rfq_id, line_number, item_id, description, quantity, uom_id, required_by, indent_line_id, one_off_type, expense_account_id,
           tax_category_id, one_off_no_tax) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [context.organizationId, rfqId, index + 1, line.itemId, line.description, line.quantity, line.uomId, line.requiredBy, line.indentLineId, line.oneOffType ?? null,
          line.expenseAccountId ?? null, line.taxCategoryId ?? null, Boolean(line.noTax)]);
  }
  if (data.supplierIds) {
    await client.query(`DELETE FROM tenant.purchase_rfq_suppliers WHERE organization_id = $1 AND rfq_id = $2 AND NOT (supplier_id = ANY($3::uuid[]))`, [context.organizationId, rfqId, data.supplierIds]);
    for (const supplierId of data.supplierIds)
      await client.query(`INSERT INTO tenant.purchase_rfq_suppliers (organization_id, rfq_id, supplier_id) VALUES ($1, $2, $3) ON CONFLICT (organization_id, rfq_id, supplier_id) DO NOTHING`,
        [context.organizationId, rfqId, supplierId]);
  }
}

// createPurchaseRfq. input: { title?, responseDueDate?, warehouseId?, notes?, supplierIds: [...], lines: [{ productId, quantity, uomId?, requiredBy? }] | indentLineIds: [...] }
export async function createPurchaseRfq(client, context, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to ask suppliers for prices.");
  await requireRfqsOn(client, context);
  const data = await readRfqInput(client, context, input);
  const currency = (await client.query(`SELECT btrim(base_currency) AS currency FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0]?.currency ?? "INR";
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "purchase_rfq" });
  const row = (await client.query(
    `INSERT INTO tenant.purchase_rfqs (organization_id, rfq_number, title, response_due_date, currency_code, warehouse_id, notes, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id, rfq_number`,
    [context.organizationId, number, data.title, data.responseDueDate, String(currency).trim().slice(0, 3) || "INR", data.warehouseId, data.notes, context.userId ?? null])).rows[0];
  await writeRfqParts(client, context, row.id, data);
  return { id: row.id, number: row.rfq_number };
}

export async function updatePurchaseRfq(client, context, rfqId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to change RFQs.");
  const current = await loadRfq(client, context, rfqId, { lock: true });
  // Suppliers can still be added after it is sent; the lines are fixed once suppliers have them.
  if (current.status !== "draft" && (current.status !== "sent" || input.lines || input.indentLineIds))
    throw new PurchaseOrderError(409, current.status === "sent" ? "The RFQ is with the suppliers: only suppliers can be added." : `A ${current.status} RFQ cannot be changed.`, "PURCHASE_RFQ_LOCKED");
  const data = await readRfqInput(client, context, input, current);
  await client.query(`UPDATE tenant.purchase_rfqs SET title = $3, response_due_date = $4, warehouse_id = $5, notes = $6, updated_by = $7, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, current.id, data.title, data.responseDueDate, data.warehouseId, data.notes, context.userId ?? null]);
  await writeRfqParts(client, context, current.id, data);
  return { id: current.id };
}

// sendPurchaseRfq: the RFQ goes to its suppliers (each gets its PDF by email or the WhatsApp link from the screen); marks them sent.
// input: { supplierIds? (default: those not sent yet) }
export async function sendPurchaseRfq(client, context, rfqId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to send RFQs.");
  const current = await loadRfq(client, context, rfqId, { lock: true });
  if (!["draft", "sent"].includes(current.status)) throw new PurchaseOrderError(409, `A ${current.status} RFQ is not sent.`, "PURCHASE_RFQ_LOCKED");
  const ids = Array.isArray(input.supplierIds) && input.supplierIds.length ? input.supplierIds.map((id) => requireUuid(id, "Supplier")) : null;
  const sent = (await client.query(
    `UPDATE tenant.purchase_rfq_suppliers SET status = 'sent', sent_at = now() WHERE organization_id = $1 AND rfq_id = $2 AND status IN ('invited', 'sent')
        AND ($3::uuid[] IS NULL OR supplier_id = ANY($3::uuid[])) RETURNING supplier_id`, [context.organizationId, current.id, ids])).rows;
  if (!sent.length) fail("Add the suppliers to ask first.", "supplierIds", "PURCHASE_RFQ_NO_SUPPLIERS");
  await client.query(`UPDATE tenant.purchase_rfqs SET status = 'sent', sent_at = COALESCE(sent_at, now()), updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, current.id, context.userId ?? null]);
  return { id: current.id, status: "sent", suppliers: sent.length };
}

// recordRfqQuotation: a supplier's answer, as a supplier quotation linked to the RFQ. input: { supplierId, supplierReference?, quotationDate?, validUntil?,
// deliveryLeadDays?, paymentTermId?, freightAmount?, priceMode?, notes?, lines: [{ rfqLineId, unitPrice, quantity?, discountType?, discountValue?, taxCategoryId? }] }
export async function recordRfqQuotation(client, context, rfqId, input = {}) {
  const current = await loadRfq(client, context, rfqId, { lock: true });
  if (current.status !== "sent") throw new PurchaseOrderError(409, "Record suppliers' prices once the RFQ is sent.", "PURCHASE_RFQ_NOT_SENT");
  const supplierId = requireUuid(input.supplierId, "Supplier");
  const invited = (await client.query(`SELECT id FROM tenant.purchase_rfq_suppliers WHERE organization_id = $1 AND rfq_id = $2 AND supplier_id = $3`, [context.organizationId, current.id, supplierId])).rows[0];
  if (!invited) fail("The supplier was not asked on this RFQ. Add them first.", "supplierId", "PURCHASE_RFQ_SUPPLIER_NOT_INVITED", 409);
  const existing = (await client.query(`SELECT id, quotation_number FROM tenant.supplier_quotations WHERE organization_id = $1 AND rfq_id = $2 AND supplier_id = $3 AND status <> 'cancelled'`,
    [context.organizationId, current.id, supplierId])).rows[0];
  if (existing) fail(`This supplier's prices are already recorded as ${existing.quotation_number}: change that quotation instead.`, "supplierId", "PURCHASE_RFQ_ALREADY_QUOTED", 409);
  const rfqLines = new Map((await client.query(`SELECT * FROM tenant.purchase_rfq_lines WHERE organization_id = $1 AND rfq_id = $2`, [context.organizationId, current.id])).rows.map((line) => [line.id, line]));
  const asked = Array.isArray(input.lines) ? input.lines.filter((line) => line.unitPrice !== undefined && line.unitPrice !== null && line.unitPrice !== "") : [];
  if (!asked.length) fail("Enter the supplier's price for at least one line.", "lines", "PURCHASE_RFQ_NO_PRICES");
  const lines = asked.map((line, index) => {
    const rfqLine = rfqLines.get(line.rfqLineId);
    if (!rfqLine) fail(`Line ${index + 1}: not a line of this RFQ.`, "lines", "PURCHASE_RFQ_LINE_INVALID");
    return { productId: rfqLine.item_id ?? undefined, description: rfqLine.item_id ? undefined : rfqLine.description, oneOffType: rfqLine.one_off_type ?? undefined,
      expenseAccountId: rfqLine.expense_account_id ?? undefined, noTax: rfqLine.one_off_no_tax || undefined,
      quantity: line.quantity ? String(line.quantity) : formatDecimal(rfqLine.quantity), uomId: rfqLine.uom_id, unitPrice: String(line.unitPrice),
      discountType: line.discountType, discountValue: line.discountValue, taxCategoryId: line.taxCategoryId, rfqLineId: rfqLine.id };
  });
  const made = await createSupplierQuotation(client, context, { ...input, supplierId, rfqReference: current.rfq_number, currencyCode: input.currencyCode ?? current.currency_code?.trim(), lines },
    { rfqId: current.id });
  await client.query(`UPDATE tenant.purchase_rfq_suppliers SET status = 'responded' WHERE organization_id = $1 AND id = $2`, [context.organizationId, invited.id]);
  return made;
}

export async function declineRfqSupplier(client, context, rfqId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to change RFQs.");
  const current = await loadRfq(client, context, rfqId, { lock: true });
  const done = (await client.query(`UPDATE tenant.purchase_rfq_suppliers SET status = 'declined', declined_reason = $4 WHERE organization_id = $1 AND rfq_id = $2 AND supplier_id = $3 RETURNING id`,
    [context.organizationId, current.id, requireUuid(input.supplierId, "Supplier"), text(input.reason, 500)])).rows[0];
  if (!done) fail("The supplier was not asked on this RFQ.", "supplierId", "PURCHASE_RFQ_SUPPLIER_NOT_INVITED", 409);
  return { id: current.id };
}

// The comparison (Procurement plan Phase 2): per RFQ line, every supplier's answer — rate, discount, net rate, GST %, its share of the
// quotation's freight (by line value), the landed rate per unit, lead time, payment terms — the last price paid for the item and the MSME
// flag. The landed rate is what the goods really cost: net + freight + only the GST that cannot be claimed back (all of it when we are not
// a regular GST registration; none from a composition or unregistered supplier, who charges none). The lowest landed rate among quotes
// still valid is marked; expired quotes are shown but never lowest. Per supplier: the total landed value of what they quoted.
export async function getRfqComparison(client, context, rfqId) {
  const detail = await getPurchaseRfq(client, context, rfqId);
  const organizationId = context.organizationId;
  const quotations = (await client.query(
    `SELECT quotation.*, term.name AS payment_term_name FROM tenant.supplier_quotations quotation
       LEFT JOIN tenant.payment_terms term ON term.organization_id = quotation.organization_id AND term.id = quotation.payment_term_id
      WHERE quotation.organization_id = $1 AND quotation.rfq_id = $2 AND quotation.status <> 'cancelled'`, [organizationId, detail.rfq.id])).rows;
  const quoteLines = quotations.length ? (await client.query(
    `SELECT line.*, item.tax_category_id AS item_tax_category_id FROM tenant.supplier_quotation_lines line LEFT JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      WHERE line.organization_id = $1 AND line.supplier_quotation_id = ANY($2::uuid[])`, [organizationId, quotations.map((quotation) => quotation.id)])).rows : [];
  // GST % per tax category (the total rate; the CGST/SGST or IGST split does not change it).
  const tax = await loadTaxContext(client, { organizationId, purchase: true }).catch(() => null);
  const today = await databaseToday(client, organizationId);
  const rates = new Map();
  const rateOf = async (categoryId) => {
    if (!categoryId || !tax) return 0n;
    if (!rates.has(categoryId)) {
      const state = tax.registration?.stateCode ?? null;
      const resolved = await resolveLineTax(client, tax, { taxCategoryId: categoryId, date: today, sellerStateCode: state, placeOfSupply: state }).catch(() => null);
      rates.set(categoryId, resolved ? add(decimal(resolved.rate ?? 0), decimal(resolved.cessRate ?? 0)) : 0n);
    }
    return rates.get(categoryId);
  };
  // Each quotation's freight shared over its lines by value.
  const netOf = (line) => {
    const gross = mul(decimal(line.quantity), decimal(line.unit_price));
    const discount = line.discount_type === "percent" ? div(mul(gross, decimal(line.discount_value)), decimal(100)) : line.discount_type === "amount" ? decimal(line.discount_value) : 0n;
    return sub(gross, discount);
  };
  const quotedNet = new Map();
  for (const line of quoteLines) quotedNet.set(line.supplier_quotation_id, add(quotedNet.get(line.supplier_quotation_id) ?? 0n, netOf(line)));
  const lastPrices = new Map((await client.query(
    `SELECT DISTINCT ON (po_line.product_id) po_line.product_id, po_line.unit_price, po.order_date, party.display_name AS supplier_name
       FROM tenant.purchase_order_lines po_line JOIN tenant.purchase_orders po ON po.organization_id = po_line.organization_id AND po.id = po_line.purchase_order_id
       JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id
      WHERE po_line.organization_id = $1 AND po_line.product_id = ANY($2::uuid[]) AND po.status IN ('confirmed', 'closed')
      ORDER BY po_line.product_id, po.order_date DESC, po.created_at DESC`, [organizationId, detail.lines.map((line) => line.productId).filter(Boolean)])).rows.map((row) => [row.product_id, row]));
  const supplierOf = new Map(detail.suppliers.map((entry) => [entry.supplierId, entry]));
  const weClaim = Boolean(tax?.registration) && (tax.registration.registrationType ?? "regular") === "regular";
  const chargesGst = (supplier) => !["registered_composition", "unregistered"].includes(supplier?.taxTreatment ?? "registered_regular");
  const totals = new Map();
  const lines = [];
  for (const rfqLine of detail.lines) {
    const offers = [];
    for (const quotation of quotations) {
      const line = quoteLines.find((candidate) => candidate.supplier_quotation_id === quotation.id && candidate.rfq_line_id === rfqLine.id);
      if (!line) continue;
      const quantity = decimal(line.quantity);
      const net = netOf(line);
      const share = decimal(quotation.freight_amount ?? 0) > 0n && (quotedNet.get(quotation.id) ?? 0n) > 0n ? div(mul(decimal(quotation.freight_amount), net), quotedNet.get(quotation.id)) : 0n;
      const supplier = supplierOf.get(quotation.supplier_id);
      const charged = chargesGst(supplier);
      const rate = charged ? await rateOf(line.tax_category_id ?? line.item_tax_category_id ?? rfqLine.taxCategoryId) : 0n;
      const gst = div(mul(add(net, share), rate), decimal(100));
      const landed = add(add(net, share), weClaim ? 0n : gst);
      const perUnit = quantity > 0n ? div(landed, quantity) : 0n;
      totals.set(quotation.id, add(totals.get(quotation.id) ?? 0n, landed));
      offers.push({
        quotationId: quotation.id, quotationNumber: quotation.quotation_number, quotationLineId: line.id, supplierId: quotation.supplier_id, supplierName: supplier?.supplierName ?? null,
        msme: Boolean(supplier?.msme), quantity: dec(quantity), unitPrice: dec(line.unit_price), discountType: line.discount_type, discountValue: dec(line.discount_value),
        netRate: dec(quantity > 0n ? roundMoney(div(net, quantity), 4) : 0n), gstRate: dec(rate), gstClaimable: charged && weClaim, freightPerUnit: dec(quantity > 0n ? roundMoney(div(share, quantity), 4) : 0n),
        landedRate: dec(roundMoney(perUnit, 4)), landedValue: dec(roundMoney(landed, 2)), leadDays: quotation.delivery_lead_days, paymentTerms: quotation.payment_term_name,
        validUntil: dayOf(quotation.valid_until), expired: Boolean(quotation.valid_until && dayOf(quotation.valid_until) < today), awarded: rfqLine.awardedQuotationLineId === line.id,
      });
    }
    const best = offers.filter((offer) => !offer.expired).reduce((lowest, offer) => (lowest === null || decimal(offer.landedRate) < decimal(lowest.landedRate) ? offer : lowest), null);
    const last = rfqLine.productId ? lastPrices.get(rfqLine.productId) : null;
    lines.push({ ...rfqLine, offers: offers.map((offer) => ({ ...offer, lowest: best?.quotationLineId === offer.quotationLineId })),
      lastPrice: last ? { unitPrice: dec(last.unit_price), date: dayOf(last.order_date), supplierName: last.supplier_name } : null });
  }
  return {
    rfq: detail.rfq, actions: detail.actions,
    suppliers: quotations.map((quotation) => ({ quotationId: quotation.id, quotationNumber: quotation.quotation_number, supplierId: quotation.supplier_id,
      supplierName: supplierOf.get(quotation.supplier_id)?.supplierName ?? null, msme: Boolean(supplierOf.get(quotation.supplier_id)?.msme), freight: dec(quotation.freight_amount ?? 0),
      leadDays: quotation.delivery_lead_days, paymentTerms: quotation.payment_term_name, landedTotal: dec(roundMoney(totals.get(quotation.id) ?? 0n, 2)),
      linesQuoted: quoteLines.filter((line) => line.supplier_quotation_id === quotation.id && line.rfq_line_id).length })),
    lines,
  };
}

// awardPurchaseRfq: the buyer's choice, per line ({ awards: [{ rfqLineId, quotationLineId }] }) or whole ({ quotationId }: every line that
// supplier quoted). One draft purchase order per supplier from its quotation's prices for the RFQ quantities, carrying each line's indent.
// input also: { expectedDeliveryDate?, defaultWarehouseId?, reason? (when not the lowest landed rate) }
export async function awardPurchaseRfq(client, context, rfqId, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to award RFQs.");
  const current = await loadRfq(client, context, rfqId, { lock: true });
  if (current.status !== "sent") throw new PurchaseOrderError(409, current.status === "awarded" ? "Every line of this RFQ is already awarded." : "Award an RFQ once suppliers have answered.", "PURCHASE_RFQ_LOCKED");
  const comparison = await getRfqComparison(client, context, current.id);
  let awards = [];
  if (isUuid(input.quotationId)) {
    // The whole quotation: every line it quoted that is not awarded yet.
    for (const line of comparison.lines) {
      if (line.awardedQuotationLineId) continue;
      const offer = line.offers.find((candidate) => candidate.quotationId === input.quotationId);
      if (offer) awards.push({ line, offer });
    }
  } else {
    for (const entry of Array.isArray(input.awards) ? input.awards : []) {
      const line = comparison.lines.find((candidate) => candidate.id === entry.rfqLineId);
      const offer = line?.offers.find((candidate) => candidate.quotationLineId === entry.quotationLineId);
      if (!line || !offer) fail("An award names a line or a price that is not on this RFQ.", "awards", "PURCHASE_RFQ_AWARD_INVALID");
      if (awards.some((award) => award.line.id === line.id)) fail(`${line.productName} is awarded twice.`, "awards", "PURCHASE_RFQ_AWARD_INVALID");
      if (line.awardedQuotationLineId) fail(`${line.productName} is already awarded.`, "awards", "PURCHASE_RFQ_AWARD_INVALID", 409);
      awards.push({ line, offer });
    }
  }
  if (!awards.length) fail("Choose who wins each line, or the whole RFQ.", "awards", "PURCHASE_RFQ_AWARD_INVALID");
  // An expired quote's price no longer holds: ask the supplier again.
  const expired = awards.filter((award) => award.offer.expired);
  if (expired.length) fail(`The quote for ${expired.map((award) => award.line.productName).join(", ")} has expired: ask the supplier to confirm a new price.`, "awards", "PURCHASE_RFQ_QUOTE_EXPIRED", 409);
  // What the requests still need, now: another order may have taken some since the RFQ went out. Each line orders at most that.
  const indentLineIds = awards.map((award) => award.line.indentLineId).filter(Boolean);
  if (indentLineIds.length) {
    const open = new Map((await listIndentLinesToOrder(client, context, { ids: indentLineIds })).map((line) => [line.id, line]));
    for (const award of awards) {
      if (!award.line.indentLineId) continue;
      const need = open.get(award.line.indentLineId);
      if (!need) fail(`${award.line.productName}: the purchase request has nothing left to order.`, "awards", "PURCHASE_INDENT_OVER_ORDER", 409);
      if (decimal(award.line.quantity) > decimal(need.remaining)) award.line = { ...award.line, quantity: need.remaining };
    }
  }
  const notLowest = awards.filter((award) => !award.offer.lowest);
  const reason = text(input.reason, 1000);
  if (notLowest.length && !reason) fail(`Give the reason for not choosing the lowest landed rate (${notLowest.map((award) => award.line.productName).join(", ")}).`, "reason", "PURCHASE_RFQ_REASON_REQUIRED");
  const today = await databaseToday(client, context.organizationId);
  const quotationRows = new Map((await client.query(`SELECT * FROM tenant.supplier_quotations WHERE organization_id = $1 AND rfq_id = $2`, [context.organizationId, current.id])).rows.map((row) => [row.id, row]));
  const quoteLines = new Map((await client.query(`SELECT * FROM tenant.supplier_quotation_lines WHERE organization_id = $1 AND id = ANY($2::uuid[])`,
    [context.organizationId, awards.map((award) => award.offer.quotationLineId)])).rows.map((row) => [row.id, row]));
  const byQuotation = new Map();
  for (const award of awards) {
    if (!byQuotation.has(award.offer.quotationId)) byQuotation.set(award.offer.quotationId, []);
    byQuotation.get(award.offer.quotationId).push(award);
  }
  const orders = [];
  for (const [quotationId, group] of byQuotation) {
    const quotation = quotationRows.get(quotationId);
    const document = {
      supplierId: quotation.supplier_id, currencyCode: quotation.currency_code.trim(), paymentTermId: quotation.payment_term_id ?? undefined, priceMode: quotation.price_mode,
      supplierQuotationReference: quotation.supplier_reference ?? quotation.quotation_number, defaultWarehouseId: optionalUuid(input.defaultWarehouseId, "Warehouse") ?? current.warehouse_id ?? undefined,
      expectedDeliveryDate: readDate(input.expectedDeliveryDate, "Expected delivery") ?? (quotation.delivery_lead_days != null
        ? (await client.query(`SELECT ($1::date + $2::int)::text AS day`, [today, quotation.delivery_lead_days])).rows[0].day : undefined),
      internalNotes: `Awarded on ${current.rfq_number}${notLowest.some((award) => award.offer.quotationId === quotationId) && reason ? ` — not the lowest landed rate: ${reason}` : ""}`,
      lines: group.map(({ line }) => {
        const quoted = quoteLines.get(group.find((award) => award.line.id === line.id).offer.quotationLineId);
        if (line.oneOff) {
          return { ...oneOffOrderLine(line, input.accounts?.[line.id], line.productName), quantity: line.quantity, unitPrice: formatDecimal(quoted.unit_price), discountType: quoted.discount_type,
            discountValue: formatDecimal(quoted.discount_value), priceSource: "quotation", sourceQuotationLineId: quoted.id, sourceIndentLineId: line.indentLineId ?? undefined,
            expectedDeliveryDate: line.requiredBy ?? undefined };
        }
        return {
          productId: line.productId, quantity: line.quantity, uomId: line.uomId ?? quoted.uom_id, unitPrice: formatDecimal(quoted.unit_price), discountType: quoted.discount_type,
          discountValue: formatDecimal(quoted.discount_value), priceSource: "quotation", sourceQuotationLineId: quoted.id, sourceIndentLineId: line.indentLineId ?? undefined,
          carriedTaxCategoryId: quoted.tax_category_id ?? undefined, expectedDeliveryDate: line.requiredBy ?? undefined,
          zeroPriceReason: decimal(quoted.unit_price) === 0n ? "Quoted at no charge" : undefined, carried: decimal(quoted.unit_price) === 0n,
        };
      }),
    };
    const { header, priced } = await resolveOrderDocument(client, context, document, { today });
    const order = await insertOrder(client, context, header, priced, { sourceQuotationId: quotation.id });
    await client.query(`UPDATE tenant.supplier_quotations SET status = 'converted', converted_purchase_order_id = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, quotation.id, order.id, context.userId ?? null]);
    await recordPoEvent(client, context, order.id, "purchase_order.created", `Created from ${current.rfq_number} (quotation ${quotation.quotation_number}) · ${header.currencyCode} ${formatDecimal(priced.totals.grandTotal)}`,
      { to: STATUS.draft, details: { source: "rfq", rfqId: current.id, quotationId: quotation.id } });
    for (const award of group)
      await client.query(`UPDATE tenant.purchase_rfq_lines SET awarded_quotation_line_id = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, award.line.id, award.offer.quotationLineId]);
    orders.push({ id: order.id, purchaseOrderNumber: order.purchase_order_number, supplierId: quotation.supplier_id, lines: group.length });
  }
  // Awarded when every line is; until then it stays open for the other lines.
  const left = Number((await client.query(`SELECT count(*)::int AS left FROM tenant.purchase_rfq_lines WHERE organization_id = $1 AND rfq_id = $2 AND awarded_quotation_line_id IS NULL`,
    [context.organizationId, current.id])).rows[0].left);
  const status = left === 0 ? "awarded" : "sent";
  await client.query(`UPDATE tenant.purchase_rfqs SET status = $4, awarded_at = now(), awarded_by = $3, updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, current.id, context.userId ?? null, status]);
  return { id: current.id, status, linesLeft: left, orders };
}

async function finish(client, context, rfqId, status) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to change RFQs.");
  const current = await loadRfq(client, context, rfqId, { lock: true });
  if (!["draft", "sent"].includes(current.status)) throw new PurchaseOrderError(409, `A ${current.status} RFQ cannot be ${status}.`, "PURCHASE_RFQ_LOCKED");
  await client.query(`UPDATE tenant.purchase_rfqs SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, current.id, status, context.userId ?? null]);
  return { id: current.id, status };
}
export const cancelPurchaseRfq = (client, context, rfqId) => finish(client, context, rfqId, "cancelled");
export const closePurchaseRfq = (client, context, rfqId) => finish(client, context, rfqId, "closed");
