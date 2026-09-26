// Inbound email -> Support (F353 email-to-ticket), connecting the platform
// inbound-mail receipt to Support's own domain functions:
//   new email          -> a new ticket (channel email) + the email as its first
//                         inbound communication;
//   reply to a thread  -> one inbound communication on that ticket (Support's
//                         own logic resumes a pending-customer ticket);
//   reply to a closed/cancelled/merged ticket -> a new ticket.
// Threading is deterministic: In-Reply-To/References message ids first, then a
// "[TKT-000123]" ticket number in the subject. Customer mail is never a
// private note. Attachments go through the Shared Platform upload pipeline
// (validation + malware scan); a rejected attachment is noted, not fatal.
//
// Authority: the route's narrow machine authority (see the threaded ticket, create a ticket, add an
// inbound customer message) recorded as the route's configured member; the
// organisation and company come only from the route. Business writes still
// follow module enablement, plan entitlement and billing write access.
import { requireBillingWriteAccess, getBillingSummary } from "../../core/billing/index.js";
import { prepareFileUpload } from "../../core/platform/files/index.js";
import {
  completeInboundMailEvent,
  inboundPayloadDigest,
  InboundMailError,
  normalizeInboundMessage,
  recordInboundMailEvent,
  resolveInboundMailRoute,
  routeSigningSecret,
  verifyInboundMailSignature,
} from "../../core/platform/integrations/inbound-mail/index.js";
import { entitlementFromBillingSummary, getEnabledModuleKeys } from "../../core/module-entitlements.js";
import { addAttachment, addCommunication, createTicket } from "../../modules/support/tickets.js";

const CLOSED = new Set(["closed", "cancelled", "merged"]);
const MAX_RAW_BODY = 30 * 1024 * 1024;

function supportAuthority(route) {
  return {
    organizationId: route.organization_id,
    companyId: route.company_id,
    userId: route.recorded_as_user_id,
    permissions: ["support.view", "support.ticket.create", "support.communication.manage"],
    roleSlugs: ["inbound_mail_route"],
  };
}

async function prepareAttachments(message, env) {
  const prepared = [];
  const notes = [];
  for (const attachment of message.attachments) {
    try {
      const bytes = Buffer.from(attachment.contentBase64, "base64");
      prepared.push(await prepareFileUpload({ fileName: attachment.fileName, mimeType: attachment.contentType, bytes, maximumBytes: 25 * 1024 * 1024 }, env));
      notes.push({ fileName: attachment.fileName, status: "accepted" });
    } catch (error) {
      notes.push({ fileName: attachment.fileName, status: "rejected", reason: error?.code || "FILE_INVALID" });
    }
  }
  return { prepared, notes };
}

async function assertSupportAvailable(client, organizationId, env) {
  const enabled = await getEnabledModuleKeys(client, organizationId);
  if (!enabled.has("support")) throw new InboundMailError(409, "Support is not enabled for this organisation.", "PLATFORM_INBOUND_MAIL_TARGET_UNAVAILABLE");
  let billing = null;
  try {
    billing = await getBillingSummary(client, organizationId, env);
  } catch {
    billing = null;
  }
  const { entitled, enforced } = entitlementFromBillingSummary(billing, "support");
  if (!entitled && enforced) throw new InboundMailError(409, "Support is not included in this organisation's plan.", "PLATFORM_INBOUND_MAIL_TARGET_UNAVAILABLE");
  await requireBillingWriteAccess(client, organizationId, env);
}

async function findThread(client, route, message) {
  if (message.references.length) {
    const { rows } = await client.query(
      `SELECT ticket.* FROM tenant.support_communications communication
         JOIN tenant.support_tickets ticket ON ticket.id = communication.ticket_id AND ticket.organization_id = communication.organization_id
        WHERE communication.organization_id=$1 AND communication.company_id=$2 AND communication.external_message_id = ANY($3::text[])
        ORDER BY communication.created_at DESC LIMIT 1`,
      [route.organization_id, route.company_id, message.references],
    );
    if (rows[0]) return rows[0];
  }
  const token = /\[([A-Z0-9/_-]{1,24}-\d{1,12})\]/.exec(message.subject)?.[1];
  if (token) {
    const { rows } = await client.query(`SELECT * FROM tenant.support_tickets WHERE organization_id=$1 AND company_id=$2 AND ticket_number=$3 LIMIT 1`, [route.organization_id, route.company_id, token]);
    if (rows[0]) return rows[0];
  }
  return null;
}

async function deliverToSupport(client, route, message, prepared) {
  const authority = supportAuthority(route);
  const duplicate = (
    await client.query(
      `SELECT id, ticket_id FROM tenant.support_communications WHERE organization_id=$1 AND company_id=$2 AND external_message_id=$3 LIMIT 1`,
      [route.organization_id, route.company_id, message.messageId],
    )
  ).rows[0];
  if (duplicate) return { outcome: "duplicate", ticketId: duplicate.ticket_id, communicationId: duplicate.id };

  const communicationInput = {
    direction: "inbound",
    channel: "email",
    subject: message.subject,
    body: message.text.trim() || "(This email had no text.)",
    senderName: message.fromName,
    senderAddress: message.from,
    recipientAddress: message.to[0] ?? null,
    externalMessageId: message.messageId,
    privateNote: false,
  };
  const thread = await findThread(client, route, message);
  let ticketId;
  let outcome;
  if (thread && !CLOSED.has(thread.status)) {
    ticketId = thread.id;
    outcome = "reply";
  } else {
    const ticket = await createTicket(client, authority, {
      subject: message.subject.slice(0, 200),
      description: (message.text.trim() || message.subject).slice(0, 8000),
      channel: "email",
      customerEmail: message.from,
      customerName: message.fromName,
      sourceReference: `email:${message.messageId}`.slice(0, 300),
    });
    ticketId = ticket.id;
    outcome = thread ? "new_ticket_after_closed" : "new_ticket";
  }
  const communication = await addCommunication(client, authority, ticketId, communicationInput);
  for (const file of prepared) {
    await addAttachment(client, authority, ticketId, { prepared: file }, { purpose: "inbound_mail", communicationId: communication.id });
  }
  return { outcome, ticketId, communicationId: communication.id };
}

/**
 * The whole inbound flow for one provider POST. `runPlatform(work)` and
 * `runTenant(organizationId, work)` each run `work` in their own short
 * transaction; attachment scanning happens between them, outside both.
 */
export async function receiveInboundMail({ runPlatform, runTenant }, { routeKey, rawBody, signature }, env = process.env) {
  if (Buffer.byteLength(rawBody) > MAX_RAW_BODY) throw new InboundMailError(413, "The inbound message is too large.", "PLATFORM_INBOUND_MAIL_TOO_LARGE");
  const route = await runPlatform((client) => resolveInboundMailRoute(client, routeKey));
  verifyInboundMailSignature(rawBody, signature, await routeSigningSecret(route, env));
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new InboundMailError(400, "The inbound message is malformed.", "PLATFORM_INBOUND_MAIL_MALFORMED");
  }
  const message = normalizeInboundMessage(payload);
  const { event, replayed } = await runPlatform((client) => recordInboundMailEvent(client, { route, message, payloadDigest: inboundPayloadDigest(rawBody) }));
  if (replayed && event.status === "processed") return { eventId: event.id, replayed: true, outcome: event.outcome, ticketId: event.ticket_id };

  const { prepared, notes } = await prepareAttachments(message, env);
  try {
    const result = await runTenant(route.organization_id, async (client) => {
      await assertSupportAvailable(client, route.organization_id, env);
      const delivered = await deliverToSupport(client, route, message, prepared);
      await completeInboundMailEvent(client, event.id, { status: "processed", ...delivered, attachmentNotes: notes });
      return delivered;
    });
    return { eventId: event.id, replayed, ...result };
  } catch (error) {
    await runPlatform((client) => completeInboundMailEvent(client, event.id, { status: "failed", error: error?.message || String(error), attachmentNotes: notes }));
    throw error;
  }
}
