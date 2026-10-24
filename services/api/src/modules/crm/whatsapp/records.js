// WhatsApp from CRM (CRM plan 4.2).
//
//   Click-to-chat   always available: the composer opens WhatsApp (wa.me) with the message ready, and the message is logged on the
//                   record as a WhatsApp activity.
//   Cloud API       when the organization connects its WhatsApp Business number (Setup › WhatsApp): CRM sends the message itself, and
//                   the customer's replies and the delivery/read receipts come back to the webhook. A reply lands on the open lead or the
//                   contact with that number, or opens a lead from WhatsApp.
//
// WhatsApp's own rules are kept: someone who refused WhatsApp (or asked not to be contacted) is never messaged; outside 24 hours from
// the customer's last message only an approved template may be sent, and only to someone who agreed to WhatsApp messages.
import { notifyFollowers } from "../followers/records.js";
import { integrationActor } from "../data-management/system-actor.js";
import { crmIsOn } from "../data-management/crm-on.js";
import { withConsentSource } from "../data-management/consent.js";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { setTenantContext } from "@vercentlabs/database";

import { createNotification } from "../../../core/platform/notifications/index.js";
import { decryptSecret, encryptSecret } from "../../../core/platform/secrets/index.js";
import { consentPhone, optOutOf } from "../data-management/consent.js";
import { assertMayContact } from "../data-management/contact-preferences.js";
import { CrmError } from "../data-management/errors.js";
import { normalizePhone } from "../duplicates/normalize.js";
import { LEAD_PERMISSIONS } from "../leads/constants.js";
import { createLead } from "../leads/records.js";
import { recordVisible } from "../notes/access.js";
import { countOutboundMessages } from "../../../core/billing/usage.js";

const MANAGE = "crm.settings.manage";
const EDIT = Object.freeze({ lead: "crm.leads.edit", opportunity: "crm.opportunities.edit", party: "crm.accounts.edit", contact: "crm.contacts.edit" });
const TABLE = Object.freeze({ lead: "crm_leads", opportunity: "crm_opportunities", party: "business_parties", contact: "contacts" });
const HREF = Object.freeze({ lead: "/crm/leads/", opportunity: "/crm/opportunities/", party: "/crm/accounts/", contact: "/crm/contacts/" });
const WINDOW_HOURS = 24;
const STOP_WORDS = new Set(["stop", "unsubscribe", "stop all", "band", "band karo", "बंद", "बंद करो", "रोको"]);
const GRAPH = "https://graph.facebook.com/v21.0";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const text = (value) => String(value ?? "").trim();
const invalid = (field, message) => new CrmError(400, message, "CRM_WHATSAPP_VALIDATION", { issues: [{ field, message }] });
const equal = (a, b) => {
  const left = Buffer.from(String(a ?? ""));
  const right = Buffer.from(String(b ?? ""));
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
};
// WhatsApp wants the number as digits with the country code: +91 98765 43210 → 919876543210.
const waNumber = (phone) => String(phone ?? "").replace(/\D/g, "");
const e164 = (digits) => (digits ? `+${String(digits).replace(/\D/g, "")}` : null);

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, "You do not have permission to set up WhatsApp.", "PERMISSION_DENIED");
}

// ------------------------------------------------------------------ settings

async function settingsRow(client, organizationId) {
  return (await client.query("SELECT * FROM tenant.crm_whatsapp_settings WHERE organization_id = $1", [organizationId])).rows[0] ?? null;
}

export async function getWhatsAppSettings(client, context, { env = process.env } = {}) {
  const row = await settingsRow(client, context.organizationId);
  const credentials = row?.encrypted_credentials ? await decryptSecret(row.encrypted_credentials, env) : {};
  // The last 30 days on WhatsApp, as Setup shows them.
  const counts = (await client.query(
    `SELECT count(*) FILTER (WHERE direction = 'outbound')::int AS sent, count(*) FILTER (WHERE direction = 'inbound')::int AS received,
            count(*) FILTER (WHERE status = 'failed')::int AS failed
       FROM tenant.crm_whatsapp_messages WHERE organization_id = $1 AND created_at > now() - interval '30 days'`, [context.organizationId])).rows[0];
  return {
    mode: row?.mode ?? "click_to_chat", displayNumber: row?.display_number ?? null, phoneNumberId: row?.phone_number_id ?? null,
    credentialsSet: ["accessToken", "appSecret"].filter((key) => credentials[key]), webhookKeyPrefix: row?.webhook_key_prefix ?? null,
    lastReceivedAt: row?.last_received_at ?? null, lastError: row?.last_error ?? null,
    verifiedName: credentials.verifiedName ?? null, qualityRating: credentials.qualityRating ?? null,
    last30Days: { sent: counts?.sent ?? 0, received: counts?.received ?? 0, failed: counts?.failed ?? 0 },
  };
}

// Asks Meta about the business number with this ID and token: { displayNumber, verifiedName, qualityRating }, or Meta's reason.
async function askMetaForNumber(fetchImpl, phoneNumberId, accessToken) {
  let response;
  try {
    response = await fetchImpl(`${GRAPH}/${encodeURIComponent(phoneNumberId)}?fields=display_phone_number,verified_name,quality_rating`,
      { headers: { authorization: `Bearer ${accessToken}` } });
  } catch (error) {
    throw new CrmError(502, `Meta could not be reached: ${error?.message ?? error}`, "CRM_WHATSAPP_UNREACHABLE");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const reason = body?.error?.message ?? `status ${response.status}`;
    throw new CrmError(502, response.status === 401 || body?.error?.code === 190
      ? `Meta refused the access token (${reason}). Make a permanent token for a system user with whatsapp_business_messaging.`
      : `Meta does not know phone number ID ${phoneNumberId} with this token (${reason}).`, "CRM_WHATSAPP_REFUSED");
  }
  return { displayNumber: body.display_phone_number ?? null, verifiedName: body.verified_name ?? null, qualityRating: body.quality_rating ?? null };
}

// Checks the saved connection with Meta now; keeps what Meta says about the number. Returns the settings.
export async function checkWhatsAppConnection(client, context, { fetchImpl = fetch, env = process.env } = {}) {
  requireManage(context);
  const row = await settingsRow(client, context.organizationId);
  if (row?.mode !== "cloud_api") throw new CrmError(409, "WhatsApp Business API is not connected.", "CRM_WHATSAPP_NOT_CONNECTED");
  const credentials = await decryptSecret(row.encrypted_credentials, env);
  const number = await askMetaForNumber(fetchImpl, row.phone_number_id, credentials.accessToken);
  await client.query(
    `UPDATE tenant.crm_whatsapp_settings SET encrypted_credentials = $2::jsonb, display_number = COALESCE(display_number, $3), last_error = NULL, updated_at = now() WHERE organization_id = $1`,
    [context.organizationId, JSON.stringify(await encryptSecret({ ...credentials, verifiedName: number.verifiedName, qualityRating: number.qualityRating }, env)), number.displayNumber]);
  return getWhatsAppSettings(client, context, { env });
}

// input: { mode, displayNumber?, phoneNumberId?, accessToken?, appSecret? } — connecting the Cloud API returns the webhook key and the
// verify token once (to paste into Meta's app), with { webhookKey, verifyToken }. The number and token are tried with Meta first: nothing
// Meta refuses is saved, and the business number and its verified name come from Meta.
export async function saveWhatsAppSettings(client, context, input = {}, { env = process.env, fetchImpl = fetch } = {}) {
  requireManage(context);
  const row = await settingsRow(client, context.organizationId);
  const mode = input.mode === "cloud_api" ? "cloud_api" : "click_to_chat";
  const kept = row?.encrypted_credentials ? await decryptSecret(row.encrypted_credentials, env) : {};
  const credentials = { ...kept };
  for (const key of ["accessToken", "appSecret"]) if (text(input[key])) credentials[key] = text(input[key]).slice(0, 2000);
  const phoneNumberId = input.phoneNumberId === undefined ? row?.phone_number_id ?? null : text(input.phoneNumberId) || null;
  let displayNumber = input.displayNumber === undefined ? row?.display_number ?? null : text(input.displayNumber).slice(0, 40) || null;
  let webhookKey = null;
  let verifyToken = null;
  if (mode === "cloud_api") {
    if (!phoneNumberId || !/^\d{5,30}$/.test(phoneNumberId)) throw invalid("phoneNumberId", "Enter the phone number ID from WhatsApp Manager (digits).");
    if (!credentials.accessToken) throw invalid("accessToken", "Enter the access token.");
    if (!credentials.appSecret) throw invalid("appSecret", "Enter the app secret.");
    const number = await askMetaForNumber(fetchImpl, phoneNumberId, credentials.accessToken);
    credentials.verifiedName = number.verifiedName;
    credentials.qualityRating = number.qualityRating;
    if (!displayNumber && number.displayNumber) displayNumber = number.displayNumber;
    if (!credentials.verifyToken) { credentials.verifyToken = randomBytes(18).toString("base64url"); verifyToken = credentials.verifyToken; }
    if (!row?.webhook_key_hash || input.newWebhook === true) webhookKey = `wa_${randomBytes(24).toString("base64url")}`;
  }
  await client.query(
    `INSERT INTO tenant.crm_whatsapp_settings (organization_id, mode, display_number, phone_number_id, encrypted_credentials, webhook_key_hash, webhook_key_prefix, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, now())
     ON CONFLICT (organization_id) DO UPDATE SET mode = EXCLUDED.mode, display_number = EXCLUDED.display_number, phone_number_id = EXCLUDED.phone_number_id,
       encrypted_credentials = EXCLUDED.encrypted_credentials, webhook_key_hash = COALESCE(EXCLUDED.webhook_key_hash, tenant.crm_whatsapp_settings.webhook_key_hash),
       webhook_key_prefix = COALESCE(EXCLUDED.webhook_key_prefix, tenant.crm_whatsapp_settings.webhook_key_prefix), last_error = NULL, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, mode, displayNumber, phoneNumberId, JSON.stringify(await encryptSecret(credentials, env)), webhookKey ? hash(webhookKey) : null,
      webhookKey ? webhookKey.slice(0, 10) : null, context.userId ?? null]);
  return { settings: await getWhatsAppSettings(client, context, { env }), webhookKey, verifyToken: verifyToken ?? (webhookKey ? credentials.verifyToken : null) };
}

// ------------------------------------------------------------------ the record's person

// The person a record is about: their phone, name, whether they agreed to WhatsApp, and who to check refusals against (also used by
// calls and SMS, CRM plan 4.4).
export async function recordPerson(client, organizationId, type, id) {
  if (type === "lead") {
    const row = (await client.query("SELECT mobile, phone, first_name, last_name, company_name, consent_whatsapp, owner_user_id FROM tenant.crm_leads WHERE organization_id = $1 AND id = $2", [organizationId, id])).rows[0];
    return row && { phone: row.mobile ?? row.phone, name: [row.first_name, row.last_name].filter(Boolean).join(" ") || row.company_name, consented: row.consent_whatsapp, target: { leadId: id }, owner: row.owner_user_id };
  }
  if (type === "contact") {
    const row = (await client.query("SELECT whatsapp_number, mobile, phone, first_name, last_name, consent_whatsapp, owner_user_id FROM tenant.contacts WHERE organization_id = $1 AND id = $2", [organizationId, id])).rows[0];
    return row && { phone: row.whatsapp_number ?? row.mobile ?? row.phone, name: [row.first_name, row.last_name].filter(Boolean).join(" "), consented: row.consent_whatsapp, target: { contactId: id }, owner: row.owner_user_id };
  }
  if (type === "opportunity") {
    const row = (await client.query(
      `SELECT contact.id AS contact_id, COALESCE(contact.whatsapp_number, contact.mobile) AS mobile, contact.first_name, contact.last_name, contact.consent_whatsapp, deal.owner_user_id
         FROM tenant.crm_opportunities deal LEFT JOIN tenant.contacts contact ON contact.organization_id = deal.organization_id AND contact.id = deal.contact_id
        WHERE deal.organization_id = $1 AND deal.id = $2`, [organizationId, id])).rows[0];
    return row && { phone: row.mobile, name: [row.first_name, row.last_name].filter(Boolean).join(" "), consented: row.consent_whatsapp, target: { contactId: row.contact_id }, owner: row.owner_user_id };
  }
  const row = (await client.query(
    `SELECT party.phone, party.owner_user_id, contact.id AS contact_id, COALESCE(contact.whatsapp_number, contact.mobile) AS mobile, contact.first_name, contact.last_name, contact.consent_whatsapp
       FROM tenant.business_parties party
       LEFT JOIN LATERAL (SELECT * FROM tenant.contacts contact WHERE contact.organization_id = party.organization_id AND contact.party_id = party.id AND contact.status = 'active'
                            ORDER BY contact.is_primary DESC NULLS LAST, contact.created_at LIMIT 1) contact ON true
      WHERE party.organization_id = $1 AND party.id = $2`, [organizationId, id])).rows[0];
  return row && { phone: row.mobile ?? row.phone, name: [row.first_name, row.last_name].filter(Boolean).join(" "), consented: row.consent_whatsapp, target: row.contact_id ? { contactId: row.contact_id } : {}, owner: row.owner_user_id };
}

// Whether the customer messaged this number within the last 24 hours (WhatsApp's service window).
async function inWindow(client, organizationId, phone) {
  return Boolean((await client.query(
    `SELECT 1 FROM tenant.crm_whatsapp_messages WHERE organization_id = $1 AND phone = $2 AND direction = 'inbound' AND created_at > now() - make_interval(hours => ${WINDOW_HOURS}) LIMIT 1`,
    [organizationId, phone])).rows[0]);
}

async function requireWorkable(client, context, type, id) {
  if (!EDIT[type]) throw invalid("entityType", "WhatsApp goes from a lead, deal, company or contact.");
  if (!(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(EDIT[type]))) throw new CrmError(403, "You do not have permission to work on this record.", "PERMISSION_DENIED");
  if (!(await recordVisible(client, context, type, id))) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_WHATSAPP_RECORD");
  const person = await recordPerson(client, context.organizationId, type, id);
  if (!person) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_WHATSAPP_RECORD");
  return person;
}

// What the composer needs: the number, the mode, whether a free message is allowed now, and why not.
export async function prepareWhatsApp(client, context, type, id) {
  const person = await requireWorkable(client, context, type, id);
  const settings = await settingsRow(client, context.organizationId);
  let refused = null;
  try { await assertMayContact(client, context, person.target, "whatsapp"); } catch (error) { if (error instanceof CrmError) refused = error.message; else throw error; }
  const phone = person.phone ? e164(waNumber(person.phone)) : null;
  const open = phone ? await inWindow(client, context.organizationId, phone) : false;
  return {
    phone, name: person.name || null, mode: settings?.mode ?? "click_to_chat", refused, consented: Boolean(person.consented), windowOpen: open,
    // Through the API outside the window: only a template, and only to someone who agreed.
    needsTemplate: (settings?.mode ?? "click_to_chat") === "cloud_api" && !open,
  };
}

// The organization's opt-out list (CRM plan 4.3) covers numbers as well as records.
async function assertNumberNotOptedOut(client, organizationId, phone) {
  if (await optOutOf(client, organizationId, { phone }, "whatsapp")) throw new CrmError(409, "This number is on the opt-out list for WhatsApp.", "CRM_DO_NOT_CONTACT", { channel: "whatsapp" });
}

// Logs a message on the record (an activity and a crm_whatsapp_messages row); returns the message's id. Broadcasts log theirs here too.
export async function logWhatsAppMessage(client, organizationId, { type, id, direction, channel, phone, body, templateName = null, templateLanguage = null, waMessageId = null, status, userId = null, owner = null }) {
  const activity = (await client.query(
    `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, assigned_to, start_at, completed_at, external_id, is_inbound, created_by, updated_by)
     VALUES ($1, $2, $3, 'whatsapp', $4, $5, 'completed', $6, now(), now(), $7, $8, $9, $9) RETURNING id`,
    [organizationId, type, id, `${direction === "inbound" ? "WhatsApp from" : "WhatsApp to"} ${phone}${templateName ? ` (template ${templateName})` : ""}`.slice(0, 300),
      (body ?? "").slice(0, 20000) || null, userId ?? owner ?? null, waMessageId, direction === "inbound", userId])).rows[0];
  const message = (await client.query(
    `INSERT INTO tenant.crm_whatsapp_messages (organization_id, entity_type, entity_id, direction, channel, phone, body, template_name, template_language, wa_message_id, status, activity_id, sent_by, status_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now()) RETURNING id`,
    [organizationId, type, id, direction, channel, phone, body ?? null, templateName, templateLanguage, waMessageId, status, activity.id, userId])).rows[0];
  await client.query(`UPDATE tenant.${TABLE[type]} SET last_activity_at = now() WHERE organization_id = $1 AND id = $2`, [organizationId, id]);
  return message.id;
}

// Click-to-chat: logs the message the salesperson is sending from their own WhatsApp; returns the wa.me link to open.
export async function logClickToChat(client, context, type, id, input = {}) {
  const person = await requireWorkable(client, context, type, id);
  await assertMayContact(client, context, person.target, "whatsapp");
  const phone = e164(waNumber(text(input.phone) || person.phone));
  if (!phone || waNumber(phone).length < 8) throw invalid("phone", "This record has no mobile number to message.");
  await assertNumberNotOptedOut(client, context.organizationId, phone);
  const body = text(input.body).slice(0, 4096);
  if (!body) throw invalid("body", "Write the message.");
  const messageId = await logWhatsAppMessage(client, context.organizationId, { type, id, direction: "outbound", channel: "click_to_chat", phone, body, status: "logged", userId: context.userId, owner: person.owner });
  return { messageId, link: `https://wa.me/${waNumber(phone)}?text=${encodeURIComponent(body)}` };
}

// Through the Cloud API. input: { body } (within the 24-hour window) or { templateName, templateLanguage, parameters[] } (any time, with consent).
export async function sendWhatsApp(client, context, type, id, input = {}, { fetchImpl = fetch, env = process.env } = {}) {
  const person = await requireWorkable(client, context, type, id);
  await assertMayContact(client, context, person.target, "whatsapp");
  const settings = await settingsRow(client, context.organizationId);
  if (settings?.mode !== "cloud_api") throw new CrmError(409, "WhatsApp Business is not connected. Use click-to-chat, or connect it in Setup › WhatsApp.", "CRM_WHATSAPP_NOT_CONNECTED");
  const credentials = await decryptSecret(settings.encrypted_credentials, env);
  const phone = e164(waNumber(person.phone));
  if (!phone) throw invalid("phone", "This record has no mobile number to message.");
  await assertNumberNotOptedOut(client, context.organizationId, phone);
  const open = await inWindow(client, context.organizationId, phone);
  const templateName = text(input.templateName) || null;
  const body = text(input.body).slice(0, 4096);
  let payload;
  if (templateName) {
    if (!/^[a-z0-9_]{1,512}$/.test(templateName)) throw invalid("templateName", "Use the template's name as approved in WhatsApp Manager (lower case and underscores).");
    if (!open && !person.consented) throw new CrmError(409, "This person has not agreed to WhatsApp messages. Record their consent first, or wait for them to message you.", "CRM_WHATSAPP_NO_CONSENT");
    const parameters = (Array.isArray(input.parameters) ? input.parameters : []).slice(0, 10).map((value) => ({ type: "text", text: text(value).slice(0, 1000) }));
    payload = { messaging_product: "whatsapp", to: waNumber(phone), type: "template",
      template: { name: templateName, language: { code: text(input.templateLanguage) || "en" }, ...(parameters.length ? { components: [{ type: "body", parameters }] } : {}) } };
  } else {
    if (!open) throw new CrmError(409, "More than 24 hours have passed since this person last messaged you: WhatsApp allows only an approved template now.", "CRM_WHATSAPP_WINDOW_CLOSED");
    if (!body) throw invalid("body", "Write the message.");
    payload = { messaging_product: "whatsapp", to: waNumber(phone), type: "text", text: { body } };
  }
  let response;
  // Counts towards the plan's monthly messages; refused at the limit before anything is sent.
  await countOutboundMessages(client, context.organizationId, { channel: "whatsapp" }, env);
  try {
    response = await fetchImpl(`${GRAPH}/${encodeURIComponent(settings.phone_number_id)}/messages`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${credentials.accessToken}` }, body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new CrmError(502, `WhatsApp could not be reached: ${error?.message ?? error}`, "CRM_WHATSAPP_UNREACHABLE");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new CrmError(502, `WhatsApp refused the message: ${result?.error?.message ?? response.status}.`, "CRM_WHATSAPP_REFUSED");
  const waMessageId = result?.messages?.[0]?.id ?? null;
  const shown = templateName ? [`Template ${templateName}`, ...(Array.isArray(input.parameters) ? input.parameters : [])].join(" · ") : body;
  const messageId = await logWhatsAppMessage(client, context.organizationId, { type, id, direction: "outbound", channel: "cloud_api", phone, body: shown, templateName,
    templateLanguage: templateName ? text(input.templateLanguage) || "en" : null, waMessageId, status: "sent", userId: context.userId, owner: person.owner });
  return { messageId, waMessageId, status: "sent" };
}

export async function listWhatsAppMessages(client, context, type, id) {
  if (!(await recordVisible(client, context, type, id))) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_WHATSAPP_RECORD");
  const { rows } = await client.query(
    `SELECT message.*, sender.full_name AS sent_by_name FROM tenant.crm_whatsapp_messages message LEFT JOIN users sender ON sender.id = message.sent_by
      WHERE message.organization_id = $1 AND message.entity_type = $2 AND message.entity_id = $3 ORDER BY message.created_at DESC LIMIT 100`, [context.organizationId, type, id]);
  return rows.map((row) => ({ id: row.id, direction: row.direction, channel: row.channel, phone: row.phone, body: row.body, templateName: row.template_name,
    status: row.status, error: row.error_message, sentByName: row.sent_by_name ?? null, createdAt: row.created_at }));
}

// ------------------------------------------------------------------ webhook (Cloud API)

export async function resolveWhatsAppWebhook(client, webhookKey) {
  const key = String(webhookKey ?? "");
  if (!/^wa_[A-Za-z0-9_-]{20,64}$/.test(key)) throw new CrmError(404, "Unknown WhatsApp address.", "CRM_WHATSAPP_NOT_FOUND");
  const organizationId = (await client.query("SELECT tenant.crm_resolve_whatsapp_webhook($1) AS organization_id", [hash(key)])).rows[0]?.organization_id;
  if (!organizationId) throw new CrmError(404, "Unknown WhatsApp address.", "CRM_WHATSAPP_NOT_FOUND");
  await setTenantContext(client, organizationId);
  const row = await settingsRow(client, organizationId);
  if (!row || row.mode !== "cloud_api" || row.webhook_key_hash !== hash(key)) throw new CrmError(404, "Unknown WhatsApp address.", "CRM_WHATSAPP_NOT_FOUND");
  return row;
}

export async function verifyWhatsAppSubscription(row, params, { env = process.env } = {}) {
  const credentials = await decryptSecret(row.encrypted_credentials, env);
  if (params.get("hub.mode") !== "subscribe" || !equal(params.get("hub.verify_token"), credentials.verifyToken)) return null;
  return params.get("hub.challenge") ?? "";
}

// Who a number belongs to: the open lead with it, else the contact, else a new lead from WhatsApp.
async function recordForNumber(client, organizationId, phone, profileName, authority) {
  const digits = normalizePhone(phone);
  const lead = (await client.query(
    `SELECT id FROM tenant.crm_leads WHERE organization_id = $1 AND normalized_mobile = $2 AND status IN ('open', 'qualified') AND archived_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [organizationId, digits])).rows[0];
  if (lead) return { type: "lead", id: lead.id, created: false };
  const contact = (await client.query(
    `SELECT id FROM tenant.contacts WHERE organization_id = $1 AND status = 'active'
        AND (normalized_mobile = $2 OR (whatsapp_number IS NOT NULL AND right(regexp_replace(whatsapp_number, '\\D', '', 'g'), length($2)) = $2))
      ORDER BY (normalized_mobile = $2) DESC, created_at DESC LIMIT 1`, [organizationId, digits])).rows[0];
  if (contact) return { type: "contact", id: contact.id, created: false };
  const source = (await client.query("SELECT id FROM tenant.crm_lead_sources WHERE organization_id = $1 AND code = 'whatsapp' AND status = 'active'", [organizationId])).rows[0];
  const names = String(profileName ?? "").trim().split(/\s+/).filter(Boolean);
  // They wrote to us on WhatsApp: consent to reply there, recorded as theirs.
  try {
    const created = await withConsentSource(client, "whatsapp_message", `First WhatsApp message from ${phone}`, () => createLead(client, authority, {
      firstName: names.length > 1 ? names.slice(0, -1).join(" ") : names[0] || "WhatsApp", lastName: names.length > 1 ? names.at(-1) : undefined,
      mobile: phone, consentWhatsapp: true, ...(source ? { sourceId: source.id } : {}), sourceDetail: "Messaged on WhatsApp",
    }, { origin: "integration" }));
    return { type: "lead", id: created.id, created: true };
  } catch (error) {
    if (!(error instanceof CrmError && error.code === "CRM_LEAD_DUPLICATE")) throw error;
    const match = (error.details?.matches ?? []).find((entry) => entry.strength === "exact" && ["lead", "contact"].includes(entry.kind));
    if (!match) throw error;
    return { type: match.kind, id: match.id, created: false };
  }
}

// A webhook POST from Meta: messages and status updates. `runTenant(work)` runs the writes. Returns counts.
export async function receiveWhatsAppWebhook({ runTenant }, row, { rawBody, headers, body }, { env = process.env } = {}) {
  const credentials = await decryptSecret(row.encrypted_credentials, env);
  const supplied = String(headers.get("x-hub-signature-256") ?? "").replace(/^sha256=/i, "");
  const expected = createHmac("sha256", String(credentials.appSecret ?? "")).update(rawBody).digest("hex");
  if (!equal(supplied, expected)) throw new CrmError(401, "The WhatsApp signature does not match.", "CRM_WHATSAPP_SIGNATURE");
  const values = (body?.entry ?? []).flatMap((entry) => (entry.changes ?? []).filter((change) => change.field === "messages").map((change) => change.value ?? {}));
  return runTenant(async (client) => {
    const organizationId = row.organization_id;
    // CRM switched off: Meta's delivery is acknowledged (no retries) and nothing is recorded or created.
    if (!(await crmIsOn(client, organizationId))) return { received: 0, duplicate: 0, statuses: 0, newLeads: 0, crmOff: true };
    const actor = await integrationActor(client, organizationId, row.updated_by ?? row.created_by ?? null);
    const authority = { organizationId, userId: actor, roleSlugs: [], permissions: [LEAD_PERMISSIONS.create, LEAD_PERMISSIONS.assign, LEAD_PERMISSIONS.viewAll, LEAD_PERMISSIONS.viewSensitive, "crm.records.view_all"] };
    const counts = { received: 0, duplicate: 0, statuses: 0, newLeads: 0 };
    for (const value of values) {
      const names = new Map((value.contacts ?? []).map((entry) => [entry.wa_id, entry.profile?.name]));
      for (const message of value.messages ?? []) {
        if ((await client.query("SELECT 1 FROM tenant.crm_whatsapp_messages WHERE organization_id = $1 AND wa_message_id = $2", [organizationId, message.id])).rows[0]) { counts.duplicate += 1; continue; }
        const phone = e164(message.from);
        const content = message.type === "text" ? message.text?.body : message.type === "button" ? message.button?.text
          : message.type === "interactive" ? (message.interactive?.button_reply?.title ?? message.interactive?.list_reply?.title) : `[${message.type}]`;
        const record = await recordForNumber(client, organizationId, phone, names.get(message.from), authority);
        const owner = (await client.query(`SELECT owner_user_id FROM tenant.${TABLE[record.type]} WHERE organization_id = $1 AND id = $2`, [organizationId, record.id])).rows[0]?.owner_user_id ?? null;
        await logWhatsAppMessage(client, organizationId, { type: record.type, id: record.id, direction: "inbound", channel: "cloud_api", phone, body: content, waMessageId: message.id, status: "received", owner });
        counts.received += 1;
        // A reply of STOP (or its Hindi) puts the number on the opt-out list for WhatsApp: no broadcast or template reaches it again.
        if (STOP_WORDS.has(String(content ?? "").trim().toLowerCase().replace(/[.!]+$/, ""))) {
          await client.query(
            `INSERT INTO tenant.crm_opt_outs (organization_id, kind, value, channels, source, reason) VALUES ($1, 'phone', $2, ARRAY['whatsapp']::text[], 'whatsapp_stop', 'Replied STOP on WhatsApp')
             ON CONFLICT (organization_id, kind, value) DO UPDATE SET channels = (SELECT array_agg(DISTINCT entry) FROM unnest(tenant.crm_opt_outs.channels || EXCLUDED.channels) AS entry)`,
            [organizationId, consentPhone(phone)]);
          counts.optedOut = (counts.optedOut ?? 0) + 1;
        }
        if (record.created) counts.newLeads += 1;
        await notifyFollowers(client, organizationId, record.type, record.id, { title: `WhatsApp from ${names.get(message.from) ?? phone}`, message: String(content ?? "").slice(0, 200), exceptUserId: owner });
        if (owner)
          await createNotification(client, {
            organizationId, userId: owner, category: "crm_whatsapp_received", title: `WhatsApp from ${names.get(message.from) ?? phone}`,
            message: String(content ?? "").slice(0, 200), href: `${HREF[record.type]}${record.id}`, entityType: `crm.${record.type}`, entityId: record.id,
          });
      }
      for (const status of value.statuses ?? []) {
        const next = ["sent", "delivered", "read", "failed"].includes(status.status) ? status.status : null;
        if (!next) continue;
        const { rowCount } = await client.query(
          `UPDATE tenant.crm_whatsapp_messages SET status = $3, status_at = now(), error_message = $4
            WHERE organization_id = $1 AND wa_message_id = $2 AND direction = 'outbound'
              -- receipts can arrive out of order: never step back (read stays read); a failure always shows
              AND (CASE status WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 0 END)
                  <= (CASE $3 WHEN 'sent' THEN 1 WHEN 'delivered' THEN 2 WHEN 'read' THEN 3 ELSE 4 END)`,
          [organizationId, status.id, next, next === "failed" ? String(status.errors?.[0]?.title ?? status.errors?.[0]?.message ?? "Failed").slice(0, 500) : null]);
        counts.statuses += rowCount;
      }
    }
    await client.query("UPDATE tenant.crm_whatsapp_settings SET last_received_at = now() WHERE organization_id = $1", [organizationId]);
    return counts;
  });
}

// ------------------------------------------------------------------ to the team

// A template message to someone on the team (a reminder) through the connected number — not logged on any customer record.
// Returns { sent, error? }; never throws for WhatsApp's answer.
export async function sendTeamWhatsApp(client, organizationId, { phone, templateName, templateLanguage = "en", values = [] }, { fetchImpl = fetch, env = process.env } = {}) {
  const settings = await settingsRow(client, organizationId);
  if (settings?.mode !== "cloud_api" || !settings.phone_number_id) return { sent: false, error: "WhatsApp Business is not connected." };
  // A bare Indian mobile (98…, or 098…) gets 91; any other number is taken as written with its country code.
  const local = waNumber(phone).replace(/^0(?=[6-9][0-9]{9}$)/, "");
  const to = /^[6-9][0-9]{9}$/.test(local) ? `91${local}` : local;
  if (to.length < 10) return { sent: false, error: "No mobile number." };
  const credentials = await decryptSecret(settings.encrypted_credentials, env);
  const parameters = values.map((value) => ({ type: "text", text: text(value).slice(0, 1000) || "-" }));
  await countOutboundMessages(client, organizationId, { channel: "whatsapp" }, env);
  try {
    const response = await fetchImpl(`${GRAPH}/${encodeURIComponent(settings.phone_number_id)}/messages`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${credentials.accessToken}` },
      body: JSON.stringify({ messaging_product: "whatsapp", to, type: "template",
        template: { name: templateName, language: { code: templateLanguage }, ...(parameters.length ? { components: [{ type: "body", parameters }] } : {}) } }),
    });
    const result = await response.json().catch(() => ({}));
    return response.ok ? { sent: true } : { sent: false, error: String(result?.error?.message ?? response.status).slice(0, 300) };
  } catch (error) {
    return { sent: false, error: String(error?.message ?? error).slice(0, 300) };
  }
}
