// Email replies on Sales documents (Sales report Phase 3). Each quotation, order confirmation, invoice and credit note emailed is kept
// with its message id, and goes out with the company's reply-to address (Sales settings) when one is set. An inbound-mail address set to
// "Sales: replies join their document" delivers here; a reply finds its document by the message it answers (In-Reply-To / References),
// else by a document number in its subject, and is kept against the document, shown on its thread as a note and told to its owner.
// Mail that matches no document is recorded as unmatched (the inbound address's log shows it).
import { notifyRecordOwner } from "../../core/platform/notifications/index.js";
import { addRecordComment } from "../../core/platform/record-thread/index.js";
import { SalesError } from "./index.js";

const OWNERS = Object.freeze({
  "sales.quotation": ["sales_quotations", "quotation_number", "owner_user_id"],
  "sales.order": ["sales_orders", "sales_order_number", "owner_user_id"],
});

// The reply-to address for Sales documents, or undefined (the workspace default).
export async function documentReplyTo(client, organizationId) {
  const row = (await client.query("SELECT document_reply_to FROM tenant.sales_settings WHERE organization_id = $1", [organizationId])).rows[0];
  return row?.document_reply_to || undefined;
}

// Keeps an email sent with a document. type: "sales.quotation" | "sales.order" | "sales.invoice" | "sales.credit_note".
export async function keepSentDocumentEmail(client, context, { type, id, messageId, to, subject, body }) {
  await client.query(
    `INSERT INTO tenant.sales_document_emails (organization_id, entity_type, entity_id, direction, message_id, sender, recipients, subject, body, created_by)
     VALUES ($1, $2, $3, 'out', $4, NULL, $5, $6, $7, $8)`,
    [context.organizationId, type, id, messageId ?? null, String(to ?? "").slice(0, 2000), String(subject ?? "").slice(0, 500), String(body ?? "").slice(0, 20000), context.userId ?? null]);
}

// What an inbound delivery may do: read every Sales document to file the reply on its thread, as the address's configured member.
export function salesInboundAuthority(route) {
  return {
    organizationId: route.organization_id, userId: route.recorded_as_user_id, roleSlugs: ["inbound_mail_route"],
    permissions: ["sales.view", "sales.quotation.view", "sales.quotation.view_all", "sales.order.view", "sales.order.view_all", "sales.invoice.view", "sales.invoice.view_all",
      "sales.credit_note.view", "sales.credit_note.view_all"],
  };
}

async function documentOf(client, organizationId, message) {
  if (message.references.length) {
    const row = (await client.query(
      `SELECT entity_type, entity_id FROM tenant.sales_document_emails WHERE organization_id = $1 AND message_id = ANY($2::text[]) ORDER BY created_at DESC LIMIT 1`,
      [organizationId, message.references])).rows[0];
    if (row) return { type: row.entity_type, id: row.entity_id, how: "reply" };
  }
  const tokens = [...new Set((message.subject.match(/[A-Za-z0-9][A-Za-z0-9/_-]{2,40}/g) ?? []).filter((token) => /\d/.test(token)))].slice(0, 12);
  if (!tokens.length) return null;
  const found = (await client.query(
    `SELECT 'sales.quotation' AS type, id FROM tenant.sales_quotations WHERE organization_id = $1 AND quotation_number = ANY($2::text[])
     UNION ALL SELECT 'sales.order', id FROM tenant.sales_orders WHERE organization_id = $1 AND sales_order_number = ANY($2::text[])
     UNION ALL SELECT CASE WHEN invoice_type = 'credit_note' THEN 'sales.credit_note' ELSE 'sales.invoice' END, id FROM tenant.accounting_customer_invoices
       WHERE organization_id = $1 AND invoice_number = ANY($2::text[]) AND invoice_type IN ('invoice', 'credit_note')
     LIMIT 1`, [organizationId, tokens])).rows[0];
  return found ? { type: found.type, id: found.id, how: "reference" } : null;
}

async function ownerOf(client, organizationId, document) {
  const owner = OWNERS[document.type];
  if (owner) return (await client.query(`SELECT ${owner[2]} AS owner, created_by FROM tenant.${owner[0]} WHERE organization_id = $1 AND id = $2`, [organizationId, document.id])).rows[0];
  return (await client.query("SELECT created_by AS owner, created_by FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2", [organizationId, document.id])).rows[0];
}

const HREF = Object.freeze({ "sales.quotation": "/sales/quotations/", "sales.order": "/sales/orders/", "sales.invoice": "/sales/invoices/", "sales.credit_note": "/sales/credit-notes/" });

// The inbound delivery. Returns what completeInboundMailEvent records: { outcome, recordType?, recordId? }.
export async function deliverInboundEmailToSales(client, route, message) {
  const context = salesInboundAuthority(route);
  const document = await documentOf(client, route.organization_id, message);
  if (!document) return { outcome: "unmatched" };
  const kept = (await client.query(
    `INSERT INTO tenant.sales_document_emails (organization_id, entity_type, entity_id, direction, message_id, sender, recipients, subject, body)
     VALUES ($1, $2, $3, 'in', $4, $5, NULL, $6, $7) ON CONFLICT (organization_id, message_id) WHERE direction = 'in' DO NOTHING RETURNING id`,
    [route.organization_id, document.type, document.id, message.messageId, message.fromName ? `${message.fromName} <${message.from}>` : message.from, message.subject,
      message.text.slice(0, 20000)])).rows[0];
  if (!kept) return { outcome: "duplicate", recordType: document.type, recordId: document.id };
  const files = message.attachments.length ? `\n\nAttachments (not kept; ask for them again if needed): ${message.attachments.map((file) => file.fileName).join(", ")}` : "";
  const body = `Email from ${message.fromName ? `${message.fromName} (${message.from})` : message.from}: ${message.subject}\n\n${message.text.trim().slice(0, 8000) || "(no text)"}${files}`;
  // The thread note; if the document cannot be read (removed), the email is still kept and the owner told.
  await client.query("SAVEPOINT sales_inbound_thread");
  try {
    await addRecordComment(client, context, document.type, document.id, { body: body.slice(0, 10000), kind: "note" });
    await client.query("RELEASE SAVEPOINT sales_inbound_thread");
  } catch {
    await client.query("ROLLBACK TO SAVEPOINT sales_inbound_thread");
  }
  const owner = await ownerOf(client, route.organization_id, document);
  await notifyRecordOwner(client, context, { userId: owner?.owner ?? owner?.created_by ?? null, category: "sales_document", title: `Reply from ${message.fromName || message.from}`,
    message: message.subject, href: `${HREF[document.type]}${document.id}`, entityType: document.type.replace(".", "_"), entityId: document.id }).catch(() => {});
  return { outcome: document.how === "reply" ? "reply_filed" : "filed_by_number", recordType: document.type, recordId: document.id };
}

// The emails on a document, newest first: [{ direction, sender, recipients, subject, body, at }].
export async function listDocumentEmails(client, context, type, id) {
  const rows = (await client.query(
    `SELECT direction, sender, recipients, subject, body, created_at FROM tenant.sales_document_emails WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3
      ORDER BY created_at DESC LIMIT 100`, [context.organizationId, type, id])).rows;
  return rows.map((row) => ({ direction: row.direction, sender: row.sender, recipients: row.recipients, subject: row.subject, body: row.body, at: row.created_at }));
}

// The customer side of a document (CRM parity: a record shows whom to call, message or email, and the emails with them): the contact
// on the document (else the customer) and the emails sent with it and the replies. The document is read through its own module, so
// whoever cannot see it gets nothing. Returns { contact: { name, phone, email } | null, emails }.
export async function getDocumentConversation(client, context, type, id) {
  if (!OWNERS[type] && !["sales.invoice", "sales.credit_note"].includes(type)) throw new SalesError(404, "Not available on this document.", "SALES_CONVERSATION_TYPE");
  const { recordThreadType } = await import("../../core/platform/record-thread/index.js");
  const record = await recordThreadType(type).read(client, context, id);
  const document = record?.quotation ?? record?.order ?? record?.invoice ?? record?.creditNote ?? record ?? {};
  const contact = document.contact_snapshot ?? null;
  const customer = document.sales_customer_snapshot ?? document.customer_snapshot ?? null;
  const pick = (...values) => values.find((value) => typeof value === "string" && value.trim()) ?? null;
  const name = pick(contact?.fullName, contact?.name, [contact?.firstName, contact?.lastName].filter(Boolean).join(" "), customer?.displayName);
  const phone = pick(contact?.mobile, contact?.phone, customer?.mobile, customer?.phone);
  const email = pick(contact?.email, customer?.email);
  return { contact: name || phone || email ? { name, phone, email } : null, emails: await listDocumentEmails(client, context, type, id) };
}
