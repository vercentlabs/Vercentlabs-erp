// The supplier's own page (Procurement report H5): one link, sent on WhatsApp or email, opened without signing in. For a purchase order
// the supplier sees the order, confirms it or proposes another delivery date, downloads the PDF and sends their invoice (a draft bill is
// made from it when the order has something to bill; else it waits for Accounts Payable). For a price request the supplier types their
// prices, validity and lead time, recorded as their quotation. The token is the only credential: 24 random bytes, kept hashed for lookup
// and encrypted so the same link is given every time; revoking it ends it. Every step is told to the buyer and kept on the record.
import { createHash, randomBytes } from "node:crypto";
import { setTenantContext } from "@vercentlabs/database";
import { whatsappNumber } from "@vercentlabs/shared-types";

import { decimal, formatDecimal } from "../../../core/decimal.js";
import { storeFile } from "../../../core/platform/files/service.js";
import { createNotification } from "../../../core/platform/notifications/service.js";
import { decryptSecret, encryptSecret } from "../../../core/platform/secrets/index.js";
import { loadPurchaseOrder, requirePoPermission } from "./access.js";
import { PO_PERMISSIONS, PurchaseOrderError, dayOf, fail, isUuid, readDate, requireUuid, text } from "./constants.js";
import { PO_FILE_ENTITY } from "./communication.js";
import { recordPoEvent } from "./persist.js";

const TOKEN = /^[0-9a-f]{48}$/;
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const dec = (value) => (value === null || value === undefined ? null : formatDecimal(value));
const appUrl = (env) => String(env.APP_URL ?? "").replace(/\/+$/, "");

// The link for a document (created once, the same every time). documentType: purchase_order | rfq_supplier.
export async function supplierLinkToken(client, context, documentType, documentId, env = process.env) {
  const existing = (await client.query(
    "SELECT token_encrypted FROM tenant.procurement_share_links WHERE organization_id = $1 AND document_type = $2 AND document_id = $3 AND revoked_at IS NULL",
    [context.organizationId, documentType, documentId])).rows[0];
  let token = existing ? (await decryptSecret(existing.token_encrypted, env))?.token : null;
  if (!token) {
    token = randomBytes(24).toString("hex");
    await client.query(
      `INSERT INTO tenant.procurement_share_links (organization_id, document_type, document_id, token_hash, token_encrypted, created_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [context.organizationId, documentType, documentId, hash(token), JSON.stringify(await encryptSecret({ token }, env)), context.userId ?? null]);
  }
  return token;
}
export const supplierPageUrl = (token, env = process.env) => `${appUrl(env)}/s/${token}`;

// The link a supplier answers a price request with: { url, body, whatsapp }.
export async function shareRfqSupplierLink(client, context, rfqId, supplierId, env = process.env) {
  requirePoPermission(context, PO_PERMISSIONS.create, "You do not have permission to send price requests.");
  const invited = (await client.query(
    `SELECT invited.id, rfq.rfq_number, rfq.title, rfq.response_due_date, rfq.status, party.display_name,
            (SELECT COALESCE(contact.mobile, contact.phone) FROM tenant.procurement_supplier_contacts link JOIN tenant.contacts contact ON contact.organization_id = link.organization_id
               AND contact.id = link.contact_id WHERE link.organization_id = invited.organization_id AND link.supplier_id = invited.supplier_id AND COALESCE(contact.mobile, contact.phone) IS NOT NULL
             ORDER BY link.is_primary DESC NULLS LAST LIMIT 1) AS phone
       FROM tenant.purchase_rfq_suppliers invited JOIN tenant.purchase_rfqs rfq ON rfq.organization_id = invited.organization_id AND rfq.id = invited.rfq_id
       JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = invited.organization_id AND supplier.id = invited.supplier_id
       JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
      WHERE invited.organization_id = $1 AND invited.rfq_id = $2 AND invited.supplier_id = $3`, [context.organizationId, requireUuid(rfqId, "RFQ"), requireUuid(supplierId, "Supplier")])).rows[0];
  if (!invited) throw new PurchaseOrderError(404, "The supplier is not on this price request.", "PURCHASE_RFQ_SUPPLIER_NOT_INVITED");
  if (!["draft", "sent"].includes(invited.status)) throw new PurchaseOrderError(409, "This price request is closed.", "PURCHASE_RFQ_LOCKED");
  const token = await supplierLinkToken(client, context, "rfq_supplier", invited.id, env);
  const url = supplierPageUrl(token, env);
  const company = (await client.query("SELECT COALESCE(NULLIF(legal_name, ''), name) AS name FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0]?.name ?? "";
  const body = `Price request ${invited.rfq_number}${invited.title ? ` — ${invited.title}` : ""} from ${company}. Please send your prices${invited.response_due_date ? ` by ${dayOf(invited.response_due_date)}` : ""}: ${url}`;
  const number = whatsappNumber(invited.phone) ?? "";
  return { url, body, whatsapp: `https://wa.me/${number}?text=${encodeURIComponent(body)}` };
}

// The link behind a token, with its company's tenant set; null when unknown, revoked, or Procurement is off.
async function resolve(client, token) {
  if (!TOKEN.test(String(token ?? ""))) return null;
  const found = (await client.query("SELECT * FROM tenant.procurement_resolve_document_link($1)", [hash(token)])).rows[0];
  if (!found) return null;
  await setTenantContext(client, found.organization_id);
  const enabled = (await client.query("SELECT 1 FROM public.organization_modules WHERE organization_id = $1 AND module_key = 'procurement' AND status = 'enabled'", [found.organization_id])).rows[0];
  return enabled ? found : null;
}

// The person the link acts as: whoever made the document (the record's history shows "by the supplier, through their link").
async function actingAs(client, organizationId, userId, permissions) {
  return { organizationId, userId, roleSlugs: [], permissions, supplierLink: true };
}

const companyOf = async (client, organizationId) => (await client.query("SELECT COALESCE(NULLIF(legal_name, ''), name) AS name FROM public.organizations WHERE id = $1",
  [organizationId])).rows[0]?.name ?? null;

async function tellBuyer(client, organizationId, userId, title, message, href, entityType, entityId) {
  if (!userId) return;
  await createNotification(client, { organizationId, userId, category: "procurement_supplier_answer", title, message, href, entityType, entityId }).catch(() => null);
}

// loadSupplierPage: what the supplier sees. Returns null for an unknown link.
export async function loadSupplierPage(client, token) {
  const link = await resolve(client, token);
  if (!link) return null;
  const company = await companyOf(client, link.organization_id);
  await client.query("UPDATE tenant.procurement_share_links SET view_count = view_count + 1, last_viewed_at = now() WHERE token_hash = $1", [hash(token)]);
  if (link.document_type === "purchase_order") {
    const order = (await client.query(
      `SELECT po.*, btrim(po.currency_code) AS currency, party.display_name AS supplier_name FROM tenant.purchase_orders po
         JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id WHERE po.organization_id = $1 AND po.id = $2`,
      [link.organization_id, link.document_id])).rows[0];
    if (!order || ["draft", "cancelled"].includes(order.status)) return null;
    const lines = (await client.query(
      `SELECT line.line_number, COALESCE(line.product_snapshot->>'name', line.description) AS name, line.ordered_quantity, line.unit_price,
              (SELECT COALESCE(sum(cancellation.quantity), 0) FROM tenant.purchase_order_line_cancellations cancellation
                WHERE cancellation.organization_id = line.organization_id AND cancellation.purchase_order_line_id = line.id) AS cancelled_quantity,
              line.uom_snapshot->>'code' AS unit, line.expected_delivery_date
         FROM tenant.purchase_order_lines line WHERE line.organization_id = $1 AND line.purchase_order_id = $2 ORDER BY line.line_number`, [link.organization_id, order.id])).rows;
    const invoices = (await client.query(
      `SELECT invoice_number, invoice_date, total, status, created_at FROM tenant.procurement_supplier_invoice_uploads WHERE organization_id = $1 AND purchase_order_id = $2 ORDER BY created_at DESC`,
      [link.organization_id, order.id])).rows;
    return {
      kind: "purchase_order", company,
      order: { number: order.purchase_order_number, date: dayOf(order.order_date), expectedDate: dayOf(order.expected_delivery_date), status: order.status, currencyCode: order.currency,
        total: dec(order.grand_total), supplierName: order.supplier_name, acknowledgedAt: order.acknowledged_at, proposedDate: dayOf(order.supplier_proposed_date),
        proposedNote: order.supplier_proposed_note ?? null, version: order.version_number },
      lines: lines.map((line) => ({ number: line.line_number, name: line.name, quantity: dec(decimal(line.ordered_quantity) - decimal(line.cancelled_quantity ?? 0)), unit: line.unit,
        rate: dec(line.unit_price), expectedDate: dayOf(line.expected_delivery_date) })),
      invoices: invoices.map((row) => ({ number: row.invoice_number, date: dayOf(row.invoice_date), total: dec(row.total), status: row.status, at: row.created_at })),
      actions: { confirm: order.status === "confirmed" && !order.acknowledged_at, propose: order.status === "confirmed", invoice: ["confirmed", "closed"].includes(order.status) },
    };
  }
  if (link.document_type === "rfq_supplier") {
    const invited = (await client.query(
      `SELECT invited.*, rfq.rfq_number, rfq.title, rfq.response_due_date, rfq.status AS rfq_status, btrim(rfq.currency_code) AS currency, party.display_name AS supplier_name
         FROM tenant.purchase_rfq_suppliers invited JOIN tenant.purchase_rfqs rfq ON rfq.organization_id = invited.organization_id AND rfq.id = invited.rfq_id
         JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = invited.organization_id AND supplier.id = invited.supplier_id
         JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
        WHERE invited.organization_id = $1 AND invited.id = $2`, [link.organization_id, link.document_id])).rows[0];
    if (!invited) return null;
    const lines = (await client.query(
      `SELECT line.id, line.line_number, item.name, line.description, line.quantity, uom.code AS unit, line.required_by FROM tenant.purchase_rfq_lines line
         JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
         LEFT JOIN tenant.units_of_measure uom ON uom.organization_id = line.organization_id AND uom.id = line.uom_id
        WHERE line.organization_id = $1 AND line.rfq_id = $2 ORDER BY line.line_number`, [link.organization_id, invited.rfq_id])).rows;
    const quoted = (await client.query(
      `SELECT quotation_number, created_at FROM tenant.supplier_quotations WHERE organization_id = $1 AND rfq_id = $2 AND supplier_id = $3 AND status <> 'cancelled' LIMIT 1`,
      [link.organization_id, invited.rfq_id, invited.supplier_id])).rows[0];
    return {
      kind: "rfq", company,
      rfq: { number: invited.rfq_number, title: invited.title, dueDate: dayOf(invited.response_due_date), currencyCode: invited.currency ?? "INR", supplierName: invited.supplier_name,
        status: invited.rfq_status, quotedAt: quoted?.created_at ?? null, quotationNumber: quoted?.quotation_number ?? null },
      lines: lines.map((line) => ({ id: line.id, number: line.line_number, name: line.name, description: line.description, quantity: dec(line.quantity), unit: line.unit,
        requiredBy: dayOf(line.required_by) })),
      actions: { quote: invited.rfq_status === "sent" && !quoted },
    };
  }
  return null;
}

// The supplier confirms the order, or proposes another delivery date. input: { action: "confirm" | "propose", date?, note?, name? }
export async function answerOrderOnSupplierPage(client, token, input = {}) {
  const link = await resolve(client, token);
  if (!link || link.document_type !== "purchase_order") throw new PurchaseOrderError(404, "This link is not valid.", "SUPPLIER_LINK_INVALID");
  const order = (await client.query(`SELECT * FROM tenant.purchase_orders WHERE organization_id = $1 AND id = $2 FOR UPDATE`, [link.organization_id, link.document_id])).rows[0];
  if (!order || order.status !== "confirmed") throw new PurchaseOrderError(409, "This order can no longer be answered here.", "SUPPLIER_LINK_CLOSED");
  const who = text(input.name, 120);
  const note = text(input.note, 1000);
  const buyer = order.buyer_user_id ?? order.created_by;
  const context = await actingAs(client, link.organization_id, buyer, ["procurement.view", "procurement.po.view", "procurement.po.view_all"]);
  const href = `/procurement/purchase-orders/${order.id}`;
  if (input.action === "confirm") {
    if (order.acknowledged_at) return { confirmed: true, replayed: true };
    await client.query(
      `INSERT INTO tenant.purchase_order_communications (organization_id, purchase_order_id, version_number, kind, channel, note, recorded_by)
       VALUES ($1, $2, $3, 'acknowledged', 'supplier_link', $4, NULL)`, [link.organization_id, order.id, order.version_number, [who ? `By ${who}` : null, note].filter(Boolean).join(" · ") || null]);
    await client.query(`UPDATE tenant.purchase_orders SET communication_status = 'acknowledged', acknowledged_at = now(), acknowledgement_reference = $3, updated_at = now()
        WHERE organization_id = $1 AND id = $2`, [link.organization_id, order.id, who ? `Supplier's page: ${who}` : "Supplier's page"]);
    await recordPoEvent(client, context, order.id, "purchase_order.acknowledged", `The supplier confirmed version ${order.version_number} on their page${who ? ` (${who})` : ""}`, { details: { via: "supplier_link", note } });
    await tellBuyer(client, link.organization_id, buyer, `${order.purchase_order_number} confirmed by the supplier`, note ?? "Confirmed on the supplier's page.", href, "procurement.purchase_order", order.id);
    return { confirmed: true, replayed: false };
  }
  if (input.action === "propose") {
    const date = readDate(input.date, "Delivery date");
    if (!date) fail("Choose the date you can deliver.", "date", "SUPPLIER_LINK_DATE_REQUIRED");
    await client.query(`UPDATE tenant.purchase_orders SET supplier_proposed_date = $3, supplier_proposed_note = $4, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [link.organization_id, order.id, date, note]);
    await recordPoEvent(client, context, order.id, "purchase_order.date_proposed", `The supplier proposed delivery on ${date}${who ? ` (${who})` : ""}${note ? `: ${note}` : ""}`,
      { details: { via: "supplier_link", date, note } });
    await tellBuyer(client, link.organization_id, buyer, `${order.purchase_order_number}: the supplier proposes ${date}`, note ?? "Proposed on the supplier's page. Change the order if you agree.",
      href, "procurement.purchase_order", order.id);
    return { proposed: date };
  }
  fail("Choose what to do.", "action");
}

// The supplier's prices for a price request. input: { lines: [{ rfqLineId, unitPrice, discountPercent? }], validUntil?, leadDays?, freight?, reference?, note?, name? }
export async function quoteOnSupplierPage(client, token, input = {}) {
  const link = await resolve(client, token);
  if (!link || link.document_type !== "rfq_supplier") throw new PurchaseOrderError(404, "This link is not valid.", "SUPPLIER_LINK_INVALID");
  const invited = (await client.query(`SELECT invited.*, rfq.created_by AS rfq_created_by, rfq.rfq_number FROM tenant.purchase_rfq_suppliers invited
      JOIN tenant.purchase_rfqs rfq ON rfq.organization_id = invited.organization_id AND rfq.id = invited.rfq_id WHERE invited.organization_id = $1 AND invited.id = $2`,
    [link.organization_id, link.document_id])).rows[0];
  if (!invited) throw new PurchaseOrderError(404, "This link is not valid.", "SUPPLIER_LINK_INVALID");
  const lines = (Array.isArray(input.lines) ? input.lines : []).filter((line) => isUuid(line.rfqLineId) && String(line.unitPrice ?? "").trim() !== "").map((line) => {
    const price = String(line.unitPrice).replace(/,/g, "").trim();
    if (!/^\d+(\.\d{1,4})?$/.test(price)) fail("Enter each price as a number.", "lines", "SUPPLIER_LINK_PRICE_INVALID");
    const discount = String(line.discountPercent ?? "").trim();
    if (discount && (!/^\d+(\.\d{1,2})?$/.test(discount) || Number(discount) >= 100)) fail("A discount is a percentage below 100.", "lines", "SUPPLIER_LINK_PRICE_INVALID");
    return { rfqLineId: line.rfqLineId, unitPrice: price, ...(discount && Number(discount) > 0 ? { discountType: "percent", discountValue: discount } : {}) };
  });
  if (!lines.length) fail("Enter your price for at least one item.", "lines", "SUPPLIER_LINK_NO_PRICES");
  const who = text(input.name, 120);
  const { recordRfqQuotation } = await import("../rfqs/index.js");
  const context = await actingAs(client, link.organization_id, invited.rfq_created_by, ["procurement.view", "procurement.po.view", "procurement.po.view_all", PO_PERMISSIONS.create,
    PO_PERMISSIONS.quotations].filter(Boolean));
  const leadDays = input.leadDays === undefined || input.leadDays === "" ? undefined : Number(input.leadDays);
  if (leadDays !== undefined && (!Number.isInteger(leadDays) || leadDays < 0 || leadDays > 365)) fail("The lead time is a whole number of days.", "leadDays");
  const freight = input.freight === undefined || input.freight === "" ? undefined : String(input.freight).replace(/,/g, "").trim();
  if (freight !== undefined && !/^\d+(\.\d{1,2})?$/.test(freight)) fail("Enter the freight as a number.", "freight");
  const recorded = await recordRfqQuotation(client, context, invited.rfq_id, {
    supplierId: invited.supplier_id, supplierReference: text(input.reference, 100) ?? undefined, validUntil: readDate(input.validUntil, "Valid until") ?? undefined,
    deliveryLeadDays: leadDays, freightAmount: freight, notes: [who ? `Sent by ${who} on the supplier's page` : "Sent on the supplier's page", text(input.note, 1000)].filter(Boolean).join(". "), lines,
  });
  await tellBuyer(client, link.organization_id, invited.rfq_created_by, `${invited.rfq_number}: prices received`, `The supplier sent prices on their page${who ? ` (${who})` : ""}.`,
    `/procurement/rfqs/${invited.rfq_id}`, "procurement.rfq", invited.rfq_id);
  return { quotationId: recorded.id ?? recorded.quotationId ?? null };
}

// The supplier sends their invoice for the order: the file is kept on the order, and a draft bill is made when the order has something to
// bill now (else the invoice waits for Accounts Payable). prepared: prepareFileUpload's result (made outside the transaction).
// input: { invoiceNumber, invoiceDate, total?, name? }
export async function uploadInvoiceOnSupplierPage(client, token, input = {}, prepared) {
  const link = await resolve(client, token);
  if (!link || link.document_type !== "purchase_order") throw new PurchaseOrderError(404, "This link is not valid.", "SUPPLIER_LINK_INVALID");
  const order = (await client.query(`SELECT * FROM tenant.purchase_orders WHERE organization_id = $1 AND id = $2`, [link.organization_id, link.document_id])).rows[0];
  if (!order || !["confirmed", "closed"].includes(order.status)) throw new PurchaseOrderError(409, "Invoices for this order are not taken here.", "SUPPLIER_LINK_CLOSED");
  const count = Number((await client.query(`SELECT count(*)::int AS n FROM tenant.procurement_supplier_invoice_uploads WHERE organization_id = $1 AND purchase_order_id = $2`,
    [link.organization_id, order.id])).rows[0].n);
  if (count >= 20) throw new PurchaseOrderError(409, "This order has had many invoices sent already. Send the next one to the buyer.", "SUPPLIER_LINK_LIMIT");
  const invoiceNumber = text(input.invoiceNumber, 50);
  if (!invoiceNumber) fail("Enter your invoice number.", "invoiceNumber", "SUPPLIER_LINK_INVOICE_NUMBER");
  const invoiceDate = readDate(input.invoiceDate, "Invoice date");
  if (!invoiceDate) fail("Enter your invoice date.", "invoiceDate", "SUPPLIER_LINK_INVOICE_DATE");
  const total = input.total === undefined || input.total === "" ? null : String(input.total).replace(/,/g, "").trim();
  if (total !== null && !/^\d+(\.\d{1,2})?$/.test(total)) fail("Enter the invoice total as a number.", "total");
  if (!prepared) fail("Attach your invoice (PDF or a photo).", "file", "SUPPLIER_LINK_FILE_REQUIRED");
  const buyer = order.buyer_user_id ?? order.created_by;
  const file = await storeFile(client, { organizationId: link.organization_id, entityType: PO_FILE_ENTITY, entityId: order.id, prepared, uploadedBy: buyer });
  // A draft bill for what the order can bill now, as Accounts Payable would start it; they check it against the file and finalise.
  let billId = null;
  let status = "waiting";
  let reason = null;
  await client.query("SAVEPOINT supplier_invoice_bill");
  try {
    const { getBillablePurchaseOrderQuantity } = await import("../supplier-bills/sources.js");
    const ap = { organizationId: link.organization_id, userId: buyer, roleSlugs: [], permissions: ["procurement.view", "procurement.po.view", "procurement.po.view_all", "procurement.bills.view",
      "procurement.bills.create", "procurement.bills.manage"] };
    const eligibility = await getBillablePurchaseOrderQuantity(client, ap, order.id);
    const billable = (eligibility?.lines ?? []).filter((line) => Number(line.remainingToBill ?? 0) > 0);
    if (!billable.length) throw new Error("Nothing on the order can be billed yet (goods not received).");
    const { createSupplierBill } = await import("../supplier-bills/bills.js");
    const bill = await createSupplierBill(client, ap, { sourceType: "purchase_order", purchaseOrderId: order.id, supplierInvoiceNumber: invoiceNumber, supplierInvoiceDate: invoiceDate,
      supplierInvoiceTotal: total ?? undefined, notes: "Started from the invoice the supplier sent on their page.",
      lines: billable.map((line) => ({ purchaseOrderLineId: line.purchaseOrderLineId, quantity: String(line.remainingToBill) })) });
    billId = bill.id;
    status = "draft_bill";
    await client.query("RELEASE SAVEPOINT supplier_invoice_bill");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT supplier_invoice_bill");
    reason = error instanceof Error ? error.message : String(error);
  }
  await client.query(
    `INSERT INTO tenant.procurement_supplier_invoice_uploads (organization_id, purchase_order_id, invoice_number, invoice_date, total, file_id, vendor_bill_id, status, note, sent_by_name)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [link.organization_id, order.id, invoiceNumber, invoiceDate, total, file.id, billId, status, reason, text(input.name, 120)]);
  const context = await actingAs(client, link.organization_id, buyer, ["procurement.view"]);
  await recordPoEvent(client, context, order.id, "purchase_order.supplier_invoice", `The supplier sent invoice ${invoiceNumber} of ${invoiceDate} on their page${billId ? "; a draft bill was started" : ""}`,
    { details: { invoiceNumber, invoiceDate, total, billId, fileId: file.id } });
  await tellBuyer(client, link.organization_id, buyer, `${order.purchase_order_number}: supplier invoice ${invoiceNumber}`, billId ? "A draft bill is ready to check." : `Waiting for a bill: ${reason}`,
    billId ? `/procurement/supplier-bills/${billId}` : `/procurement/purchase-orders/${order.id}`, "procurement.purchase_order", order.id);
  return { status, draftBill: Boolean(billId) };
}

// For the order page: what the supplier did on their page.
export async function supplierPageActivity(client, context, orderId) {
  const order = await loadPurchaseOrder(client, context, orderId);
  const uploads = (await client.query(
    `SELECT upload.invoice_number, upload.invoice_date, upload.total, upload.status, upload.note, upload.vendor_bill_id, upload.file_id, upload.created_at, bill.bill_number
       FROM tenant.procurement_supplier_invoice_uploads upload LEFT JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = upload.organization_id AND bill.id = upload.vendor_bill_id
      WHERE upload.organization_id = $1 AND upload.purchase_order_id = $2 ORDER BY upload.created_at DESC`, [context.organizationId, order.id])).rows;
  const link = (await client.query(`SELECT view_count, last_viewed_at FROM tenant.procurement_share_links WHERE organization_id = $1 AND document_type = 'purchase_order' AND document_id = $2 AND revoked_at IS NULL`,
    [context.organizationId, order.id])).rows[0];
  const reminders = (await client.query(`SELECT kind, run_on, status, recipients FROM tenant.procurement_receipt_reminder_log WHERE organization_id = $1 AND purchase_order_id = $2
      AND status IN ('sent', 'previewed') ORDER BY created_at DESC`, [context.organizationId, order.id])).rows;
  return {
    reminders: reminders.map((row) => ({ kind: row.kind, runOn: dayOf(row.run_on), status: row.status, recipients: row.recipients })),
    views: link?.view_count ?? 0, lastViewedAt: link?.last_viewed_at ?? null, proposedDate: dayOf(order.supplier_proposed_date), proposedNote: order.supplier_proposed_note ?? null,
    invoices: uploads.map((row) => ({ number: row.invoice_number, date: dayOf(row.invoice_date), total: dec(row.total), status: row.status, note: row.note, billId: row.vendor_bill_id,
      billNumber: row.bill_number, fileId: row.file_id, at: row.created_at })),
  };
}
