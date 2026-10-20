// Inbound email -> Support (email-to-ticket: modules/support/desk/sd-mail.js — blocked senders, loops, bounces, duplicates, threading,
// reopening and follow-ups, sender matching, acknowledgement) or CRM (email to lead, CRM plan 3.1: modules/crm/email/inbound.js), connecting
// the platform inbound-mail receipt to each module's own delivery. Attachments go through the Shared Platform upload pipeline (validation +
// malware scan); a rejected attachment is noted, not fatal.
//
// Authority: the route's narrow machine authority (see the threaded ticket, create a ticket, add an
// inbound customer message) recorded as the route's configured member; the
// organisation comes only from the route. Business writes still
// follow module enablement, plan entitlement and billing write access.
import { requireBillingWriteAccess, getBillingSummary } from "../../core/billing/index.js";
import { prepareSupportAttachmentUpload } from "../../modules/support/desk/index.js";
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
import { entitlementFromBillingSummary, getEnabledModuleKeys } from "../../core/access/index.js";
import { deliverEmailToSupport } from "../../modules/support/desk/sd-mail.js";
import { prepareAttachmentUpload as prepareCrmAttachment } from "../../modules/crm/attachments/records.js";
import { deliverInboundEmailToCrm } from "../../modules/crm/email/inbound.js";

const MAX_RAW_BODY = 30 * 1024 * 1024;

// CRM keeps only the file types its records accept; Support takes what the platform's upload pipeline accepts.
async function prepareAttachments(message, env, target = "support.email_to_ticket") {
  const prepared = [];
  const notes = [];
  for (const attachment of message.attachments) {
    try {
      const bytes = Buffer.from(attachment.contentBase64, "base64");
      prepared.push(target === "crm.email_to_lead"
        ? await prepareCrmAttachment({ fileName: attachment.fileName, bytes }, env)
        : await prepareSupportAttachmentUpload({ fileName: attachment.fileName, mimeType: attachment.contentType, bytes }, env));
      notes.push({ fileName: attachment.fileName, status: "accepted" });
    } catch (error) {
      notes.push({ fileName: attachment.fileName, status: "rejected", reason: error?.code || "FILE_INVALID" });
    }
  }
  return { prepared, notes };
}

async function assertModuleAvailable(client, organizationId, env, moduleKey = "support") {
  const label = moduleKey === "crm" ? "CRM" : "Support";
  const enabled = await getEnabledModuleKeys(client, organizationId);
  if (!enabled.has(moduleKey)) throw new InboundMailError(409, `${label} is not enabled for this organisation.`, "PLATFORM_INBOUND_MAIL_TARGET_UNAVAILABLE");
  let billing = null;
  try {
    billing = await getBillingSummary(client, organizationId, env);
  } catch {
    billing = null;
  }
  const { entitled, enforced } = entitlementFromBillingSummary(billing, moduleKey);
  if (!entitled && enforced) throw new InboundMailError(409, `${label} is not included in this organisation's plan.`, "PLATFORM_INBOUND_MAIL_TARGET_UNAVAILABLE");
  await requireBillingWriteAccess(client, organizationId, env);
}

/**
 * The whole inbound flow for one provider POST. `runPlatform(work)` (no
 * organisation yet: only the route lookup) and `runTenant(organizationId,
 * work)` each run `work` in their own short transaction; attachment
 * scanning happens between them, outside both.
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
  const { event, replayed } = await runTenant(route.organization_id, (client) => recordInboundMailEvent(client, { route, message, payloadDigest: inboundPayloadDigest(rawBody) }));
  if (replayed && event.status === "processed")
    return { eventId: event.id, replayed: true, outcome: event.outcome, ticketId: event.ticket_id, recordType: event.record_type ?? null, recordId: event.record_id ?? null };

  const crm = route.target === "crm.email_to_lead";
  const { prepared, notes } = await prepareAttachments(message, env, route.target);
  try {
    const result = await runTenant(route.organization_id, async (client) => {
      await assertModuleAvailable(client, route.organization_id, env, crm ? "crm" : "support");
      const delivered = crm
        ? await deliverInboundEmailToCrm(client, route, message, prepared, { inboundEventId: event.id })
        : await deliverEmailToSupport(client, route, message, prepared, { env });
      await completeInboundMailEvent(client, event.id, { status: "processed", ...delivered, attachmentNotes: notes });
      return delivered;
    });
    return { eventId: event.id, replayed, ...result };
  } catch (error) {
    await runTenant(route.organization_id, (client) => completeInboundMailEvent(client, event.id, { status: "failed", error: error?.message || String(error), attachmentNotes: notes }));
    throw error;
  }
}
