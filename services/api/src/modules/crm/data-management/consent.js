// The consent ledger (CRM plan 4.3). Every change of a lead's or contact's consent or refusal is written to tenant.crm_consent_events by
// database triggers (migration 0174), so nothing changes consent without a record. This file is the API's side of it:
//
//   consentSource      tells the triggers how the change came about (a web form and its notice, an import, a conversion, a WhatsApp
//                      message…) for the rest of the transaction;
//   90-day lock        after a person opts out, staff may not record their consent again for 90 days (TRAI); the person themselves may
//                      (they send a form, they write to us);
//   opt-out list       an address or number on the organization's opt-out list is not emailed or messaged from any record;
//   history, lookup    a person's consent history, and everything CRM holds on one person (for a privacy request).
import { CrmError } from "./errors.js";

export const CONSENT_LOCK_DAYS = 90;
// Sources where the person themselves gave consent: these may lift a recent opt-out.
const PERSON_INITIATED = new Set(["web_form", "whatsapp_message", "email_reply", "self_service"]);
const CHANNEL_WORDS = Object.freeze({ email: "email", sms: "SMS", whatsapp: "WhatsApp", call: "calls", all: "any contact" });
const text = (value) => String(value ?? "").trim();

// While `work` runs, consent changes are recorded as coming from `source` with `evidence`; afterwards, as before (a later edit in the
// same transaction is not mistaken for it).
export async function withConsentSource(client, source, evidence, work) {
  const set = (value, note) => client.query("SELECT set_config('app.consent_source', $1, true), set_config('app.consent_evidence', $2, true)", [value, note]);
  await set(String(source).slice(0, 80), evidence ? String(evidence).slice(0, 2000) : "");
  try {
    return await work();
  } finally {
    await set("", "").catch(() => undefined);
  }
}

// The last ten digits of an Indian number, every digit of another (the database's tenant.crm_consent_phone).
export function consentPhone(value) {
  const raw = text(value);
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 7) return null;
  if (raw.startsWith("+") && !digits.startsWith("91")) return digits;
  return digits.slice(-10);
}

// Refuses to record consent (or lift a refusal) on `channels` within 90 days of an opt-out, unless the person themselves asks.
export async function assertConsentRequestAllowed(client, context, subjectType, subjectId, channels, { source = "manual" } = {}) {
  if (PERSON_INITIATED.has(source) || !channels.length) return;
  const { rows } = await client.query(
    `SELECT channel, recorded_at FROM tenant.crm_consent_events
      WHERE organization_id = $1 AND subject_type = $2 AND subject_id = $3 AND action = 'opt_out' AND (channel = ANY($4::text[]) OR channel = 'all')
        AND recorded_at > now() - make_interval(days => ${CONSENT_LOCK_DAYS})
      ORDER BY recorded_at DESC LIMIT 1`, [context.organizationId, subjectType, subjectId, channels]);
  if (!rows[0]) return;
  const until = new Date(new Date(rows[0].recorded_at).getTime() + CONSENT_LOCK_DAYS * 86400000).toISOString().slice(0, 10);
  throw new CrmError(409, `This person opted out of ${CHANNEL_WORDS[rows[0].channel] ?? rows[0].channel} on ${new Date(rows[0].recorded_at).toISOString().slice(0, 10)}. `
    + `Their consent can be recorded again from ${until}, or sooner only if they ask for it themselves (a form they send, a message they write).`, "CRM_CONSENT_LOCKED",
  { issues: [{ field: "consent", message: `Opted out recently; locked until ${until}.` }], until });
}

// Whether an email address or phone number is on the opt-out list for `channel`.
export async function optOutOf(client, organizationId, { email = null, phone = null }, channel) {
  const values = [];
  if (email) values.push(["email", text(email).toLowerCase()]);
  const digits = consentPhone(phone);
  if (digits) values.push(["phone", digits]);
  for (const [kind, value] of values) {
    const row = (await client.query("SELECT channels FROM tenant.crm_opt_outs WHERE organization_id = $1 AND kind = $2 AND value = $3", [organizationId, kind, value])).rows[0];
    if (row && (row.channels.includes("all") || row.channels.includes(channel))) return { kind, value };
  }
  return null;
}

export async function listConsentHistory(client, context, subjectType, subjectId) {
  const { rows } = await client.query(
    `SELECT event.*, member.full_name AS recorded_by_name FROM tenant.crm_consent_events event LEFT JOIN users member ON member.id = event.recorded_by
      WHERE event.organization_id = $1 AND event.subject_type = $2 AND event.subject_id = $3 ORDER BY event.recorded_at DESC LIMIT 200`,
    [context.organizationId, subjectType, subjectId]);
  return rows.map((row) => ({ id: row.id, channel: row.channel, action: row.action, source: row.source, evidence: row.evidence, recordedAt: row.recorded_at, recordedByName: row.recorded_by_name ?? null }));
}

// ------------------------------------------------------------------ the opt-out list

const MANAGERS = ["crm.settings.manage", "platform.privacy.manage"];
function requireManager(context) {
  if (context.roleSlugs?.includes("organization_owner") || MANAGERS.some((permission) => context.permissions?.includes(permission))) return;
  throw new CrmError(403, "You do not have permission to manage the opt-out list.", "PERMISSION_DENIED");
}

export async function listOptOuts(client, context, { search = "" } = {}) {
  requireManager(context);
  // Numbers are kept as digits: "+91 98765-43210" finds 9876543210.
  const term = text(search).toLowerCase();
  const like = `%${/^[\d\s+()-]+$/.test(term) ? term.replace(/\D/g, "").replace(/^91(?=\d{10}$)/, "") : term}%`;
  const { rows } = await client.query(
    `SELECT opt_out.*, member.full_name AS created_by_name FROM tenant.crm_opt_outs opt_out LEFT JOIN users member ON member.id = opt_out.created_by
      WHERE opt_out.organization_id = $1 AND ($2 = '%%' OR opt_out.value LIKE $2) ORDER BY opt_out.created_at DESC LIMIT 500`, [context.organizationId, like]);
  // An entry can come off the list on its own CONSENT_LOCK_DAYS after it was added (sooner only when the person asks).
  return rows.map((row) => ({ kind: row.kind, value: row.value, channels: row.channels, source: row.source, reason: row.reason, createdAt: row.created_at, createdByName: row.created_by_name ?? null,
    removableFrom: new Date(new Date(row.created_at).getTime() + CONSENT_LOCK_DAYS * 86400000).toISOString() }));
}

// Someone asked (by phone, in person) not to be contacted at an address that may not be on any record yet.
export async function addOptOut(client, context, { email, phone, channels = ["all"], reason = null } = {}) {
  requireManager(context);
  const allowed = new Set(["all", "email", "sms", "whatsapp", "call"]);
  const chosen = (Array.isArray(channels) ? channels : [channels]).filter((entry) => allowed.has(entry));
  const entries = [];
  if (text(email)) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text(email))) throw new CrmError(400, "Enter a valid email address.", "CRM_OPT_OUT_VALIDATION");
    entries.push(["email", text(email).toLowerCase()]);
  }
  if (text(phone)) {
    const digits = consentPhone(phone);
    if (!digits) throw new CrmError(400, "Enter a valid phone number.", "CRM_OPT_OUT_VALIDATION");
    entries.push(["phone", digits]);
  }
  if (!entries.length) throw new CrmError(400, "Enter an email address or a phone number.", "CRM_OPT_OUT_VALIDATION");
  for (const [kind, value] of entries)
    await client.query(
      `INSERT INTO tenant.crm_opt_outs (organization_id, kind, value, channels, source, reason, created_by) VALUES ($1, $2, $3, $4::text[], 'manual', $5, $6)
       ON CONFLICT (organization_id, kind, value) DO UPDATE SET channels = (SELECT array_agg(DISTINCT entry) FROM unnest(tenant.crm_opt_outs.channels || EXCLUDED.channels) AS entry)`,
      [context.organizationId, kind, value, chosen.length ? chosen : ["all"], text(reason).slice(0, 500) || null, context.userId ?? null]);
  return listOptOuts(client, context);
}

// Taking an entry off the list: only once its 90 days have passed (or when the person asked, said in `reason`).
export async function removeOptOut(client, context, { kind, value, personAsked = false, reason = null } = {}) {
  requireManager(context);
  const row = (await client.query("SELECT created_at FROM tenant.crm_opt_outs WHERE organization_id = $1 AND kind = $2 AND value = $3", [context.organizationId, kind, value])).rows[0];
  if (!row) throw new CrmError(404, "This address is not on the opt-out list.", "CRM_OPT_OUT_NOT_FOUND");
  const age = (Date.now() - new Date(row.created_at).getTime()) / 86400000;
  if (age < CONSENT_LOCK_DAYS && !personAsked)
    throw new CrmError(409, `Opted out ${Math.floor(age)} days ago: it can come off the list after ${CONSENT_LOCK_DAYS} days, or sooner only if the person asked.`, "CRM_CONSENT_LOCKED");
  if (personAsked && !text(reason)) throw new CrmError(400, "Say how the person asked to be contacted again.", "CRM_OPT_OUT_VALIDATION");
  await client.query("DELETE FROM tenant.crm_opt_outs WHERE organization_id = $1 AND kind = $2 AND value = $3", [context.organizationId, kind, value]);
  return { removed: true };
}

// ------------------------------------------------------------------ everything held on one person (CRM-P7)

// For a privacy request: every lead, contact, company and deal that names this email address or phone number, the emails and WhatsApp
// messages exchanged with it, its consent history and opt-out entries. For the organization owner and privacy managers.
export async function findPersonalData(client, context, { email = null, phone = null } = {}) {
  if (!(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes("platform.privacy.manage") || context.permissions?.includes("crm.settings.manage")))
    throw new CrmError(403, "You do not have permission to look up personal data.", "PERMISSION_DENIED");
  const address = text(email).toLowerCase() || null;
  const digits = consentPhone(phone);
  if (!address && !digits) throw new CrmError(400, "Enter an email address or a phone number.", "CRM_PRIVACY_LOOKUP_VALIDATION");
  const org = context.organizationId;
  const values = [org, address, digits];
  const leads = (await client.query(
    `SELECT id, code, COALESCE(NULLIF(full_name, ''), company_name) AS name, email, mobile, phone, status, created_at FROM tenant.crm_leads
      WHERE organization_id = $1 AND (($2::text IS NOT NULL AND lower(email) = $2) OR ($3::text IS NOT NULL AND (normalized_mobile = $3 OR normalized_business_phone = $3)))`, values)).rows;
  const contacts = (await client.query(
    `SELECT id, contact_number AS code, display_name AS name, email, mobile, phone, status, created_at FROM tenant.contacts
      WHERE organization_id = $1 AND (($2::text IS NOT NULL AND (lower(email) = $2 OR normalized_secondary_email = $2)) OR ($3::text IS NOT NULL AND (normalized_mobile = $3 OR normalized_work_phone = $3 OR normalized_alternate_phone = $3)))`, values)).rows;
  const companies = (await client.query(
    `SELECT id, code, display_name AS name, email, phone, status, created_at FROM tenant.business_parties
      WHERE organization_id = $1 AND (($2::text IS NOT NULL AND lower(email) = $2) OR ($3::text IS NOT NULL AND tenant.crm_consent_phone(phone) = $3))`, values)).rows;
  const contactIds = contacts.map((row) => row.id);
  const leadIds = leads.map((row) => row.id);
  const deals = (await client.query(
    `SELECT id, code, name, status, amount, currency_code, created_at FROM tenant.crm_opportunities
      WHERE organization_id = $1 AND (contact_id = ANY($2::uuid[]) OR lead_id = ANY($3::uuid[]))`, [org, contactIds, leadIds])).rows;
  const emails = (await client.query(
    `SELECT id, entity_type, entity_id, direction, subject, created_at FROM tenant.crm_email_messages
      WHERE organization_id = $1 AND $2::text IS NOT NULL AND (lower(from_address) = $2 OR $2 = ANY(to_addresses) OR $2 = ANY(cc_addresses)) ORDER BY created_at DESC LIMIT 200`, [org, address])).rows;
  const whatsapp = (await client.query(
    `SELECT id, entity_type, entity_id, direction, created_at FROM tenant.crm_whatsapp_messages
      WHERE organization_id = $1 AND $2::text IS NOT NULL AND tenant.crm_consent_phone(phone) = $2 ORDER BY created_at DESC LIMIT 200`, [org, digits])).rows;
  const consent = (await client.query(
    `SELECT subject_type, subject_id, channel, action, source, evidence, recorded_at FROM tenant.crm_consent_events
      WHERE organization_id = $1 AND (($2::text IS NOT NULL AND email = $2) OR ($3::text IS NOT NULL AND phone = $3)
            OR (subject_type = 'lead' AND subject_id = ANY($4::uuid[])) OR (subject_type = 'contact' AND subject_id = ANY($5::uuid[])))
      ORDER BY recorded_at DESC LIMIT 500`, [org, address, digits, leadIds, contactIds])).rows;
  const optOuts = (await client.query(
    "SELECT kind, value, channels, source, created_at FROM tenant.crm_opt_outs WHERE organization_id = $1 AND ((kind = 'email' AND value = $2) OR (kind = 'phone' AND value = $3))", values)).rows;
  return {
    query: { email: address, phone: digits },
    leads: leads.map((row) => ({ id: row.id, code: row.code, name: row.name, email: row.email, mobile: row.mobile, phone: row.phone, status: row.status, createdAt: row.created_at })),
    contacts: contacts.map((row) => ({ id: row.id, code: row.code, name: row.name, email: row.email, mobile: row.mobile, phone: row.phone, status: row.status, createdAt: row.created_at })),
    companies: companies.map((row) => ({ id: row.id, code: row.code, name: row.name, email: row.email, phone: row.phone, status: row.status, createdAt: row.created_at })),
    deals: deals.map((row) => ({ id: row.id, code: row.code, name: row.name, status: row.status, amount: Number(row.amount ?? 0), currencyCode: row.currency_code, createdAt: row.created_at })),
    emails: emails.map((row) => ({ id: row.id, recordType: row.entity_type, recordId: row.entity_id, direction: row.direction, subject: row.subject, at: row.created_at })),
    whatsapp: whatsapp.map((row) => ({ id: row.id, recordType: row.entity_type, recordId: row.entity_id, direction: row.direction, at: row.created_at })),
    consent: consent.map((row) => ({ subjectType: row.subject_type, subjectId: row.subject_id, channel: row.channel, action: row.action, source: row.source, evidence: row.evidence, at: row.recorded_at })),
    optOuts: optOuts.map((row) => ({ kind: row.kind, value: row.value, channels: row.channels, source: row.source, at: row.created_at })),
  };
}
