// Bills by email (report Phase 3): the company's bills address (Settings › Integrations › Inbound email, "Purchase bills") takes the
// suppliers' invoices. Each PDF or photo attached becomes an entry in Purchase Bills › By email: the file kept, its GST e-invoice QR read
// (document-reader.js) and checked, and the supplier found by the QR's GSTIN or the sender's email. "Make bill" opens the bill form with
// the invoice number, date, total, IRN and supplier filled in; saving the bill moves the file onto it. An entry that is not a bill is
// set aside with a reason.
import { randomUUID } from "node:crypto";

import { readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { requirePoPermission } from "../purchase-orders/access.js";
import { BILL_PERMISSIONS, SupplierBillError, requireUuid, text } from "./constants.js";
import { irnInText, readBillDocument } from "./document-reader.js";
import { checkEInvoiceQr } from "./einvoice.js";

export const BILL_INBOX_FILE_ENTITY = "procurement.bill_inbox";
export const BILL_INBOX_TYPES = Object.freeze({ pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg" });
const extensionOf = (name) => (/\.([a-z0-9]{1,10})$/i.exec(String(name ?? ""))?.[1] ?? "").toLowerCase();
export const isBillDocument = (attachment) => Boolean(BILL_INBOX_TYPES[extensionOf(attachment.fileName)]) || /pdf|png|jpe?g/i.test(String(attachment.contentType ?? ""));

// The supplier whose own or contact email sent it, or null.
async function supplierBySender(client, organizationId, email) {
  const sender = String(email ?? "").trim().toLowerCase();
  if (!sender) return null;
  return (await client.query(
    `SELECT supplier.id FROM tenant.procurement_suppliers supplier
      WHERE supplier.organization_id = $1 AND supplier.status <> 'archived'
        AND (lower(supplier.primary_email) = $2 OR EXISTS (
              SELECT 1 FROM tenant.procurement_supplier_contacts link
                JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
               WHERE link.organization_id = supplier.organization_id AND link.supplier_id = supplier.id AND link.status = 'active' AND lower(contact.email) = $2))
      ORDER BY (supplier.status = 'active') DESC LIMIT 1`, [organizationId, sender])).rows[0]?.id ?? null;
}

// The inbound delivery: documents [{ fileName, contentType, bytes, prepared? , rejected? }] (prepared: scanned and ready to store).
// Returns { outcome, received } for the inbound mail event.
export async function deliverInboundEmailToProcurement(client, route, message, documents, { env = process.env, storage, inboundEventId = null } = {}) {
  const organizationId = route.organization_id;
  const bills = documents.filter((entry) => entry.prepared);
  if (!bills.length) return { outcome: documents.length ? "bill_files_rejected" : "no_bill_attached" };
  const sender = await supplierBySender(client, organizationId, message.from);
  const textIrn = irnInText(`${message.subject ?? ""} ${message.text ?? ""}`);
  let received = 0;
  for (const document of bills) {
    const seen = (await client.query(`SELECT 1 FROM tenant.supplier_bill_inbox WHERE organization_id = $1 AND message_id = $2 AND file_name = $3`,
      [organizationId, message.messageId, document.fileName])).rowCount;
    if (seen) continue;
    const read = readBillDocument(document.bytes, { contentType: document.contentType, fileName: document.fileName });
    let checked = null;
    const problems = [];
    if (read.qr) {
      try { checked = await checkEInvoiceQr(client, { organizationId }, { qr: read.qr }); problems.push(...checked.problems); }
      catch { problems.push("A QR code was found, but it is not a GST e-invoice QR."); }
    } else problems.push("No e-invoice QR could be read: scan it on the bill form if the invoice has one.");
    const id = randomUUID();
    const file = await storeFile(client, { organizationId, entityType: BILL_INBOX_FILE_ENTITY, entityId: id, prepared: document.prepared, uploadedBy: route.recorded_as_user_id ?? null },
      { env, storage });
    await client.query(
      `INSERT INTO tenant.supplier_bill_inbox (id, organization_id, inbound_event_id, message_id, from_email, from_name, subject, file_id, file_name, supplier_id,
         qr_read, irn, problems)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13::jsonb)`,
      [id, organizationId, inboundEventId, message.messageId, text(message.from, 320), text(message.fromName, 200), text(message.subject, 500), file.id,
        text(document.fileName, 255), checked?.supplier?.id ?? sender, checked ? JSON.stringify(checked.qr) : null, checked?.qr.irn ?? read.irn ?? textIrn,
        JSON.stringify(problems)]);
    received += 1;
  }
  return { outcome: received ? "bills_received" : "duplicate" };
}

const toEntry = (row) => ({
  id: row.id, status: row.status, receivedAt: row.received_at, fromEmail: row.from_email, fromName: row.from_name, subject: row.subject,
  fileId: row.file_id, fileName: row.file_name, supplierId: row.supplier_id, supplierName: row.supplier_name ?? null, irn: row.irn,
  qr: row.qr_read ?? null, problems: row.problems ?? [], billId: row.bill_id, billNumber: row.bill_number ?? null,
  setAsideReason: row.set_aside_reason, setAsideAt: row.set_aside_at,
});
const SELECT = `SELECT entry.*, party.display_name AS supplier_name, bill.bill_number
    FROM tenant.supplier_bill_inbox entry
    LEFT JOIN tenant.procurement_suppliers supplier ON supplier.organization_id = entry.organization_id AND supplier.id = entry.supplier_id
    LEFT JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
    LEFT JOIN tenant.accounting_vendor_bills bill ON bill.organization_id = entry.organization_id AND bill.id = entry.bill_id`;

// view: new (default) | billed | set_aside | all. Returns { rows, counts: { new }, addressReady }.
export async function listBillInbox(client, context, { view = "new", limit = 50 } = {}) {
  requirePoPermission(context, BILL_PERMISSIONS.view, "You do not have permission to view supplier bills.");
  const status = ["new", "billed", "set_aside"].includes(view) ? view : null;
  const rows = (await client.query(`${SELECT} WHERE entry.organization_id = $1 AND ($2::text IS NULL OR entry.status = $2) ORDER BY entry.received_at DESC LIMIT $3`,
    [context.organizationId, status, Math.min(200, Math.max(1, Number(limit) || 50))])).rows;
  const counts = (await client.query(`SELECT count(*) FILTER (WHERE status = 'new')::int AS new FROM tenant.supplier_bill_inbox WHERE organization_id = $1`, [context.organizationId])).rows[0];
  const address = (await client.query(`SELECT 1 FROM public.inbound_mail_routes WHERE organization_id = $1 AND target = 'procurement.bills_by_email' AND status = 'active'`,
    [context.organizationId])).rowCount > 0;
  return { rows: rows.map(toEntry), counts: { new: counts?.new ?? 0 }, addressReady: address };
}

async function loadEntry(client, context, id, { lock = false } = {}) {
  const row = (await client.query(`${SELECT} WHERE entry.organization_id = $1 AND entry.id = $2${lock ? " FOR UPDATE OF entry" : ""}`,
    [context.organizationId, requireUuid(id, "Emailed bill")])).rows[0];
  if (!row) throw new SupplierBillError(404, "That emailed bill was not found.", "BILL_INBOX_NOT_FOUND");
  return row;
}

export async function getBillInboxEntry(client, context, id) {
  requirePoPermission(context, BILL_PERMISSIONS.view, "You do not have permission to view supplier bills.");
  return toEntry(await loadEntry(client, context, id));
}

export async function readBillInboxFile(client, context, id, options = {}) {
  requirePoPermission(context, BILL_PERMISSIONS.view, "You do not have permission to view supplier bills.");
  const entry = await loadEntry(client, context, id);
  const entityType = entry.bill_id ? "procurement.supplier_bill" : BILL_INBOX_FILE_ENTITY;
  const entityId = entry.bill_id ?? entry.id;
  const file = (await client.query(`SELECT id, file_name, mime_type FROM public.attachments WHERE organization_id = $1 AND id = $2 AND archived_at IS NULL`,
    [context.organizationId, entry.file_id])).rows[0];
  if (!file) throw new SupplierBillError(404, "File not found.", "BILL_INBOX_FILE_NOT_FOUND");
  const content = await readFileContent(client, { organizationId: context.organizationId, entityType, entityId, fileId: file.id }, options);
  return { fileName: file.file_name, mimeType: file.mime_type, body: content.body };
}

// Not a bill (a statement, a duplicate, a promotion): set aside with the reason; it can be brought back.
export async function setAsideBillInboxEntry(client, context, id, input = {}) {
  requirePoPermission(context, BILL_PERMISSIONS.manage, "You do not have permission to record supplier bills.");
  const entry = await loadEntry(client, context, id, { lock: true });
  if (entry.status === "billed") throw new SupplierBillError(409, `This file is already bill ${entry.bill_number}.`, "BILL_INBOX_BILLED");
  const restore = input.restore === true;
  const reason = text(input.reason, 300);
  if (!restore && !reason) throw new SupplierBillError(400, "Say why it is not a bill.", "BILL_INBOX_REASON_REQUIRED", { issues: [{ field: "reason", message: "Give a reason." }] });
  await client.query(`UPDATE tenant.supplier_bill_inbox SET status = $3, set_aside_reason = $4, set_aside_by = $5, set_aside_at = CASE WHEN $3 = 'set_aside' THEN now() END
                       WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, entry.id, restore ? "new" : "set_aside", restore ? null : reason, restore ? null : context.userId ?? null]);
  return getBillInboxEntry(client, context, entry.id);
}

// Called by createSupplierBill when the bill was made from an emailed file: the file moves onto the bill, the entry is marked billed.
export async function claimBillInboxEntry(client, context, id, billId) {
  const entry = await loadEntry(client, context, id, { lock: true });
  if (entry.status !== "new") throw new SupplierBillError(409, entry.status === "billed" ? `This emailed file is already bill ${entry.bill_number}.` : "This emailed file was set aside; bring it back first.",
    "BILL_INBOX_NOT_OPEN");
  await client.query(`UPDATE public.attachments SET entity_type = 'procurement.supplier_bill', entity_id = $3 WHERE organization_id = $1 AND id = $2 AND entity_type = $4 AND entity_id = $5`,
    [context.organizationId, entry.file_id, String(billId), BILL_INBOX_FILE_ENTITY, String(entry.id)]);
  await client.query(`UPDATE tenant.supplier_bill_inbox SET status = 'billed', bill_id = $3, billed_by = $4, billed_at = now() WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, entry.id, billId, context.userId ?? null]);
}
