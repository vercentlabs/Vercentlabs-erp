// Whether a person may be contacted by a channel. A lead marked do-not-contact is never contacted; a contact can refuse email, calls,
// SMS or WhatsApp one by one. Every way CRM reaches out — a scheduled follow-up now, an email or WhatsApp message later — asks here first.
import { optOutOf } from "./consent.js";
import { CrmError } from "./errors.js";

// The channel a follow-up or message type reaches the person by (meetings, visits and demos are arranged, not sent: no channel).
const CHANNELS = Object.freeze({ call: "call", email: "email", whatsapp: "whatsapp", sms: "sms" });
export const channelOf = (type) => CHANNELS[type] ?? null;

const CONTACT_COLUMN = Object.freeze({ call: "do_not_call", email: "do_not_email", whatsapp: "do_not_whatsapp", sms: "do_not_sms" });
const CHANNEL_WORDS = Object.freeze({ call: "calls", email: "email", whatsapp: "WhatsApp messages", sms: "SMS" });

// The reason the person may not be reached by `channel`, or null. target: { leadId?, contactId? } (either or both).
export async function doNotContactReason(client, context, { leadId = null, contactId = null }, channel) {
  if (!channel) return null;
  if (leadId) {
    const lead = (await client.query("SELECT do_not_contact, COALESCE(NULLIF(full_name, ''), company_name) AS name, email, COALESCE(mobile, phone) AS phone FROM tenant.crm_leads WHERE organization_id = $1 AND id = $2", [context.organizationId, leadId])).rows[0];
    if (lead?.do_not_contact) return `${lead.name ?? "This lead"} asked not to be contacted.`;
    // The organization's opt-out list (CRM plan 4.3): an address that opted out on any record is not reached through this one.
    if (lead && await optOutOf(client, context.organizationId, { email: channel === "email" ? lead.email : null, phone: channel === "email" ? null : lead.phone }, channel))
      return `${lead.name ?? "This person"} is on the opt-out list for ${CHANNEL_WORDS[channel]}.`;
  }
  if (contactId) {
    const column = CONTACT_COLUMN[channel];
    const contact = (await client.query(`SELECT ${column} AS refused, display_name, email, COALESCE(mobile, phone) AS phone FROM tenant.contacts WHERE organization_id = $1 AND id = $2`, [context.organizationId, contactId])).rows[0];
    if (contact?.refused) return `${contact.display_name ?? "This contact"} does not accept ${CHANNEL_WORDS[channel]}.`;
    if (contact && await optOutOf(client, context.organizationId, { email: channel === "email" ? contact.email : null, phone: channel === "email" ? null : contact.phone }, channel))
      return `${contact.display_name ?? "This person"} is on the opt-out list for ${CHANNEL_WORDS[channel]}.`;
  }
  return null;
}

// Refuses (409 CRM_DO_NOT_CONTACT) when the person may not be reached by `channel`.
export async function assertMayContact(client, context, target, channel) {
  const reason = await doNotContactReason(client, context, target, channel);
  if (reason) throw new CrmError(409, `${reason} Change their contact preferences only if they have agreed to be contacted this way.`, "CRM_DO_NOT_CONTACT", { channel });
}
