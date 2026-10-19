// Email from a CRM record (CRM plan 4.1): a lead, deal, company or contact is emailed from its own page, from a template or written
// fresh. The email goes from the workspace's address in the sender's name, with replies directed to the organization's CRM reply address
// (its email-to-lead address, step 3.1) and the record's number in the subject, so the answer lands back on the same record. It is kept
// with its own message id (a reply threads on it), shows on the record's timeline, and counts as our response to a new lead.
//
// Nobody is emailed who refused it: a do-not-contact lead, or any recipient who is a contact (or lead) that does not accept email.
import { escapeHtml, sendMail } from "../../../core/platform/mail/index.js";
import { randomUUID } from "node:crypto";

import { assertMayContact } from "../data-management/contact-preferences.js";
import { CrmError } from "../data-management/errors.js";
import { recordVisible } from "../notes/access.js";

export const EMAIL_RECORD_TYPES = Object.freeze(["lead", "opportunity", "party", "contact"]);
const EDIT = Object.freeze({ lead: "crm.leads.edit", opportunity: "crm.opportunities.edit", party: "crm.accounts.edit", contact: "crm.contacts.edit" });
const TABLE = Object.freeze({ lead: "crm_leads", opportunity: "crm_opportunities", party: "business_parties", contact: "contacts" });
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const text = (value) => String(value ?? "").trim();
const invalid = (field, message) => new CrmError(400, message, "CRM_EMAIL_VALIDATION", { issues: [{ field, message }] });
const money = (amount, currency) => (amount === null || amount === undefined ? "" : `${currency ?? ""} ${Number(amount).toLocaleString("en-IN")}`.trim());

function canEdit(context, type) {
  return Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(EDIT[type]));
}

// What a template's placeholders read for a record, and who it is addressed to by default.
async function recordFacts(client, context, type, id) {
  const org = context.organizationId;
  const sender = (await client.query(
    `SELECT app_user.full_name, app_user.email, organization.name AS organization_name FROM public.users app_user, public.organizations organization
      WHERE app_user.id = $1 AND organization.id = $2`, [context.userId, org])).rows[0] ?? {};
  let row;
  if (type === "lead") {
    row = (await client.query(
      `SELECT lead.code, lead.first_name, lead.last_name, lead.company_name, lead.email, lead.product_interest, owner.full_name AS owner_name
         FROM tenant.crm_leads lead LEFT JOIN users owner ON owner.id = lead.owner_user_id WHERE lead.organization_id = $1 AND lead.id = $2`, [org, id])).rows[0];
    if (!row) return null;
    return { code: row.code, to: row.email, consent: { leadId: id }, values: { first_name: row.first_name, last_name: row.last_name, company: row.company_name,
      product_interest: row.product_interest, owner_name: row.owner_name }, sender };
  }
  if (type === "opportunity") {
    row = (await client.query(
      `SELECT deal.code, deal.name, deal.amount, deal.currency_code, deal.expected_close_date::text AS close_date, account.display_name AS company,
              contact.id AS contact_id, contact.email, contact.first_name, contact.last_name, owner.full_name AS owner_name
         FROM tenant.crm_opportunities deal
         LEFT JOIN tenant.business_parties account ON account.organization_id = deal.organization_id AND account.id = deal.party_id
         LEFT JOIN tenant.contacts contact ON contact.organization_id = deal.organization_id AND contact.id = deal.contact_id
         LEFT JOIN users owner ON owner.id = deal.owner_user_id
        WHERE deal.organization_id = $1 AND deal.id = $2`, [org, id])).rows[0];
    if (!row) return null;
    return { code: row.code, to: row.email, consent: { contactId: row.contact_id }, values: { first_name: row.first_name, last_name: row.last_name, company: row.company,
      deal_name: row.name, amount: money(row.amount, row.currency_code), close_date: row.close_date, owner_name: row.owner_name }, sender };
  }
  if (type === "party") {
    row = (await client.query(
      `SELECT party.code, party.display_name, party.email, owner.full_name AS owner_name,
              primary_contact.email AS contact_email, primary_contact.first_name, primary_contact.last_name, primary_contact.id AS contact_id
         FROM tenant.business_parties party LEFT JOIN users owner ON owner.id = party.owner_user_id
         LEFT JOIN LATERAL (SELECT contact.* FROM tenant.contacts contact WHERE contact.organization_id = party.organization_id AND contact.party_id = party.id
                              AND contact.status = 'active' ORDER BY contact.is_primary DESC NULLS LAST, contact.created_at LIMIT 1) primary_contact ON true
        WHERE party.organization_id = $1 AND party.id = $2`, [org, id])).rows[0];
    if (!row) return null;
    return { code: row.code, to: row.email ?? row.contact_email, consent: row.email ? {} : { contactId: row.contact_id },
      values: { first_name: row.first_name, last_name: row.last_name, company: row.display_name, owner_name: row.owner_name }, sender };
  }
  row = (await client.query(
    `SELECT contact.contact_number AS code, contact.first_name, contact.last_name, contact.email, party.display_name AS company, owner.full_name AS owner_name
       FROM tenant.contacts contact
       LEFT JOIN tenant.business_parties party ON party.organization_id = contact.organization_id AND party.id = contact.party_id
       LEFT JOIN users owner ON owner.id = contact.owner_user_id
      WHERE contact.organization_id = $1 AND contact.id = $2`, [org, id])).rows[0];
  if (!row) return null;
  return { code: row.code, to: row.email, consent: { contactId: id }, values: { first_name: row.first_name, last_name: row.last_name, company: row.company, owner_name: row.owner_name }, sender };
}

// The placeholders a template may use, with what each means.
export const EMAIL_PLACEHOLDERS = Object.freeze([
  { key: "first_name", label: "First name of the person" }, { key: "last_name", label: "Last name" }, { key: "name", label: "Full name" },
  { key: "company", label: "Company" }, { key: "deal_name", label: "Deal name (deals)" }, { key: "amount", label: "Deal value (deals)" },
  { key: "close_date", label: "Expected close date (deals)" }, { key: "product_interest", label: "What they asked about (leads)" },
  { key: "record_number", label: "The record's number" }, { key: "owner_name", label: "Owner of the record" },
  { key: "my_name", label: "Your name" }, { key: "organization", label: "Your organization's name" },
]);

function placeholderValues(facts) {
  const name = [facts.values.first_name, facts.values.last_name].filter(Boolean).join(" ");
  return { ...facts.values, name, record_number: facts.code, my_name: facts.sender.full_name, organization: facts.sender.organization_name };
}

// {{first_name}} → its value; an unknown or empty placeholder reads as nothing (never as the raw braces).
export function fillPlaceholders(template, values) {
  return String(template ?? "").replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, key) => (values[key] === null || values[key] === undefined ? "" : String(values[key])));
}

// The language the record's person speaks (CRM plan 5.6): the lead's, the contact's, or — for a deal or company — its primary contact's.
async function recipientLanguage(client, organizationId, entityType, entityId) {
  const sql = {
    lead: "SELECT language_code AS language FROM tenant.crm_leads WHERE organization_id = $1 AND id = $2",
    contact: "SELECT preferred_language AS language FROM tenant.contacts WHERE organization_id = $1 AND id = $2",
    opportunity: `SELECT contact.preferred_language AS language FROM tenant.crm_opportunities deal JOIN tenant.contacts contact ON contact.organization_id = deal.organization_id AND contact.id = deal.contact_id
                   WHERE deal.organization_id = $1 AND deal.id = $2`,
    party: `SELECT contact.preferred_language AS language FROM tenant.contacts contact WHERE contact.organization_id = $1 AND contact.party_id = $2 AND contact.status = 'active'
             AND contact.preferred_language IS NOT NULL ORDER BY contact.created_at LIMIT 1`,
  }[entityType];
  return sql ? (await client.query(sql, [organizationId, entityId])).rows[0]?.language ?? null : null;
}

// A template in a language: its translation when it has one, else itself.
export function templateIn(template, language) {
  const translated = language ? template.translations?.[language] : null;
  return translated?.subject && translated?.body ? { subject: translated.subject, body: translated.body, language } : { subject: template.subject, body: template.body, language: null };
}

async function emailSettings(client, organizationId) {
  return (await client.query("SELECT reply_to_address, signature FROM tenant.crm_email_settings WHERE organization_id = $1", [organizationId])).rows[0] ?? {};
}

// The email as it will go, for the composer: recipient, subject and body from a template (or empty), the signature, and who refused.
export async function prepareRecordEmail(client, context, entityType, entityId, { templateId = null } = {}) {
  if (!EMAIL_RECORD_TYPES.includes(entityType)) throw invalid("entityType", "Email goes from a lead, deal, company or contact.");
  if (!(await recordVisible(client, context, entityType, entityId))) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_EMAIL_RECORD");
  const facts = await recordFacts(client, context, entityType, entityId);
  if (!facts) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_EMAIL_RECORD");
  const values = placeholderValues(facts);
  let subject = "";
  let body = "";
  let templateLanguage = null;
  if (templateId) {
    const template = (await client.query("SELECT * FROM tenant.crm_email_templates WHERE organization_id = $1 AND id = $2 AND status = 'active'", [context.organizationId, templateId])).rows[0];
    if (!template) throw invalid("templateId", "This template is no longer available.");
    const chosen = templateIn(template, await recipientLanguage(client, context.organizationId, entityType, entityId));
    subject = fillPlaceholders(chosen.subject, values);
    body = fillPlaceholders(chosen.body, values);
    templateLanguage = chosen.language;
  }
  const settings = await emailSettings(client, context.organizationId);
  let refused = null;
  try { await assertMayContact(client, context, facts.consent, "email"); } catch (error) { if (error instanceof CrmError) refused = error.message; else throw error; }
  const { rows: templates } = await client.query(
    `SELECT id, name FROM tenant.crm_email_templates WHERE organization_id = $1 AND status = 'active' AND applies_to IN ('any', $2) ORDER BY use_count DESC, lower(name)`,
    [context.organizationId, entityType]);
  return {
    to: facts.to ?? "", subject, body, signature: settings.signature ?? null, reference: facts.code ? `[${facts.code}]` : null,
    replyTo: settings.reply_to_address ?? null, refused, canSend: canEdit(context, entityType), templates, templateLanguage,
  };
}

const addresses = (value) => (Array.isArray(value) ? value : String(value ?? "").split(/[,;\s]+/)).map((entry) => text(entry).toLowerCase()).filter(Boolean);

// A recipient who is one of our contacts or leads and refuses email is never emailed.
async function assertRecipientsAccept(client, context, recipients) {
  const { rows } = await client.query(
    `SELECT lower(email) AS email, display_name AS name FROM tenant.contacts WHERE organization_id = $1 AND do_not_email AND lower(email) = ANY($2::text[])
     UNION ALL
     SELECT lower(email), COALESCE(NULLIF(full_name, ''), company_name) FROM tenant.crm_leads WHERE organization_id = $1 AND do_not_contact AND lower(email) = ANY($2::text[])
     UNION ALL
     SELECT value, value FROM tenant.crm_opt_outs WHERE organization_id = $1 AND kind = 'email' AND value = ANY($2::text[]) AND (channels && ARRAY['email', 'all'])`,
    [context.organizationId, recipients]);
  if (rows[0]) throw new CrmError(409, `${rows[0].name ?? rows[0].email} does not accept email. Change their contact preferences only if they have agreed to it.`, "CRM_DO_NOT_CONTACT", { channel: "email" });
}

// Sends an email from a record. input: { to, cc?, subject, body, templateId?, replyToEmailId? } — replyToEmailId answers an email kept on
// the record (it threads). Returns { emailId, status, messageId }.
export async function sendRecordEmail(client, context, entityType, entityId, input = {}, env = process.env) {
  if (!EMAIL_RECORD_TYPES.includes(entityType)) throw invalid("entityType", "Email goes from a lead, deal, company or contact.");
  if (!canEdit(context, entityType)) throw new CrmError(403, "You do not have permission to work on this record.", "PERMISSION_DENIED");
  if (!(await recordVisible(client, context, entityType, entityId))) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_EMAIL_RECORD");
  const facts = await recordFacts(client, context, entityType, entityId);
  const to = addresses(input.to);
  const cc = addresses(input.cc);
  if (!to.length) throw invalid("to", "Enter who the email is to.");
  if (to.length > 10 || cc.length > 10) throw invalid("to", "Send to at most 10 people, and copy at most 10.");
  for (const [field, list] of [["to", to], ["cc", cc]]) if (list.some((address) => !EMAIL.test(address))) throw invalid(field, "Check the email addresses.");
  const subjectTyped = text(input.subject).replace(/[\r\n]+/g, " ").slice(0, 300);
  if (!subjectTyped) throw invalid("subject", "Write a subject.");
  const body = text(input.body).slice(0, 50000);
  if (!body) throw invalid("body", "Write the email.");
  await assertMayContact(client, context, facts.consent, "email");
  await assertRecipientsAccept(client, context, [...to, ...cc]);

  let templateId = null;
  if (input.templateId) {
    const template = (await client.query("SELECT id FROM tenant.crm_email_templates WHERE organization_id = $1 AND id = $2", [context.organizationId, input.templateId])).rows[0];
    if (template) templateId = template.id;
  }
  // Answering an email kept on this record: it threads (In-Reply-To / References), and the subject keeps its "Re:".
  let inReplyTo = null;
  let references = [];
  if (input.replyToEmailId) {
    const original = (await client.query(
      "SELECT message_id, reference_ids FROM tenant.crm_email_messages WHERE organization_id = $1 AND id = $2 AND entity_type = $3 AND entity_id = $4",
      [context.organizationId, input.replyToEmailId, entityType, entityId])).rows[0];
    if (original) { inReplyTo = original.message_id; references = [...(original.reference_ids ?? []), original.message_id].slice(-20); }
  }
  const settings = await emailSettings(client, context.organizationId);
  const reference = facts.code ? `[${facts.code}]` : "";
  const subject = reference && !subjectTyped.includes(reference) ? `${subjectTyped} ${reference}` : subjectTyped;
  const fullBody = settings.signature ? `${body}\n\n-- \n${settings.signature}` : body;
  const messageId = `crm-${randomUUID()}@${(/@([^>\s]+)/.exec(env.AUTH_EMAIL_FROM ?? "")?.[1] ?? "crm.vercentlabs.local").replace(/[^a-z0-9.-]/gi, "")}`;
  const senderName = facts.sender.full_name ? `${facts.sender.full_name}${facts.sender.organization_name ? ` · ${facts.sender.organization_name}` : ""}` : null;

  const result = await sendMail({
    meter: { client, organizationId: context.organizationId },
    to, cc: cc.length ? cc : undefined, subject, text: fullBody,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${escapeHtml(fullBody).replace(/\n/g, "<br>")}</body></html>`,
    replyTo: settings.reply_to_address ?? facts.sender.email ?? undefined, messageId: `<${messageId}>`, inReplyTo: inReplyTo ? `<${inReplyTo}>` : undefined,
    references: references.map((id) => `<${id}>`), fromName: senderName,
  }, env);
  if (!result.sent) throw new CrmError(409, "Email is not set up for this workspace. Ask an administrator to configure outgoing mail.", "CRM_EMAIL_UNAVAILABLE");

  const owner = (await client.query(`SELECT owner_user_id FROM tenant.${TABLE[entityType]} WHERE organization_id = $1 AND id = $2`, [context.organizationId, entityId])).rows[0];
  const activity = (await client.query(
    `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, assigned_to, start_at, completed_at,
                                        external_id, created_by, updated_by)
     VALUES ($1, $2, $3, 'email', $4, $5, 'completed', $6, now(), now(), $7, $6, $6) RETURNING id`,
    [context.organizationId, entityType, entityId, `Email to ${to.join(", ")}: ${subject}`.slice(0, 300), fullBody.slice(0, 20000), context.userId ?? owner?.owner_user_id ?? null, messageId])).rows[0];
  const email = (await client.query(
    `INSERT INTO tenant.crm_email_messages (organization_id, entity_type, entity_id, direction, status, message_id, in_reply_to, reference_ids, from_address, from_name,
                                            to_addresses, cc_addresses, subject, body_text, activity_id, sent_by, template_id)
     VALUES ($1, $2, $3, 'outbound', 'sent', $4, $5, $6::text[], $7, $8, $9::text[], $10::text[], $11, $12, $13, $14, $15) RETURNING id`,
    [context.organizationId, entityType, entityId, messageId, inReplyTo, references, facts.sender.email ?? null, senderName, to, cc, subject, fullBody,
      activity.id, context.userId ?? null, templateId])).rows[0];
  if (templateId) await client.query("UPDATE tenant.crm_email_templates SET use_count = use_count + 1 WHERE organization_id = $1 AND id = $2", [context.organizationId, templateId]);
  await client.query(`UPDATE tenant.${TABLE[entityType]} SET last_activity_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, entityId]);
  return { emailId: email.id, status: "sent", messageId };
}

// The emails kept on a record, newest first (both ways).
export async function listRecordEmails(client, context, entityType, entityId, { limit = 50 } = {}) {
  if (!(await recordVisible(client, context, entityType, entityId))) throw new CrmError(404, "The record was not found, or you do not have access to it.", "CRM_EMAIL_RECORD");
  const { rows } = await client.query(
    `SELECT message.*, sender.full_name AS sent_by_name FROM tenant.crm_email_messages message LEFT JOIN users sender ON sender.id = message.sent_by
      WHERE message.organization_id = $1 AND message.entity_type = $2 AND message.entity_id = $3 ORDER BY message.created_at DESC LIMIT $4`,
    [context.organizationId, entityType, entityId, Math.min(Math.max(Number(limit) || 50, 1), 200)]);
  return rows.map((row) => ({
    id: row.id, direction: row.direction, status: row.status, subject: row.subject, body: row.body_text, from: row.from_address, fromName: row.from_name,
    to: row.to_addresses, cc: row.cc_addresses, sentByName: row.sent_by_name ?? null, createdAt: row.created_at, threaded: Boolean(row.in_reply_to),
  }));
}

// A quotation emailed from Sales is also kept on its deal (CRM plan 4.1, Q4): the deal's timeline shows it went out, and a reply to it
// threads onto the deal.
export async function recordQuotationEmailOnDeal(client, context, { opportunityId, to, cc = [], subject, body, messageId, quotationNumber, documentLabel = null }) {
  if (!opportunityId) return null;
  const kept = messageId ? String(messageId).replace(/^<|>$/g, "") : `quotation-${randomUUID()}`;
  const activity = (await client.query(
    `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, assigned_to, start_at, completed_at,
                                        external_id, created_by, updated_by)
     VALUES ($1, 'opportunity', $2, 'email', $3, $4, 'completed', $5, now(), now(), $6, $5, $5) RETURNING id`,
    [context.organizationId, opportunityId, `${documentLabel ?? `Quotation ${quotationNumber}`} emailed to ${[to, ...cc].join(", ")}`.slice(0, 300), String(body ?? "").slice(0, 20000), context.userId ?? null, kept])).rows[0];
  await client.query(
    `INSERT INTO tenant.crm_email_messages (organization_id, entity_type, entity_id, direction, status, message_id, to_addresses, cc_addresses, subject, body_text, activity_id, sent_by)
     VALUES ($1, 'opportunity', $2, 'outbound', 'sent', $3, $4::text[], $5::text[], $6, $7, $8, $9) ON CONFLICT (organization_id, message_id) DO NOTHING`,
    [context.organizationId, opportunityId, kept, [to], cc, subject, body ?? null, activity.id, context.userId ?? null]);
  return activity.id;
}
