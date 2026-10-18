// Email templates and CRM email settings (CRM plan 4.1), kept in CRM › Setup › Email templates by whoever manages CRM settings. Anyone
// who emails from a record picks from the active templates for that kind of record.
import { CrmError } from "../data-management/errors.js";
import { EMAIL_PLACEHOLDERS } from "./outbound.js";

const MANAGE = "crm.settings.manage";
const APPLIES = new Set(["any", "lead", "opportunity", "party", "contact"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
const text = (value) => String(value ?? "").trim();
const invalid = (field, message) => new CrmError(400, message, "CRM_EMAIL_TEMPLATE_VALIDATION", { issues: [{ field, message }] });
const KNOWN = new Set(EMAIL_PLACEHOLDERS.map((entry) => entry.key));

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, "You do not have permission to manage email templates.", "PERMISSION_DENIED");
}

const toTemplate = (row) => ({
  id: row.id, name: row.name, appliesTo: row.applies_to, subject: row.subject, body: row.body, status: row.status, useCount: row.use_count,
  // the template in other languages (CRM plan 5.6): { hi: { subject, body }, … }
  translations: row.translations ?? {},
  updatedAt: row.updated_at, updatedByName: row.updated_by_name ?? null,
});

export async function listEmailTemplates(client, context, { includeInactive = false } = {}) {
  if (includeInactive) requireManage(context);
  const { rows } = await client.query(
    `SELECT template.*, member.full_name AS updated_by_name FROM tenant.crm_email_templates template LEFT JOIN users member ON member.id = template.updated_by
      WHERE template.organization_id = $1 ${includeInactive ? "" : "AND template.status = 'active'"} ORDER BY template.status, lower(template.name)`, [context.organizationId]);
  return rows.map(toTemplate);
}

function clean(input, current = null) {
  const next = {};
  if (!current || input.name !== undefined) { next.name = text(input.name).slice(0, 120); if (!next.name) throw invalid("name", "Name the template."); }
  if (!current || input.subject !== undefined) { next.subject = text(input.subject).replace(/[\r\n]+/g, " ").slice(0, 300); if (!next.subject) throw invalid("subject", "Write a subject."); }
  if (!current || input.body !== undefined) { next.body = text(input.body).slice(0, 20000); if (!next.body) throw invalid("body", "Write the email."); }
  if (input.appliesTo !== undefined || !current) {
    next.appliesTo = text(input.appliesTo) || "any";
    if (!APPLIES.has(next.appliesTo)) throw invalid("appliesTo", "Choose which records the template is for.");
  }
  if (input.translations !== undefined) {
    if (!input.translations || typeof input.translations !== "object" || Array.isArray(input.translations)) throw invalid("translations", "Give the translations by language.");
    next.translations = {};
    for (const [language, entry] of Object.entries(input.translations)) {
      if (!/^[a-z]{2}$/.test(language) || language === "en") throw invalid("translations", "Choose a language from the list.");
      const subject = text(entry?.subject).replace(/[\r\n]+/g, " ").slice(0, 300);
      const body = text(entry?.body).slice(0, 20000);
      if (!subject && !body) continue;
      if (!subject || !body) throw invalid("translations", "Write both the subject and the email in each language.");
      next.translations[language] = { subject, body };
    }
  }
  const texts = [["subject", next.subject], ["body", next.body], ...Object.values(next.translations ?? {}).flatMap((entry) => [["translations", entry.subject], ["translations", entry.body]])];
  for (const [field, value] of texts) {
    const unknown = [...String(value ?? "").matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((match) => match[1]).find((key) => !KNOWN.has(key));
    if (unknown) throw invalid(field, `{{${unknown}}} is not a placeholder. Use one from the list.`);
  }
  return next;
}

export async function createEmailTemplate(client, context, input = {}) {
  requireManage(context);
  const next = clean(input);
  if ((await client.query("SELECT 1 FROM tenant.crm_email_templates WHERE organization_id = $1 AND lower(name) = lower($2)", [context.organizationId, next.name])).rows[0])
    throw invalid("name", "Another template already has this name.");
  const row = (await client.query(
    `INSERT INTO tenant.crm_email_templates (organization_id, name, applies_to, subject, body, translations, created_by, updated_by) VALUES ($1, $2, $3, $4, $5, $7::jsonb, $6, $6) RETURNING *`,
    [context.organizationId, next.name, next.appliesTo, next.subject, next.body, context.userId ?? null, JSON.stringify(next.translations ?? {})])).rows[0];
  return toTemplate(row);
}

export async function updateEmailTemplate(client, context, templateId, input = {}) {
  requireManage(context);
  if (!UUID.test(String(templateId ?? ""))) throw new CrmError(404, "Template not found.", "CRM_EMAIL_TEMPLATE_NOT_FOUND");
  const current = (await client.query("SELECT * FROM tenant.crm_email_templates WHERE organization_id = $1 AND id = $2", [context.organizationId, templateId])).rows[0];
  if (!current) throw new CrmError(404, "Template not found.", "CRM_EMAIL_TEMPLATE_NOT_FOUND");
  const next = clean(input, current);
  if (next.name && next.name.toLowerCase() !== current.name.toLowerCase()
    && (await client.query("SELECT 1 FROM tenant.crm_email_templates WHERE organization_id = $1 AND lower(name) = lower($2) AND id <> $3", [context.organizationId, next.name, current.id])).rows[0])
    throw invalid("name", "Another template already has this name.");
  const status = input.status === undefined ? current.status : input.status;
  if (!["active", "inactive"].includes(status)) throw invalid("status", "Choose active or inactive.");
  const row = (await client.query(
    `UPDATE tenant.crm_email_templates SET name = $3, applies_to = $4, subject = $5, body = $6, status = $7, updated_by = $8, translations = $9::jsonb, updated_at = now()
      WHERE organization_id = $1 AND id = $2 RETURNING *`,
    [context.organizationId, current.id, next.name ?? current.name, next.appliesTo ?? current.applies_to, next.subject ?? current.subject, next.body ?? current.body, status,
      context.userId ?? null, JSON.stringify(next.translations ?? current.translations ?? {})])).rows[0];
  return toTemplate(row);
}

export async function getCrmEmailSettings(client, context) {
  const row = (await client.query("SELECT * FROM tenant.crm_email_settings WHERE organization_id = $1", [context.organizationId])).rows[0];
  return { replyToAddress: row?.reply_to_address ?? null, signature: row?.signature ?? null, placeholders: EMAIL_PLACEHOLDERS };
}

// input: { replyToAddress?, signature? } — the reply address is normally the organization's email-to-lead address.
export async function saveCrmEmailSettings(client, context, input = {}) {
  requireManage(context);
  const current = await getCrmEmailSettings(client, context);
  const replyToAddress = input.replyToAddress === undefined ? current.replyToAddress : text(input.replyToAddress).toLowerCase() || null;
  if (replyToAddress && !EMAIL.test(replyToAddress)) throw invalid("replyToAddress", "Enter a valid email address.");
  const signature = input.signature === undefined ? current.signature : text(input.signature).slice(0, 2000) || null;
  await client.query(
    `INSERT INTO tenant.crm_email_settings (organization_id, reply_to_address, signature, updated_by, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (organization_id) DO UPDATE SET reply_to_address = EXCLUDED.reply_to_address, signature = EXCLUDED.signature, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, replyToAddress, signature, context.userId ?? null]);
  return getCrmEmailSettings(client, context);
}
