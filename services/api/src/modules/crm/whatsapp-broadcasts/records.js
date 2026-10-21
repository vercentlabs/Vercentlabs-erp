// WhatsApp broadcasts (CRM audit M2): one approved template to many leads or contacts, sent by the worker through the organization's
// connected WhatsApp Business number (Setup › WhatsApp).
//
//   audience   leads or contacts, narrowed by the campaign-email filters; only people with a mobile who agreed to WhatsApp, did not
//              refuse it (a lead's do-not-contact, a contact's no-WhatsApp or marketing opt-out) and are not on the opt-out list
//              receive it — the others are listed as skipped with why. One message per number.
//   message    WhatsApp lets a business start a conversation only with a template approved in WhatsApp Manager: the broadcast names
//              it, its language and its body values; {{first_name}}, {{last_name}}, {{name}} and {{company}} in a value are filled in.
//   sending    when scheduled (now or at a time) the recipients are fixed; the worker sends 50 per tick, checking the opt-out list
//              again just before each. Each message is logged on the person's record like any other WhatsApp, so the delivery and
//              read receipts and the replies that reach the webhook give the broadcast's figures. A reply of STOP opts the number out.
import { CrmError } from "../data-management/errors.js";
import { consentPhone } from "../data-management/consent.js";
import { decryptSecret } from "../../../core/platform/secrets/index.js";
import { countOutboundMessages } from "../../../core/billing/usage.js";
import { logWhatsAppMessage } from "../whatsapp/records.js";

const MANAGE = "crm.settings.manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 50;
const MAX_RECIPIENTS = 20000;
const MAX_PARAMETERS = 10;
const GRAPH = "https://graph.facebook.com/v21.0";
const text = (value) => String(value ?? "").trim();
const has = (input, field) => Object.prototype.hasOwnProperty.call(input ?? {}, field);
const invalid = (field, message) => new CrmError(400, message, "CRM_BROADCAST_VALIDATION", { issues: [{ field, message }] });
const PLACEHOLDER = /\{\{\s*(first_name|last_name|name|company)\s*\}\}/g;

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, "You do not have permission to send WhatsApp broadcasts.", "PERMISSION_DENIED");
}

// The number as WhatsApp wants it: digits with the country code. A bare 10-digit Indian mobile (or one written 0 98…) gets 91.
export function whatsAppNumber(value) {
  const raw = text(value);
  let digits = raw.replace(/\D/g, "");
  if (!raw.startsWith("+")) {
    if (/^0[6-9][0-9]{9}$/.test(digits)) digits = digits.slice(1);
    if (/^[6-9][0-9]{9}$/.test(digits)) digits = `91${digits}`;
  }
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

const FILTERS = Object.freeze({
  leads: { status: "lead.status", stage: "lead.stage", sourceId: "lead.source_id", campaignId: "lead.campaign_id", ownerId: "lead.owner_user_id", rating: "lead.rating",
    state: "lower(lead.state)", city: "lower(lead.city)", district: "lower(lead.district)" },
  contacts: { ownerId: "person.owner_user_id", city: "lower(person.city)", accountId: "person.party_id" },
});

function cleanFilters(audience, value) {
  const out = {};
  for (const [key, raw] of Object.entries(value && typeof value === "object" ? value : {})) {
    if (key === "tagId" && audience === "leads" && UUID.test(String(raw))) { out.tagId = String(raw); continue; }
    if (!FILTERS[audience][key] || text(raw) === "") continue;
    out[key] = ["state", "city", "district"].includes(key) ? text(raw).toLowerCase().slice(0, 120) : text(raw).slice(0, 120);
  }
  return out;
}

// The audience with, for each person, the number to message and whether they may receive it (skip_reason null) — before the
// opt-out list and duplicate numbers, which `withReasons` adds.
async function audienceRows(client, organizationId, audience, filters) {
  const values = [organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = Object.entries(filters).filter(([key]) => key !== "tagId").map(([key, value]) => `${FILTERS[audience][key]} = ${bind(value)}`);
  if (audience === "leads") {
    if (filters.tagId) where.push(`EXISTS (SELECT 1 FROM tenant.crm_record_tags tagged WHERE tagged.organization_id = $1 AND tagged.entity_type = 'lead' AND tagged.entity_id = lead.id AND tagged.tag_id = ${bind(filters.tagId)})`);
    return (await client.query(
      `SELECT 'lead' AS entity_type, lead.id, COALESCE(NULLIF(btrim(lead.mobile), ''), NULLIF(btrim(lead.phone), '')) AS phone, lead.first_name, lead.last_name, lead.company_name AS company,
              CASE WHEN COALESCE(btrim(lead.mobile), btrim(lead.phone), '') = '' THEN 'No mobile number' WHEN lead.do_not_contact THEN 'Asked not to be contacted'
                   WHEN NOT lead.consent_whatsapp THEN 'Has not agreed to WhatsApp' END AS skip_reason
         FROM tenant.crm_leads lead
        WHERE lead.organization_id = $1 AND lead.archived_at IS NULL AND lead.merged_into_lead_id IS NULL AND lead.status <> 'converted' ${where.map((clause) => `AND ${clause}`).join(" ")}
        ORDER BY lead.created_at LIMIT ${MAX_RECIPIENTS + 1}`, values)).rows;
  }
  return (await client.query(
    `SELECT 'contact' AS entity_type, person.id, COALESCE(NULLIF(btrim(person.whatsapp_number), ''), NULLIF(btrim(person.mobile), ''), NULLIF(btrim(person.phone), '')) AS phone, person.first_name, person.last_name, party.display_name AS company,
            CASE WHEN COALESCE(btrim(person.whatsapp_number), btrim(person.mobile), btrim(person.phone), '') = '' THEN 'No mobile number' WHEN person.do_not_whatsapp THEN 'Does not accept WhatsApp'
                 WHEN person.marketing_consent = 'opted_out' THEN 'Opted out of marketing'
                 WHEN NOT person.consent_whatsapp THEN 'Has not agreed to WhatsApp' END AS skip_reason
       FROM tenant.contacts person LEFT JOIN tenant.business_parties party ON party.organization_id = person.organization_id AND party.id = person.party_id
      WHERE person.organization_id = $1 AND person.status = 'active' ${where.map((clause) => `AND ${clause}`).join(" ")}
      ORDER BY person.created_at LIMIT ${MAX_RECIPIENTS + 1}`, values)).rows;
}

// The numbers on the organization's opt-out list for WhatsApp (by consentPhone, as the list keeps them).
async function optedOutNumbers(client, organizationId) {
  const { rows } = await client.query("SELECT value FROM tenant.crm_opt_outs WHERE organization_id = $1 AND kind = 'phone' AND channels && ARRAY['all', 'whatsapp']::text[]", [organizationId]);
  return new Set(rows.map((row) => row.value));
}

// Each person with { number, reason }: the final skip reason (or null) after the opt-out list, a number WhatsApp can't take and repeats.
async function withReasons(client, organizationId, rows) {
  const optedOut = await optedOutNumbers(client, organizationId);
  const seen = new Set();
  return rows.map((person) => {
    const number = whatsAppNumber(person.phone);
    let reason = person.skip_reason;
    if (!reason && !number) reason = "Not a mobile number WhatsApp can reach";
    if (!reason && optedOut.has(consentPhone(person.phone))) reason = "On the opt-out list";
    if (!reason && seen.has(number)) reason = "Same number as another person";
    if (!reason) seen.add(number);
    return { ...person, number, reason };
  });
}

// Who a broadcast would reach, before it is sent: { total, eligible, skipped: { reason: count }, tooMany }.
export async function previewBroadcastAudience(client, context, { audience, filters } = {}) {
  requireManage(context);
  if (!FILTERS[audience]) throw invalid("audience", "Choose leads or contacts.");
  const rows = await withReasons(client, context.organizationId, await audienceRows(client, context.organizationId, audience, cleanFilters(audience, filters)));
  const skipped = {};
  let eligible = 0;
  for (const row of rows) {
    if (row.reason) skipped[row.reason] = (skipped[row.reason] ?? 0) + 1;
    else eligible += 1;
  }
  return { total: rows.length, eligible, skipped, tooMany: rows.length > MAX_RECIPIENTS };
}

function toBroadcast(row) {
  return {
    id: row.id, name: row.name, audience: row.audience, filters: row.audience_filters ?? {}, templateName: row.template_name, templateLanguage: row.template_language,
    parameters: Array.isArray(row.parameters) ? row.parameters : [], campaignId: row.campaign_id ?? null,
    status: row.status, scheduledAt: row.scheduled_at, startedAt: row.started_at, finishedAt: row.finished_at, createdAt: row.created_at, createdByName: row.created_by_name ?? null,
    counts: { recipients: Number(row.recipients ?? 0), sent: Number(row.sent ?? 0), skipped: Number(row.skipped ?? 0), failed: Number(row.failed ?? 0),
      delivered: Number(row.delivered ?? 0), read: Number(row.read ?? 0), replied: Number(row.replied ?? 0) },
  };
}
// The figures in one pass over each broadcast's recipients and the messages they were sent: delivered counts read ones too (a read
// message was delivered); replied is anyone who wrote back after it went.
const BROADCAST_SELECT = `SELECT broadcast.*, member.full_name AS created_by_name, counts.*
  FROM tenant.crm_whatsapp_broadcasts broadcast LEFT JOIN users member ON member.id = broadcast.created_by
  LEFT JOIN LATERAL (
    SELECT count(*) AS recipients, count(*) FILTER (WHERE r.status = 'sent') AS sent, count(*) FILTER (WHERE r.status = 'skipped') AS skipped,
           count(*) FILTER (WHERE r.status = 'failed' OR message.status = 'failed') AS failed,
           count(*) FILTER (WHERE message.status IN ('delivered', 'read')) AS delivered, count(*) FILTER (WHERE message.status = 'read') AS read,
           count(*) FILTER (WHERE r.status = 'sent' AND EXISTS (SELECT 1 FROM tenant.crm_whatsapp_messages reply WHERE reply.organization_id = r.organization_id
             AND reply.phone = message.phone AND reply.direction = 'inbound' AND reply.created_at > r.sent_at)) AS replied
      FROM tenant.crm_whatsapp_broadcast_recipients r
      LEFT JOIN tenant.crm_whatsapp_messages message ON message.organization_id = r.organization_id AND message.id = r.message_id
     WHERE r.organization_id = broadcast.organization_id AND r.broadcast_id = broadcast.id) counts ON true`;

export async function listBroadcasts(client, context) {
  requireManage(context);
  return (await client.query(`${BROADCAST_SELECT} WHERE broadcast.organization_id = $1 ORDER BY broadcast.created_at DESC LIMIT 200`, [context.organizationId])).rows.map(toBroadcast);
}

export async function getBroadcast(client, context, broadcastId) {
  requireManage(context);
  const row = UUID.test(String(broadcastId ?? "")) ? (await client.query(`${BROADCAST_SELECT} WHERE broadcast.organization_id = $1 AND broadcast.id = $2`, [context.organizationId, broadcastId])).rows[0] : null;
  if (!row) throw new CrmError(404, "WhatsApp broadcast not found.", "CRM_BROADCAST_NOT_FOUND");
  return toBroadcast(row);
}

async function clean(client, context, input, current = null) {
  const out = {};
  if (!current || has(input, "name")) { out.name = text(input.name).slice(0, 120); if (!out.name) throw invalid("name", "Name the broadcast."); }
  if (!current || has(input, "audience")) { out.audience = input.audience; if (!FILTERS[out.audience]) throw invalid("audience", "Choose leads or contacts."); }
  const audience = out.audience ?? current?.audience;
  if (!current || has(input, "filters") || has(input, "audience")) out.audience_filters = JSON.stringify(cleanFilters(audience, input.filters ?? current?.audience_filters));
  if (!current || has(input, "templateName")) {
    out.template_name = text(input.templateName);
    if (!/^[a-z0-9_]{1,512}$/.test(out.template_name)) throw invalid("templateName", "Use the template's name as approved in WhatsApp Manager (lower case and underscores).");
  }
  if (!current || has(input, "templateLanguage")) {
    out.template_language = text(input.templateLanguage) || "en";
    if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(out.template_language)) throw invalid("templateLanguage", "Use the template's language code, such as en, en_US or hi.");
  }
  if (!current || has(input, "parameters")) {
    const list = Array.isArray(input.parameters) ? input.parameters : [];
    if (list.length > MAX_PARAMETERS) throw invalid("parameters", `A template takes at most ${MAX_PARAMETERS} values here.`);
    const values = list.map((value) => text(value).slice(0, 1000));
    if (values.some((value) => !value)) throw invalid("parameters", "Fill in every template value, or remove the empty ones.");
    out.parameters = JSON.stringify(values);
  }
  if (has(input, "campaignId")) {
    out.campaign_id = input.campaignId || null;
    if (out.campaign_id && !(UUID.test(String(out.campaign_id)) && (await client.query("SELECT 1 FROM tenant.crm_campaigns WHERE organization_id = $1 AND id = $2", [context.organizationId, out.campaign_id])).rows[0]))
      throw invalid("campaignId", "Choose a campaign from the list.");
  }
  return out;
}
const JSON_COLUMNS = new Set(["audience_filters", "parameters"]);

// input: { name, audience: leads | contacts, filters?, templateName, templateLanguage?, parameters?: string[], campaignId? }
export async function createBroadcast(client, context, input = {}) {
  requireManage(context);
  const fields = await clean(client, context, input);
  const columns = Object.keys(fields);
  const row = (await client.query(
    `INSERT INTO tenant.crm_whatsapp_broadcasts (organization_id, created_by, updated_by, ${columns.join(", ")})
     VALUES ($1, $2, $2, ${columns.map((column, index) => `$${index + 3}${JSON_COLUMNS.has(column) ? "::jsonb" : ""}`).join(", ")}) RETURNING id`,
    [context.organizationId, context.userId ?? null, ...columns.map((column) => fields[column])])).rows[0];
  return getBroadcast(client, context, row.id);
}

async function lockBroadcast(client, context, broadcastId) {
  const row = UUID.test(String(broadcastId ?? "")) ? (await client.query("SELECT * FROM tenant.crm_whatsapp_broadcasts WHERE organization_id = $1 AND id = $2 FOR UPDATE", [context.organizationId, broadcastId])).rows[0] : null;
  if (!row) throw new CrmError(404, "WhatsApp broadcast not found.", "CRM_BROADCAST_NOT_FOUND");
  return row;
}

export async function updateBroadcast(client, context, broadcastId, input = {}) {
  requireManage(context);
  const row = await lockBroadcast(client, context, broadcastId);
  if (row.status !== "draft") throw new CrmError(409, "Only a draft can be changed. Cancel it first to change what is sent.", "CRM_BROADCAST_NOT_DRAFT");
  const fields = await clean(client, context, input, row);
  const columns = Object.keys(fields);
  if (columns.length)
    await client.query(`UPDATE tenant.crm_whatsapp_broadcasts SET ${columns.map((column, index) => `${column} = $${index + 4}${JSON_COLUMNS.has(column) ? "::jsonb" : ""}`).join(", ")},
      updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, context.userId ?? null, ...columns.map((column) => fields[column])]);
  return getBroadcast(client, context, row.id);
}

async function connected(client, organizationId) {
  const settings = (await client.query("SELECT * FROM tenant.crm_whatsapp_settings WHERE organization_id = $1", [organizationId])).rows[0];
  return settings?.mode === "cloud_api" && settings.phone_number_id ? settings : null;
}

// Fixes the recipients and schedules the sending: now, or at `scheduledAt`. Needs WhatsApp Business connected.
export async function scheduleBroadcast(client, context, broadcastId, { scheduledAt = null } = {}) {
  requireManage(context);
  const row = await lockBroadcast(client, context, broadcastId);
  if (row.status !== "draft") throw new CrmError(409, "This broadcast is already scheduled or sent.", "CRM_BROADCAST_NOT_DRAFT");
  if (!(await connected(client, context.organizationId)))
    throw new CrmError(409, "Connect your WhatsApp Business number first (Setup › WhatsApp): a broadcast is sent by WhatsApp itself, not from a phone.", "CRM_WHATSAPP_NOT_CONNECTED");
  const at = scheduledAt ? new Date(scheduledAt) : null;
  if (at && Number.isNaN(at.getTime())) throw invalid("scheduledAt", "Choose when to send it.");
  const rows = await audienceRows(client, context.organizationId, row.audience, row.audience_filters ?? {});
  if (rows.length > MAX_RECIPIENTS) throw new CrmError(409, `A broadcast goes to at most ${MAX_RECIPIENTS.toLocaleString("en-IN")} people. Narrow the audience.`, "CRM_BROADCAST_TOO_MANY");
  const people = await withReasons(client, context.organizationId, rows);
  const eligible = people.filter((person) => !person.reason).length;
  if (!eligible) throw new CrmError(409, "Nobody in this audience may get a WhatsApp broadcast: check consent, mobile numbers and the opt-out list.", "CRM_BROADCAST_NO_RECIPIENTS");
  for (let start = 0; start < people.length; start += 1000) {
    const batch = people.slice(start, start + 1000);
    await client.query(
      `INSERT INTO tenant.crm_whatsapp_broadcast_recipients (organization_id, broadcast_id, entity_type, entity_id, phone, status, skip_reason)
       SELECT $1, $2, person.entity_type, person.entity_id, person.phone, person.status, person.skip_reason
         FROM unnest($3::text[], $4::uuid[], $5::text[], $6::text[], $7::text[]) AS person(entity_type, entity_id, phone, status, skip_reason)
       ON CONFLICT (broadcast_id, entity_type, entity_id) DO NOTHING`,
      [context.organizationId, row.id, batch.map((person) => person.entity_type), batch.map((person) => person.id), batch.map((person) => person.number ?? person.phone ?? "-"),
        batch.map((person) => (person.reason ? "skipped" : "queued")), batch.map((person) => person.reason ?? null)]);
  }
  await client.query("UPDATE tenant.crm_whatsapp_broadcasts SET status = 'scheduled', scheduled_at = COALESCE($3, now()), updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, row.id, at, context.userId ?? null]);
  return getBroadcast(client, context, row.id);
}

// Stops a scheduled or sending broadcast (what was sent stays sent); a draft is simply cancelled.
export async function cancelBroadcast(client, context, broadcastId) {
  requireManage(context);
  const row = await lockBroadcast(client, context, broadcastId);
  if (["sent", "cancelled"].includes(row.status)) throw new CrmError(409, "This broadcast is already finished.", "CRM_BROADCAST_FINISHED");
  await client.query("UPDATE tenant.crm_whatsapp_broadcasts SET status = 'cancelled', finished_at = now(), updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, row.id, context.userId ?? null]);
  await client.query("UPDATE tenant.crm_whatsapp_broadcast_recipients SET status = 'skipped', skip_reason = 'Cancelled before sending' WHERE organization_id = $1 AND broadcast_id = $2 AND status = 'queued'",
    [context.organizationId, row.id]);
  return getBroadcast(client, context, row.id);
}

// ------------------------------------------------------------------ sending (worker)

const fill = (template, person) => String(template).replace(PLACEHOLDER, (_, key) => {
  const name = [person.first_name, person.last_name].filter(Boolean).join(" ");
  return { first_name: person.first_name ?? "", last_name: person.last_name ?? "", name, company: person.company ?? "" }[key] ?? "";
});
const personFor = async (client, organizationId, recipient) => (await client.query(recipient.entity_type === "lead"
  ? "SELECT first_name, last_name, company_name AS company, owner_user_id FROM tenant.crm_leads WHERE organization_id = $1 AND id = $2"
  : `SELECT person.first_name, person.last_name, party.display_name AS company, person.owner_user_id FROM tenant.contacts person
       LEFT JOIN tenant.business_parties party ON party.organization_id = person.organization_id AND party.id = person.party_id WHERE person.organization_id = $1 AND person.id = $2`,
[organizationId, recipient.entity_id])).rows[0] ?? {};

// The worker's tick for one organization: due broadcasts start, and up to `batch` of their recipients are messaged.
// options: { batch, env, fetchImpl }
export async function runBroadcasts(client, organizationId, { batch = BATCH, env = process.env, fetchImpl = fetch } = {}) {
  await client.query(`UPDATE tenant.crm_whatsapp_broadcasts SET status = 'sending', started_at = now() WHERE organization_id = $1 AND status = 'scheduled' AND scheduled_at <= now()`, [organizationId]);
  const result = { sent: 0, failed: 0, skipped: 0, finished: 0 };
  const due = (await client.query(
    `SELECT recipient.*, broadcast.template_name, broadcast.template_language, broadcast.parameters, broadcast.created_by
       FROM tenant.crm_whatsapp_broadcast_recipients recipient JOIN tenant.crm_whatsapp_broadcasts broadcast ON broadcast.id = recipient.broadcast_id
      WHERE recipient.organization_id = $1 AND recipient.status = 'queued' AND broadcast.status = 'sending'
      ORDER BY broadcast.started_at, recipient.id LIMIT $2 FOR UPDATE OF recipient SKIP LOCKED`, [organizationId, batch])).rows;
  if (due.length) {
    const settings = await connected(client, organizationId);
    const credentials = settings ? await decryptSecret(settings.encrypted_credentials, env) : null;
    const optedOut = await optedOutNumbers(client, organizationId);
    let stop = settings ? null : "WhatsApp Business was disconnected before this was sent.";
    for (const recipient of due) {
      if (stop) {
        await client.query("UPDATE tenant.crm_whatsapp_broadcast_recipients SET status = 'failed', error = $2 WHERE id = $1", [recipient.id, stop]);
        result.failed += 1;
        continue;
      }
      if (optedOut.has(consentPhone(`+${recipient.phone}`))) {
        await client.query("UPDATE tenant.crm_whatsapp_broadcast_recipients SET status = 'skipped', skip_reason = 'On the opt-out list' WHERE id = $1", [recipient.id]);
        result.skipped += 1;
        continue;
      }
      const person = await personFor(client, organizationId, recipient);
      const parameters = (Array.isArray(recipient.parameters) ? recipient.parameters : []).map((value) => ({ type: "text", text: fill(value, person).slice(0, 1000) || "-" }));
      const payload = { messaging_product: "whatsapp", to: recipient.phone, type: "template",
        template: { name: recipient.template_name, language: { code: recipient.template_language }, ...(parameters.length ? { components: [{ type: "body", parameters }] } : {}) } };
      try {
        // Counts towards the plan's monthly messages; at the limit the rest of the batch waits for next month (marked failed with why).
        await countOutboundMessages(client, organizationId, { channel: "whatsapp", idempotencyKey: `broadcast:${recipient.id}` }, env);
      } catch (error) {
        stop = String(error?.message ?? error).slice(0, 300);
        await client.query("UPDATE tenant.crm_whatsapp_broadcast_recipients SET status = 'failed', error = $2 WHERE id = $1", [recipient.id, stop]);
        result.failed += 1;
        continue;
      }
      try {
        const response = await fetchImpl(`${GRAPH}/${encodeURIComponent(settings.phone_number_id)}/messages`, {
          method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${credentials.accessToken}` }, body: JSON.stringify(payload),
        });
        const answer = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(`WhatsApp refused the message: ${answer?.error?.message ?? response.status}`);
        const shown = [`Template ${recipient.template_name}`, ...parameters.map((entry) => entry.text)].join(" · ");
        const messageId = await logWhatsAppMessage(client, organizationId, { type: recipient.entity_type, id: recipient.entity_id, direction: "outbound", channel: "cloud_api",
          phone: `+${recipient.phone}`, body: shown, templateName: recipient.template_name, templateLanguage: recipient.template_language,
          waMessageId: answer?.messages?.[0]?.id ?? null, status: "sent", userId: recipient.created_by ?? null, owner: person.owner_user_id ?? null });
        await client.query("UPDATE tenant.crm_whatsapp_broadcast_recipients SET status = 'sent', sent_at = now(), message_id = $2 WHERE id = $1", [recipient.id, messageId]);
        result.sent += 1;
      } catch (error) {
        await client.query("UPDATE tenant.crm_whatsapp_broadcast_recipients SET status = 'failed', error = $2 WHERE id = $1", [recipient.id, String(error?.message ?? error).slice(0, 300)]);
        result.failed += 1;
      }
    }
  }
  const finished = await client.query(
    `UPDATE tenant.crm_whatsapp_broadcasts broadcast SET status = 'sent', finished_at = now() WHERE broadcast.organization_id = $1 AND broadcast.status = 'sending'
        AND NOT EXISTS (SELECT 1 FROM tenant.crm_whatsapp_broadcast_recipients r WHERE r.broadcast_id = broadcast.id AND r.status = 'queued')`, [organizationId]);
  result.finished = finished.rowCount;
  return result;
}

export async function hasDueBroadcasts(client, organizationId) {
  return Boolean((await client.query("SELECT 1 FROM tenant.crm_whatsapp_broadcasts WHERE organization_id = $1 AND (status = 'sending' OR (status = 'scheduled' AND scheduled_at <= now())) LIMIT 1",
    [organizationId])).rows[0]);
}
