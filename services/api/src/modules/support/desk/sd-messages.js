// Support — the ticket desk: messages. Each message is its own record (never one editable conversation field):
//   CUSTOMER  what the customer wrote (from email, or logged by an agent from a call); never edited.
//   REPLY     an agent's reply, emailed through an authorized support mailbox. It carries its own Message-ID and answers the customer's
//             thread (In-Reply-To / References, the ticket number in the subject), so their next email joins the same ticket. Its delivery
//             state is the mail queue's: queued (Sending) → sent to the mail server, failed or bounced — never "delivered" because a send
//             call returned; a failed or unconfigured send stays visible and can be retried.
//   NOTE      a private, staff-only note: never emailed (the database refuses a note with recipients or a delivery).
//   SYSTEM    the automatic acknowledgement of a new email ticket.
// Attachments are Shared Platform files on the ticket, optionally on one message; a note's files are private like the note.
import { randomUUID } from "node:crypto";

import { archiveFile, prepareFileUpload, readFileContent, storeFile } from "../../../core/platform/files/index.js";
import { queueSupportReply } from "../../../core/platform/mail/outbox.js";
import { ACTIVE, P, email, has, need, sdError, text, uuid, uuidOrNull } from "./sd-rules.js";
import { EVENT, loadTicket, moveTicket } from "./sd-tickets.js";

const DELIVERY_OF = { queued: "QUEUED", sending: "QUEUED", sent: "SENT", failed: "FAILED", bounced: "BOUNCED", not_configured: "FAILED" };
// The delivery state of every reply on a ticket, refreshed from the mail queue (the authority on what happened to each email).
export async function syncDeliveries(client, c, ticketId) {
  const rows = (await client.query(`SELECT m.id, m.delivery_status, l.status, l.last_error, l.sent_at FROM tenant.support_communications m JOIN public.mail_log l ON l.id = m.mail_log_id
      WHERE m.organization_id = $1 AND m.ticket_id = $2 AND m.delivery_status IN ('QUEUED', 'SENT', 'FAILED')`, [c.organizationId, ticketId])).rows;
  for (const r of rows) {
    const next = DELIVERY_OF[r.status] ?? r.delivery_status;
    if (next !== r.delivery_status) await client.query(`UPDATE tenant.support_communications SET delivery_status = $2, delivery_error = $3, sent_at = COALESCE(sent_at, $4) WHERE id = $1`,
      [r.id, next, next === "FAILED" || next === "BOUNCED" ? r.last_error : null, r.sent_at]);
  }
}

// The authorized mailbox a reply goes out from: the one chosen, else the ticket's, else the company's only active one.
async function mailboxFor(client, c, ticket, chosen) {
  const id = uuidOrNull(chosen, "Mailbox") ?? ticket.mailbox_id;
  const rows = id ? (await client.query(`SELECT * FROM tenant.support_mailboxes WHERE organization_id = $1 AND id = $2 AND status = 'active'`, [c.organizationId, id])).rows
    : (await client.query(`SELECT * FROM tenant.support_mailboxes WHERE organization_id = $1 AND status = 'active' ORDER BY created_at LIMIT 2`, [c.organizationId])).rows;
  if (rows.length !== 1) throw sdError(409, "SUPPORT_MAILBOX_REQUIRED");
  return rows[0];
}
// The thread an email answers: the latest customer message, and every message id of the conversation.
async function threadOf(client, ticketId) {
  const rows = (await client.query(`SELECT kind, external_message_id FROM tenant.support_communications WHERE ticket_id = $1 AND external_message_id IS NOT NULL AND kind IN ('CUSTOMER', 'REPLY', 'SYSTEM')
      ORDER BY created_at`, [ticketId])).rows;
  return { inReplyTo: [...rows].reverse().find((r) => r.kind === "CUSTOMER")?.external_message_id ?? rows.at(-1)?.external_message_id ?? null,
    references: rows.map((r) => r.external_message_id).slice(-20) };
}
const subjectFor = (ticket) => `Re: ${ticket.subject.replace(/^(re|fw|fwd):\s*/i, "").replace(/\s*\[[A-Z0-9/_-]+-\d+\]\s*$/, "")} [${ticket.ticket_number}]`.slice(0, 250);

// Queues one email on the ticket and records it as a message. kind REPLY (an agent) or SYSTEM (an acknowledgement).
export async function emailOnTicket(client, c, ticket, { mailbox, body, kind = "REPLY", cc = [], key = null, env = process.env }) {
  const to = email(ticket.customer_email);
  if (!to) throw sdError(409, "SUPPORT_RECIPIENT_REQUIRED");
  const domain = mailbox.address.split("@")[1];
  const messageId = `<tkt-${ticket.ticket_number.toLowerCase()}-${randomUUID()}@${domain}>`;
  const thread = await threadOf(client, ticket.id);
  const subject = subjectFor(ticket);
  const full = mailbox.signature && kind === "REPLY" ? `${body}\n\n-- \n${mailbox.signature}` : body;
  const queued = await queueSupportReply(client, { organizationId: c.organizationId, to: [to], cc, subject, text: full, replyTo: mailbox.address,
    fromName: mailbox.display_name || mailbox.name, messageId, inReplyTo: thread.inReplyTo, references: thread.references }, env);
  const configured = queued.status === "queued";
  const row = (await client.query(`INSERT INTO tenant.support_communications (organization_id, ticket_id, direction, channel, kind, subject, body, sender_name, sender_address, recipient_address,
      to_addresses, cc_addresses, external_message_id, in_reply_to, reference_ids, private_note, delivery_status, delivery_error, mail_log_id, mailbox_id, idempotency_key, created_by)
    VALUES ($1,$2,'outbound','email',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,false,$14,$15,$16,$17,$18,$19) RETURNING *`,
  [c.organizationId, ticket.id, kind, subject, full, mailbox.display_name || mailbox.name, mailbox.address, to, [to], cc, messageId, thread.inReplyTo, thread.references,
    configured ? "QUEUED" : "FAILED", configured ? null : "No mail transport is configured: the email was not sent.", queued.id, mailbox.id, key, c.userId ?? null])).rows[0];
  return row;
}

// input: { body, mailboxId?, cc?: string[], waitForCustomer?: boolean, idempotencyKey?, version? }
export async function replyToCustomer(client, c, id, input = {}, env = process.env) {
  need(c, P.reply);
  const key = text(input.idempotencyKey, 200) || null;
  if (key) {
    const prior = (await client.query(`SELECT id, ticket_id FROM tenant.support_communications WHERE organization_id = $1 AND idempotency_key = $2`, [c.organizationId, key])).rows[0];
    if (prior) return { id: prior.id, ticketId: prior.ticket_id, replayed: true };
  }
  let ticket = await loadTicket(client, c, id, { lock: true });
  if (!ACTIVE.includes(ticket.status)) throw sdError(409, "SUPPORT_TICKET_STATE", "Reopen the ticket before replying.");
  const body = text(input.body, 20000);
  if (!body) throw sdError(400, "SUPPORT_MESSAGE_INVALID");
  const cc = (Array.isArray(input.cc) ? input.cc : []).map(email).filter(Boolean).slice(0, 10);
  const mailbox = await mailboxFor(client, c, ticket, input.mailboxId);
  const row = await emailOnTicket(client, c, ticket, { mailbox, body, cc, key, env });
  // The first reply answers the ticket; a new ticket becomes the replier's.
  await client.query(`UPDATE tenant.support_tickets SET first_responded_at = COALESCE(first_responded_at, clock_timestamp()), last_agent_reply_at = clock_timestamp(),
      assigned_user_id = COALESCE(assigned_user_id, $2), mailbox_id = COALESCE(mailbox_id, $3), updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`,
  [ticket.id, c.userId ?? null, mailbox.id]);
  ticket = await loadTicket(client, c, ticket.id, { lock: true });
  if (ticket.status === "new") ticket = await moveTicket(client, c, ticket, "open", "Replied");
  if (input.waitForCustomer === true) await moveTicket(client, c, ticket, "pending_customer", "Waiting for the customer's answer");
  await EVENT(client, c, ticket.id, "replied", { messageId: row.id, delivery: row.delivery_status });
  return { id: row.id, delivery: row.delivery_status, error: row.delivery_error };
}
// A failed or bounced reply sent again (a new attempt in the mail queue; the earlier failure stays in the delivery log).
export async function retryReply(client, c, id, input = {}, env = process.env) {
  need(c, P.reply);
  const ticket = await loadTicket(client, c, id, { lock: true });
  await syncDeliveries(client, c, ticket.id);
  const msg = (await client.query(`SELECT * FROM tenant.support_communications WHERE organization_id = $1 AND ticket_id = $2 AND id = $3 FOR UPDATE`,
    [c.organizationId, ticket.id, uuid(input.messageId, "Message")])).rows[0];
  if (!msg || msg.kind !== "REPLY") throw sdError(404, "SUPPORT_TICKET_NOT_FOUND", "That reply was not found.");
  if (!["FAILED", "BOUNCED"].includes(msg.delivery_status)) throw sdError(409, "SUPPORT_TICKET_STATE", "Only a failed or bounced reply is sent again.");
  const mailbox = await mailboxFor(client, c, ticket, msg.mailbox_id);
  const queued = await queueSupportReply(client, { organizationId: c.organizationId, to: msg.to_addresses, cc: msg.cc_addresses, subject: msg.subject, text: msg.body, replyTo: mailbox.address,
    fromName: mailbox.display_name || mailbox.name, messageId: msg.external_message_id, inReplyTo: msg.in_reply_to, references: msg.reference_ids }, env);
  await client.query(`UPDATE tenant.support_communications SET mail_log_id = $2, delivery_status = $3, delivery_error = $4 WHERE id = $1`,
    [msg.id, queued.id, queued.status === "queued" ? "QUEUED" : "FAILED", queued.status === "queued" ? null : "No mail transport is configured: the email was not sent."]);
  await EVENT(client, c, ticket.id, "reply_retried", { messageId: msg.id });
  return { id: msg.id, delivery: queued.status === "queued" ? "QUEUED" : "FAILED" };
}

// input: { body } — a staff-only note; never emailed.
export async function addPrivateNote(client, c, id, input = {}) {
  need(c, P.note, P.communicate);
  const ticket = await loadTicket(client, c, id, { lock: true });
  if (ticket.status === "cancelled") throw sdError(409, "SUPPORT_TICKET_STATE");
  const body = text(input.body, 20000);
  if (!body) throw sdError(400, "SUPPORT_MESSAGE_INVALID");
  const row = (await client.query(`INSERT INTO tenant.support_communications (organization_id, ticket_id, direction, channel, kind, body, private_note, created_by)
      VALUES ($1,$2,'internal','internal','NOTE',$3,true,$4) RETURNING id`, [c.organizationId, ticket.id, body, c.userId ?? null])).rows[0];
  await client.query(`UPDATE tenant.support_tickets SET updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [ticket.id]);
  await EVENT(client, c, ticket.id, "note_added", { messageId: row.id });
  return { id: row.id };
}
// input: { body, channel? (phone | chat | web), receivedAt? } — what the customer said outside email, logged by an agent.
export async function logCustomerMessage(client, c, id, input = {}) {
  need(c, P.communicate, P.reply);
  const ticket = await loadTicket(client, c, id, { lock: true });
  if (!ACTIVE.includes(ticket.status)) throw sdError(409, "SUPPORT_TICKET_STATE", "Reopen the ticket first.");
  const body = text(input.body, 20000);
  if (!body) throw sdError(400, "SUPPORT_MESSAGE_INVALID");
  const channel = ["phone", "chat", "web"].includes(input.channel) ? input.channel : "phone";
  const row = (await client.query(`INSERT INTO tenant.support_communications (organization_id, ticket_id, direction, channel, kind, body, sender_name, private_note, delivery_status, received_at, created_by)
      VALUES ($1,$2,'inbound',$3,'CUSTOMER',$4,$5,false,'RECEIVED',clock_timestamp(),$6) RETURNING id`, [c.organizationId, ticket.id, channel, body, ticket.customer_name, c.userId ?? null])).rows[0];
  await client.query(`UPDATE tenant.support_tickets SET last_customer_message_at = clock_timestamp(), updated_at = clock_timestamp(), row_version = row_version + 1 WHERE id = $1`, [ticket.id]);
  if (ticket.status === "pending_customer") await moveTicket(client, c, await loadTicket(client, c, ticket.id, { lock: true }), "open", "The customer answered");
  await EVENT(client, c, ticket.id, "customer_message_logged", { channel });
  return { id: row.id };
}

// ------------------------------------------------------------------ attachments (Shared Platform files on the ticket)
const TYPES = Object.freeze({ pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", heic: "image/heic", csv: "text/csv",
  txt: "text/plain", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
// The file's type comes from its extension (a customer's mail client often sends none): photos, PDFs, text, CSV, Excel and Word.
export async function prepareTicketAttachmentUpload({ fileName, mimeType, bytes }, env = process.env) {
  const extension = (/\.([a-z0-9]{1,10})$/i.exec(text(fileName, 240))?.[1] ?? "").toLowerCase();
  const type = TYPES[extension] ?? (Object.values(TYPES).includes(String(mimeType ?? "").toLowerCase()) ? String(mimeType).toLowerCase() : null);
  if (!type) throw sdError(400, "SUPPORT_TICKET_INVALID", "Attach a photo, a PDF, or a text, CSV, Excel or Word file.");
  return prepareFileUpload({ fileName, mimeType: type, bytes, maximumBytes: 25 * 1024 * 1024, allowedTypes: [...new Set(Object.values(TYPES))] }, env);
}
// input: { prepared, messageId?, private? } — opts.storage for tests.
export async function addTicketAttachment(client, c, id, input = {}, opts = {}) {
  need(c, P.reply, P.note, P.communicate, P.create);
  const ticket = await loadTicket(client, c, id);
  if (!input.prepared) throw sdError(400, "SUPPORT_TICKET_INVALID", "Upload the file itself.");
  const messageId = uuidOrNull(input.messageId, "Message");
  const message = messageId ? (await client.query(`SELECT id, kind FROM tenant.support_communications WHERE ticket_id = $1 AND id = $2`, [ticket.id, messageId])).rows[0] : null;
  if (messageId && !message) throw sdError(400, "SUPPORT_TICKET_INVALID", "That message is not on this ticket.");
  const isPrivate = input.private === true || message?.kind === "NOTE";
  const file = await storeFile(client, { organizationId: c.organizationId, entityType: "support.ticket", entityId: ticket.id, prepared: input.prepared, uploadedBy: c.userId ?? null,
    purpose: "attachment" }, { storage: opts.storage });
  await client.query(`INSERT INTO tenant.support_attachments (organization_id, ticket_id, communication_id, file_name, content_type, size_bytes, storage_key, private_note, uploaded_by, file_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [c.organizationId, ticket.id, messageId, file.fileName, file.mimeType, file.sizeBytes, `platform-file:${file.id}`, isPrivate, c.userId ?? null, file.id]);
  await EVENT(client, c, ticket.id, "attachment_added", { fileName: file.fileName, private: isPrivate });
  return { id: file.id, fileName: file.fileName };
}
export async function readTicketAttachment(client, c, id, fileIdValue, opts = {}) {
  need(c, P.view);
  const ticket = await loadTicket(client, c, id);
  const row = (await client.query(`SELECT * FROM tenant.support_attachments WHERE organization_id = $1 AND ticket_id = $2 AND file_id = $3`, [c.organizationId, ticket.id, uuid(fileIdValue, "File")])).rows[0];
  if (!row || (row.private_note && !has(c, P.note) && !has(c, P.sensitive))) throw sdError(404, "SUPPORT_TICKET_NOT_FOUND", "File not found.");
  const content = await readFileContent(client, { organizationId: c.organizationId, entityType: "support.ticket", entityId: ticket.id, fileId: row.file_id }, { storage: opts.storage });
  return { fileName: row.file_name, mimeType: row.content_type, body: content.body };
}
export async function removeTicketAttachment(client, c, id, fileIdValue) {
  need(c, P.communicate, P.manage);
  const ticket = await loadTicket(client, c, id);
  const fileId = uuid(fileIdValue, "File");
  const row = (await client.query(`SELECT a.*, m.kind FROM tenant.support_attachments a LEFT JOIN tenant.support_communications m ON m.id = a.communication_id
      WHERE a.organization_id = $1 AND a.ticket_id = $2 AND a.file_id = $3`, [c.organizationId, ticket.id, fileId])).rows[0];
  if (!row) throw sdError(404, "SUPPORT_TICKET_NOT_FOUND", "File not found.");
  if (["CUSTOMER", "REPLY", "SYSTEM"].includes(row.kind)) throw sdError(409, "SUPPORT_TICKET_STATE", "A file that came with an email stays with it.");
  await archiveFile(client, { organizationId: c.organizationId, entityType: "support.ticket", entityId: ticket.id, fileId, actorUserId: c.userId ?? null });
  await client.query(`DELETE FROM tenant.support_attachments WHERE id = $1`, [row.id]);
  await EVENT(client, c, ticket.id, "attachment_removed", { fileName: row.file_name });
  return { removed: true };
}
