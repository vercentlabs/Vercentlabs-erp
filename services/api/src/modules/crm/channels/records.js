// Calls and SMS from CRM (CRM plan 4.4).
//
//   Click-to-call (Exotel)  "Call" on a record rings the salesperson's own phone, then connects the customer through the organization's
//                           virtual number (caller ID). Exotel's status callback records the outcome, duration and recording; the call
//                           is logged on the record as a call activity (connected, or no answer).
//   SMS (Exotel, MSG91)     only from a DLT-registered template (TRAI): the template's DLT id, the registered sender ID, the
//                           organization's DLT entity id, and the template's {#var#} values. Promotional templates go only to people who
//                           agreed to SMS. Nobody who refused calls or SMS — on the record or on the opt-out list — is reached.
import { createHash, randomBytes } from "node:crypto";

import { setTenantContext } from "@vercentlabs/database";

import { decryptSecret, encryptSecret } from "../../../core/platform/secrets/index.js";
import { optOutOf } from "../data-management/consent.js";
import { assertMayContact } from "../data-management/contact-preferences.js";
import { CrmError } from "../data-management/errors.js";
import { recordVisible } from "../notes/access.js";
import { recordPerson } from "../whatsapp/records.js";

const MANAGE = "crm.settings.manage";
const EDIT = Object.freeze({ lead: "crm.leads.edit", opportunity: "crm.opportunities.edit", party: "crm.accounts.edit", contact: "crm.contacts.edit" });
const TABLE = Object.freeze({ lead: "crm_leads", opportunity: "crm_opportunities", party: "business_parties", contact: "contacts" });
const hash = (value) => createHash("sha256").update(value).digest("hex");
const text = (value) => String(value ?? "").trim();
const invalid = (field, message) => new CrmError(400, message, "CRM_CHANNEL_VALIDATION", { issues: [{ field, message }] });
const digits = (phone) => String(phone ?? "").replace(/\D/g, "");
// Indian numbers to providers as 0XXXXXXXXXX (Exotel) or 91XXXXXXXXXX (MSG91); others with their country code.
const indian = (phone) => { const all = digits(phone); return all.length >= 10 && (all.length === 10 || all.startsWith("91")) ? all.slice(-10) : null; };

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, "You do not have permission to set up calling and SMS.", "PERMISSION_DENIED");
}

async function requireWorkable(client, context, type, id) {
  if (!EDIT[type]) throw invalid("entityType", "Calls and SMS go from a lead, deal, company or contact.");
  if (!(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(EDIT[type]))) throw new CrmError(403, "You do not have permission to work on this record.", "PERMISSION_DENIED");
  if (!(await recordVisible(client, context, type, id))) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_CHANNEL_RECORD");
  const person = await recordPerson(client, context.organizationId, type, id);
  if (!person) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_CHANNEL_RECORD");
  return person;
}

async function credentialsOf(row, env) {
  return row?.encrypted_credentials ? (await decryptSecret(row.encrypted_credentials, env)) ?? {} : {};
}

// ------------------------------------------------------------------ settings

export async function getChannelSettings(client, context, { env = process.env } = {}) {
  const telephony = (await client.query("SELECT * FROM tenant.crm_telephony_settings WHERE organization_id = $1", [context.organizationId])).rows[0];
  const sms = (await client.query("SELECT * FROM tenant.crm_sms_settings WHERE organization_id = $1", [context.organizationId])).rows[0];
  const agent = (await client.query("SELECT phone FROM tenant.crm_call_agents WHERE organization_id = $1 AND user_id = $2", [context.organizationId, context.userId])).rows[0];
  return {
    telephony: { provider: telephony?.provider ?? "none", accountSid: telephony?.account_sid ?? null, apiHost: telephony?.api_host ?? "api.exotel.com", callerId: telephony?.caller_id ?? null,
      recordCalls: telephony?.record_calls ?? true, credentialsSet: Object.keys(await credentialsOf(telephony, env)).filter((key) => key !== "callbackKey"), webhookKeyPrefix: telephony?.webhook_key_prefix ?? null },
    sms: { provider: sms?.provider ?? "none", senderId: sms?.sender_id ?? null, dltEntityId: sms?.dlt_entity_id ?? null, accountSid: sms?.account_sid ?? null,
      apiHost: sms?.api_host ?? "api.exotel.com", credentialsSet: Object.keys(await credentialsOf(sms, env)).filter((key) => key !== "callbackKey"), webhookKeyPrefix: sms?.webhook_key_prefix ?? null },
    myCallPhone: agent?.phone ?? null,
  };
}

// input: { telephony?: { provider, accountSid, apiHost, callerId, recordCalls, apiKey, apiToken }, sms?: { provider, senderId, dltEntityId, accountSid, apiHost, apiKey, apiToken, authKey } }
// Returns the settings and, when a callback address was made, its key once ({ callWebhookKey, smsWebhookKey }).
export async function saveChannelSettings(client, context, input = {}, { env = process.env } = {}) {
  requireManage(context);
  const keys = { callWebhookKey: null, smsWebhookKey: null };
  if (input.telephony) {
    const given = input.telephony;
    const row = (await client.query("SELECT * FROM tenant.crm_telephony_settings WHERE organization_id = $1", [context.organizationId])).rows[0];
    const provider = given.provider === "exotel" ? "exotel" : "none";
    const credentials = { ...(await credentialsOf(row, env)) };
    for (const key of ["apiKey", "apiToken"]) if (text(given[key])) credentials[key] = text(given[key]).slice(0, 500);
    const accountSid = given.accountSid === undefined ? row?.account_sid ?? null : text(given.accountSid) || null;
    const apiHost = given.apiHost === undefined ? row?.api_host ?? "api.exotel.com" : text(given.apiHost) || "api.exotel.com";
    const callerId = given.callerId === undefined ? row?.caller_id ?? null : text(given.callerId) || null;
    if (provider === "exotel") {
      if (!accountSid) throw invalid("telephony.accountSid", "Enter the Exotel account SID.");
      if (!/^api(\.in)?\.exotel\.com$/.test(apiHost)) throw invalid("telephony.apiHost", "Use api.exotel.com, or api.in.exotel.com for the Mumbai cluster.");
      if (!callerId || digits(callerId).length < 8) throw invalid("telephony.callerId", "Enter your ExoPhone (the virtual number customers see).");
      if (!credentials.apiKey || !credentials.apiToken) throw invalid("telephony.apiKey", "Enter the API key and token.");
      if (!row?.webhook_key_hash || !credentials.callbackKey) keys.callWebhookKey = `ch_${randomBytes(24).toString("base64url")}`;
      // Kept (encrypted) so CRM can give Exotel the callback address with each call.
      if (keys.callWebhookKey) credentials.callbackKey = keys.callWebhookKey;
    }
    await client.query(
      `INSERT INTO tenant.crm_telephony_settings (organization_id, provider, account_sid, api_host, caller_id, record_calls, encrypted_credentials, webhook_key_hash, webhook_key_prefix, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, now())
       ON CONFLICT (organization_id) DO UPDATE SET provider = EXCLUDED.provider, account_sid = EXCLUDED.account_sid, api_host = EXCLUDED.api_host, caller_id = EXCLUDED.caller_id,
         record_calls = EXCLUDED.record_calls, encrypted_credentials = EXCLUDED.encrypted_credentials,
         webhook_key_hash = COALESCE(EXCLUDED.webhook_key_hash, tenant.crm_telephony_settings.webhook_key_hash),
         webhook_key_prefix = COALESCE(EXCLUDED.webhook_key_prefix, tenant.crm_telephony_settings.webhook_key_prefix), updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [context.organizationId, provider, accountSid, apiHost, callerId, given.recordCalls !== false, JSON.stringify(await encryptSecret(credentials, env)),
        keys.callWebhookKey ? hash(keys.callWebhookKey) : null, keys.callWebhookKey?.slice(0, 10) ?? null, context.userId ?? null]);
  }
  if (input.sms) {
    const given = input.sms;
    const row = (await client.query("SELECT * FROM tenant.crm_sms_settings WHERE organization_id = $1", [context.organizationId])).rows[0];
    const provider = ["exotel", "msg91"].includes(given.provider) ? given.provider : "none";
    const credentials = { ...(await credentialsOf(row, env)) };
    for (const key of ["apiKey", "apiToken", "authKey"]) if (text(given[key])) credentials[key] = text(given[key]).slice(0, 500);
    const senderId = given.senderId === undefined ? row?.sender_id ?? null : text(given.senderId).toUpperCase() || null;
    const dltEntityId = given.dltEntityId === undefined ? row?.dlt_entity_id ?? null : text(given.dltEntityId) || null;
    const accountSid = given.accountSid === undefined ? row?.account_sid ?? null : text(given.accountSid) || null;
    const apiHost = given.apiHost === undefined ? row?.api_host ?? "api.exotel.com" : text(given.apiHost) || "api.exotel.com";
    if (provider !== "none") {
      if (!senderId || !/^[A-Z0-9]{3,11}$/.test(senderId)) throw invalid("sms.senderId", "Enter the sender ID (header) registered on DLT, such as ACMEIN.");
      if (!dltEntityId || !/^[0-9]{10,25}$/.test(dltEntityId)) throw invalid("sms.dltEntityId", "Enter your DLT principal entity ID (digits).");
      if (provider === "exotel" && (!accountSid || !credentials.apiKey || !credentials.apiToken)) throw invalid("sms.apiKey", "Enter the Exotel account SID, API key and token.");
      if (provider === "msg91" && !credentials.authKey) throw invalid("sms.authKey", "Enter the MSG91 auth key.");
      if (!row?.webhook_key_hash || !credentials.callbackKey) keys.smsWebhookKey = `ch_${randomBytes(24).toString("base64url")}`;
      if (keys.smsWebhookKey) credentials.callbackKey = keys.smsWebhookKey;
    }
    await client.query(
      `INSERT INTO tenant.crm_sms_settings (organization_id, provider, sender_id, dlt_entity_id, account_sid, api_host, encrypted_credentials, webhook_key_hash, webhook_key_prefix, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, now())
       ON CONFLICT (organization_id) DO UPDATE SET provider = EXCLUDED.provider, sender_id = EXCLUDED.sender_id, dlt_entity_id = EXCLUDED.dlt_entity_id, account_sid = EXCLUDED.account_sid,
         api_host = EXCLUDED.api_host, encrypted_credentials = EXCLUDED.encrypted_credentials,
         webhook_key_hash = COALESCE(EXCLUDED.webhook_key_hash, tenant.crm_sms_settings.webhook_key_hash),
         webhook_key_prefix = COALESCE(EXCLUDED.webhook_key_prefix, tenant.crm_sms_settings.webhook_key_prefix), updated_by = EXCLUDED.updated_by, updated_at = now()`,
      [context.organizationId, provider, senderId, dltEntityId, accountSid, apiHost, JSON.stringify(await encryptSecret(credentials, env)),
        keys.smsWebhookKey ? hash(keys.smsWebhookKey) : null, keys.smsWebhookKey?.slice(0, 10) ?? null, context.userId ?? null]);
  }
  return { settings: await getChannelSettings(client, context, { env }), ...keys };
}

// The number a salesperson's calls ring (their own mobile).
export async function setMyCallPhone(client, context, phone) {
  const number = text(phone);
  if (!number) {
    await client.query("DELETE FROM tenant.crm_call_agents WHERE organization_id = $1 AND user_id = $2", [context.organizationId, context.userId]);
    return { phone: null };
  }
  if (digits(number).length < 10 || digits(number).length > 15) throw invalid("phone", "Enter your mobile number with its country code, such as +91 98765 43210.");
  await client.query(
    `INSERT INTO tenant.crm_call_agents (organization_id, user_id, phone, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (organization_id, user_id) DO UPDATE SET phone = EXCLUDED.phone, updated_at = now()`, [context.organizationId, context.userId, number]);
  return { phone: number };
}

// ------------------------------------------------------------------ calls

async function logActivity(client, organizationId, { type, id, activityType, subject, description, userId, owner, outcome = null, externalId }) {
  const activity = (await client.query(
    `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, assigned_to, start_at, completed_at, outcome_code, external_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, 'completed', $7, now(), now(), $8, $9, $10, $10) RETURNING id`,
    [organizationId, type, id, activityType, subject.slice(0, 300), description?.slice(0, 20000) ?? null, userId ?? owner ?? null, outcome, externalId, userId])).rows[0];
  await client.query(`UPDATE tenant.${TABLE[type]} SET last_activity_at = now() WHERE organization_id = $1 AND id = $2`, [organizationId, id]);
  return activity.id;
}

// "Call": rings the salesperson, then the customer, through Exotel. Returns { callId, status }.
export async function startCall(client, context, type, id, { fetchImpl = fetch, env = process.env, appUrl = env.APP_URL } = {}) {
  const person = await requireWorkable(client, context, type, id);
  await assertMayContact(client, context, person.target, "call");
  if (!person.phone) throw invalid("phone", "This record has no phone number.");
  if (await optOutOf(client, context.organizationId, { phone: person.phone }, "call")) throw new CrmError(409, "This number is on the opt-out list for calls.", "CRM_DO_NOT_CONTACT", { channel: "call" });
  const settings = (await client.query("SELECT * FROM tenant.crm_telephony_settings WHERE organization_id = $1", [context.organizationId])).rows[0];
  if (settings?.provider !== "exotel") throw new CrmError(409, "Calling is not connected. Ring the number from your phone and log the call, or connect Exotel in Setup › Calls and SMS.", "CRM_TELEPHONY_NOT_CONNECTED");
  const agent = (await client.query("SELECT phone FROM tenant.crm_call_agents WHERE organization_id = $1 AND user_id = $2", [context.organizationId, context.userId])).rows[0];
  if (!agent) throw new CrmError(409, "Add the mobile number your calls should ring first (in the Call window).", "CRM_TELEPHONY_NO_AGENT_PHONE");
  const credentials = await credentialsOf(settings, env);
  const call = (await client.query(
    `INSERT INTO tenant.crm_calls (organization_id, entity_type, entity_id, provider, agent_user_id, agent_phone, customer_phone, status) VALUES ($1, $2, $3, 'exotel', $4, $5, $6, 'queued') RETURNING id`,
    [context.organizationId, type, id, context.userId, agent.phone, person.phone])).rows[0];
  const form = new URLSearchParams({ From: agent.phone, To: person.phone, CallerId: settings.caller_id, CustomField: call.id, Record: settings.record_calls ? "true" : "false" });
  // The callback's address carries the organization's key; without the app's public URL there is no callback (and no automatic log).
  const webhook = callbackUrl(appUrl, credentials.callbackKey);
  if (webhook) { form.set("StatusCallback", webhook); form.set("StatusCallbackEvents[0]", "terminal"); }
  let response;
  try {
    response = await fetchImpl(`https://${settings.api_host}/v1/Accounts/${encodeURIComponent(settings.account_sid)}/Calls/connect.json`, {
      method: "POST", body: form,
      headers: { authorization: `Basic ${Buffer.from(`${credentials.apiKey}:${credentials.apiToken}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    });
  } catch (error) {
    await client.query("UPDATE tenant.crm_calls SET status = 'failed', error_message = $3 WHERE organization_id = $1 AND id = $2", [context.organizationId, call.id, String(error?.message ?? error).slice(0, 500)]);
    throw new CrmError(502, `Exotel could not be reached: ${error?.message ?? error}`, "CRM_TELEPHONY_UNREACHABLE");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = result?.RestException?.Message ?? `status ${response.status}`;
    await client.query("UPDATE tenant.crm_calls SET status = 'failed', error_message = $3 WHERE organization_id = $1 AND id = $2", [context.organizationId, call.id, String(message).slice(0, 500)]);
    return { callId: call.id, status: "failed", error: `Exotel refused the call: ${message}.` };
  }
  await client.query("UPDATE tenant.crm_calls SET provider_call_id = $3, status = 'ringing', started_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, call.id, result?.Call?.Sid ?? null]);
  return { callId: call.id, status: "ringing" };
}
const callbackUrl = (appUrl, key) => (appUrl && key ? `${String(appUrl).replace(/\/+$/, "")}/api/crm/channels/hooks/${key}` : null);

const EXOTEL_STATUS = Object.freeze({ completed: "completed", busy: "busy", "no-answer": "no_answer", failed: "failed", canceled: "canceled", "in-progress": "in_progress", ringing: "ringing", queued: "queued" });

// Exotel's status callback (form fields): CallSid, Status, CustomField (our call id), ConversationDuration, StartTime, EndTime, RecordingUrl.
export async function receiveCallStatus(client, organizationId, fields) {
  const callId = text(fields.CustomField);
  const sid = text(fields.CallSid);
  const call = (await client.query(
    `SELECT * FROM tenant.crm_calls WHERE organization_id = $1 AND ((id::text = $2) OR (provider_call_id = $3)) ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
    [organizationId, /^[0-9a-f-]{36}$/i.test(callId) ? callId : "", sid])).rows[0];
  if (!call) return { matched: false };
  const status = EXOTEL_STATUS[text(fields.Status ?? fields.CallStatus).toLowerCase()] ?? call.status;
  const duration = Number(fields.ConversationDuration ?? fields.Duration ?? 0) || 0;
  await client.query(
    `UPDATE tenant.crm_calls SET status = $3, provider_call_id = COALESCE(provider_call_id, NULLIF($4, '')), duration_seconds = $5, recording_url = COALESCE(NULLIF($6, ''), recording_url),
            ended_at = CASE WHEN $3 IN ('completed', 'busy', 'no_answer', 'failed', 'canceled') THEN now() ELSE ended_at END
      WHERE organization_id = $1 AND id = $2`, [organizationId, call.id, status, sid, duration, text(fields.RecordingUrl)]);
  if (["completed", "busy", "no_answer", "failed", "canceled"].includes(status) && !call.activity_id) {
    const connected = status === "completed" && duration > 0;
    const minutes = `${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, "0")}`;
    const owner = (await client.query(`SELECT owner_user_id FROM tenant.${TABLE[call.entity_type]} WHERE organization_id = $1 AND id = $2`, [organizationId, call.entity_id])).rows[0]?.owner_user_id ?? null;
    const activityId = await logActivity(client, organizationId, {
      type: call.entity_type, id: call.entity_id, activityType: "call", userId: call.agent_user_id, owner,
      subject: connected ? `Call with ${call.customer_phone} (${minutes})` : `Call to ${call.customer_phone}: ${status.replace("_", " ")}`,
      description: [connected ? `Connected for ${minutes}.` : `Not connected (${status.replace("_", " ")}).`, text(fields.RecordingUrl) ? `Recording: ${text(fields.RecordingUrl)}` : null].filter(Boolean).join("\n"),
      outcome: connected ? "connected" : "no_response", externalId: sid || call.id,
    });
    await client.query("UPDATE tenant.crm_calls SET activity_id = $3 WHERE organization_id = $1 AND id = $2", [organizationId, call.id, activityId]);
  }
  return { matched: true, status };
}

export async function listCalls(client, context, type, id) {
  if (!(await recordVisible(client, context, type, id))) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_CHANNEL_RECORD");
  const { rows } = await client.query(
    `SELECT call.*, agent.full_name AS agent_name FROM tenant.crm_calls call LEFT JOIN users agent ON agent.id = call.agent_user_id
      WHERE call.organization_id = $1 AND call.entity_type = $2 AND call.entity_id = $3 ORDER BY call.created_at DESC LIMIT 100`, [context.organizationId, type, id]);
  return rows.map((row) => ({ id: row.id, status: row.status, customerPhone: row.customer_phone, agentName: row.agent_name ?? null, durationSeconds: row.duration_seconds,
    recordingUrl: row.recording_url, error: row.error_message, createdAt: row.created_at }));
}

// ------------------------------------------------------------------ SMS

const VAR = /\{#var#\}/gi;

export async function listSmsTemplates(client, context, { includeInactive = false } = {}) {
  if (includeInactive) requireManage(context);
  const { rows } = await client.query(`SELECT * FROM tenant.crm_sms_templates WHERE organization_id = $1 ${includeInactive ? "" : "AND status = 'active'"} ORDER BY status, lower(name)`, [context.organizationId]);
  return rows.map((row) => ({ id: row.id, name: row.name, dltTemplateId: row.dlt_template_id, category: row.category, body: row.body, status: row.status, variables: (row.body.match(VAR) ?? []).length }));
}

// input: { name, dltTemplateId, category, body (exactly as approved on DLT, with {#var#} for each value), status? }
export async function saveSmsTemplate(client, context, templateId, input = {}) {
  requireManage(context);
  const name = text(input.name).slice(0, 120);
  const dltTemplateId = text(input.dltTemplateId);
  const body = text(input.body).slice(0, 2000);
  const category = ["transactional", "service", "promotional"].includes(input.category) ? input.category : "service";
  const status = input.status === "inactive" ? "inactive" : "active";
  if (!name) throw invalid("name", "Name the template.");
  if (!/^[0-9]{10,25}$/.test(dltTemplateId)) throw invalid("dltTemplateId", "Enter the template's DLT ID (digits) from your DLT portal.");
  if (!body) throw invalid("body", "Paste the template exactly as approved on DLT.");
  if (templateId) {
    const { rowCount } = await client.query(
      `UPDATE tenant.crm_sms_templates SET name = $3, dlt_template_id = $4, category = $5, body = $6, status = $7, updated_by = $8, updated_at = now() WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, templateId, name, dltTemplateId, category, body, status, context.userId ?? null]);
    if (!rowCount) throw new CrmError(404, "Template not found.", "CRM_SMS_TEMPLATE_NOT_FOUND");
  } else {
    await client.query(`INSERT INTO tenant.crm_sms_templates (organization_id, name, dlt_template_id, category, body, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $6, $6)`,
      [context.organizationId, name, dltTemplateId, category, body, context.userId ?? null]);
  }
  return listSmsTemplates(client, context, { includeInactive: true });
}

// The text that will go: the template with its {#var#} filled in order. Every value is required; DLT rejects anything else.
export function fillDltTemplate(body, values = []) {
  const count = (body.match(VAR) ?? []).length;
  if (values.length < count || values.slice(0, count).some((value) => !text(value))) throw invalid("values", `This template needs ${count} ${count === 1 ? "value" : "values"}.`);
  let index = 0;
  return body.replace(VAR, () => text(values[index++]).slice(0, 30));
}

async function smsConsented(client, organizationId, target) {
  if (target.leadId) return Boolean((await client.query("SELECT consent_sms FROM tenant.crm_leads WHERE organization_id = $1 AND id = $2", [organizationId, target.leadId])).rows[0]?.consent_sms);
  if (target.contactId) return Boolean((await client.query("SELECT consent_sms FROM tenant.contacts WHERE organization_id = $1 AND id = $2", [organizationId, target.contactId])).rows[0]?.consent_sms);
  return false;
}

// input: { templateId, values[] } — returns { messageId, status, body }.
export async function sendSms(client, context, type, id, input = {}, { fetchImpl = fetch, env = process.env, appUrl = env.APP_URL } = {}) {
  const person = await requireWorkable(client, context, type, id);
  await assertMayContact(client, context, person.target, "sms");
  if (!person.phone) throw invalid("phone", "This record has no mobile number.");
  if (await optOutOf(client, context.organizationId, { phone: person.phone }, "sms")) throw new CrmError(409, "This number is on the opt-out list for SMS.", "CRM_DO_NOT_CONTACT", { channel: "sms" });
  const settings = (await client.query("SELECT * FROM tenant.crm_sms_settings WHERE organization_id = $1", [context.organizationId])).rows[0];
  if (!settings || settings.provider === "none") throw new CrmError(409, "SMS is not connected. Connect Exotel or MSG91 in Setup › Calls and SMS.", "CRM_SMS_NOT_CONNECTED");
  const template = (await client.query("SELECT * FROM tenant.crm_sms_templates WHERE organization_id = $1 AND id = $2 AND status = 'active'", [context.organizationId, input.templateId])).rows[0];
  if (!template) throw invalid("templateId", "Choose an SMS template.");
  if (template.category === "promotional" && !(await smsConsented(client, context.organizationId, person.target)))
    throw new CrmError(409, "A promotional SMS goes only to someone who agreed to SMS. Record their consent first, or use a service template.", "CRM_SMS_NO_CONSENT");
  const body = fillDltTemplate(template.body, Array.isArray(input.values) ? input.values : []);
  const credentials = await credentialsOf(settings, env);
  const local = indian(person.phone);
  let request;
  if (settings.provider === "exotel") {
    request = {
      url: `https://${settings.api_host}/v1/Accounts/${encodeURIComponent(settings.account_sid)}/Sms/send.json`,
      init: { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${credentials.apiKey}:${credentials.apiToken}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ From: settings.sender_id, To: local ? `0${local}` : `+${digits(person.phone)}`, Body: body, DltEntityId: settings.dlt_entity_id,
          DltTemplateId: template.dlt_template_id, SmsType: template.category === "promotional" ? "promotional" : "transactional",
          ...(callbackUrl(appUrl, credentials.callbackKey) ? { StatusCallback: callbackUrl(appUrl, credentials.callbackKey) } : {}) }) },
    };
  } else {
    const query = new URLSearchParams({ authkey: credentials.authKey, mobiles: local ? `91${local}` : digits(person.phone), message: body, sender: settings.sender_id,
      route: template.category === "promotional" ? "1" : "4", country: "91", DLT_TE_ID: template.dlt_template_id, PE_ID: settings.dlt_entity_id, response: "json" });
    request = { url: `https://api.msg91.com/api/sendhttp.php?${query}`, init: { method: "GET" } };
  }
  let response;
  try { response = await fetchImpl(request.url, request.init); } catch (error) { throw new CrmError(502, `The SMS provider could not be reached: ${error?.message ?? error}`, "CRM_SMS_UNREACHABLE"); }
  const raw = await response.text().catch(() => "");
  let parsed;
  try { parsed = raw ? JSON.parse(raw) : {}; } catch { parsed = { message: raw }; }
  const failed = !response.ok || parsed?.type === "error" || parsed?.RestException;
  const providerId = settings.provider === "exotel" ? parsed?.SMSMessage?.Sid ?? null : (parsed?.message && parsed.type !== "error" ? String(parsed.message) : null);
  const error = failed ? String(parsed?.RestException?.Message ?? parsed?.message ?? `status ${response.status}`).slice(0, 500) : null;
  const owner = person.owner ?? null;
  const activityId = failed ? null : await logActivity(client, context.organizationId, { type, id, activityType: "sms", subject: `SMS to ${person.phone}: ${template.name}`, description: body,
    userId: context.userId, owner, externalId: providerId });
  const message = (await client.query(
    `INSERT INTO tenant.crm_sms_messages (organization_id, entity_type, entity_id, phone, template_id, body, provider, provider_message_id, status, error_message, activity_id, sent_by, status_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, now()) RETURNING id`,
    [context.organizationId, type, id, person.phone, template.id, body, settings.provider, providerId, failed ? "failed" : "sent", error, activityId, context.userId ?? null])).rows[0];
  if (failed) return { messageId: message.id, status: "failed", error: `The SMS was not accepted: ${error}.`, body };
  return { messageId: message.id, status: "sent", body };
}

export async function listSmsMessages(client, context, type, id) {
  if (!(await recordVisible(client, context, type, id))) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_CHANNEL_RECORD");
  const { rows } = await client.query(
    `SELECT message.*, sender.full_name AS sent_by_name FROM tenant.crm_sms_messages message LEFT JOIN users sender ON sender.id = message.sent_by
      WHERE message.organization_id = $1 AND message.entity_type = $2 AND message.entity_id = $3 ORDER BY message.created_at DESC LIMIT 100`, [context.organizationId, type, id]);
  return rows.map((row) => ({ id: row.id, phone: row.phone, body: row.body, status: row.status, error: row.error_message, sentByName: row.sent_by_name ?? null, createdAt: row.created_at }));
}

// Delivery reports: Exotel (SmsSid, Status) or MSG91 (requestId / status).
export async function receiveSmsStatus(client, organizationId, fields) {
  const id = text(fields.SmsSid ?? fields.requestId ?? fields.request_id);
  // Exotel: Status "delivered" / "failed"…; MSG91: a numeric status (1 delivered, 2 failed, 16 rejected) with a description.
  const raw = [fields.Status, fields.status, fields.desc].map(text).filter(Boolean).join(" ").toLowerCase();
  const code = text(fields.status);
  const status = /undeliv|fail|reject|expired/.test(raw) || ["2", "16"].includes(code) ? "failed" : /deliver/.test(raw) || code === "1" ? "delivered" : null;
  if (!id || !status) return { matched: false };
  const { rowCount } = await client.query(
    "UPDATE tenant.crm_sms_messages SET status = $3, status_at = now(), error_message = CASE WHEN $3 = 'failed' THEN $4 ELSE error_message END WHERE organization_id = $1 AND provider_message_id = $2 AND status <> 'delivered'",
    [organizationId, id, status, raw.slice(0, 200)]);
  return { matched: rowCount > 0, status };
}

// ------------------------------------------------------------------ the providers' callbacks

// Resolves a callback key (call or SMS) and sets the organization context. Returns { organizationId, channel }.
export async function resolveChannelWebhook(client, webhookKey) {
  const key = String(webhookKey ?? "");
  if (!/^ch_[A-Za-z0-9_-]{20,64}$/.test(key)) throw new CrmError(404, "Unknown address.", "CRM_CHANNEL_NOT_FOUND");
  const row = (await client.query("SELECT * FROM tenant.crm_resolve_channel_webhook($1)", [hash(key)])).rows[0];
  if (!row) throw new CrmError(404, "Unknown address.", "CRM_CHANNEL_NOT_FOUND");
  await setTenantContext(client, row.organization_id);
  return { organizationId: row.organization_id, channel: row.channel };
}
