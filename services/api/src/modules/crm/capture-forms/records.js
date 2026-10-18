// Web forms (CRM plan 3.2): a form set up in CRM, shown on its own hosted page or embedded in the organization's website, whose
// submissions become leads through captureCrmLead (leads/capture.js) — validation, duplicate checks, assignment rules and history as
// for any lead.
//
// A form chooses which of the lead's fields it asks for and which are required (name, or company, at least), the source and owner its
// leads get, the websites allowed to post it, the thank-you message or page, and an optional consent notice. The notice is versioned:
// changing its wording keeps the old version and makes a new one current, and each lead records the version its person saw.
import { FORM_LANGUAGES, formLabel } from "./languages.js";
import { CrmError } from "../data-management/errors.js";
import { assertUsableCampaign } from "../campaigns/records.js";
import { assertActiveLeadSource } from "../leads/sources.js";

export const CAPTURE_FORM_PERMISSION = "crm.capture.manage";

// The lead fields a form may ask for, in the order a form shows them, with the label a visitor reads.
export const CAPTURE_FORM_FIELDS = Object.freeze([
  { name: "firstName", label: "First name", type: "text" },
  { name: "lastName", label: "Last name", type: "text" },
  { name: "email", label: "Email", type: "email" },
  { name: "mobile", label: "Mobile", type: "tel" },
  { name: "phone", label: "Phone", type: "tel" },
  { name: "companyName", label: "Company", type: "text" },
  { name: "jobTitle", label: "Job title", type: "text" },
  { name: "website", label: "Website", type: "url" },
  { name: "city", label: "City", type: "text" },
  { name: "state", label: "State", type: "text" },
  { name: "countryCode", label: "Country", type: "country" },
  { name: "industry", label: "Industry", type: "text" },
  { name: "productInterest", label: "What are you interested in?", type: "text" },
  { name: "description", label: "Message", type: "textarea" },
]);
const FIELD_NAMES = new Set(CAPTURE_FORM_FIELDS.map((field) => field.name));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value) => String(value ?? "").trim();
const has = (input, key) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
const invalid = (field, message) => new CrmError(400, message, "CRM_CAPTURE_FORM_VALIDATION", { issues: [{ field, message }] });

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(CAPTURE_FORM_PERMISSION)) return;
  throw new CrmError(403, "You do not have permission to manage web forms.", "PERMISSION_DENIED");
}

const SELECT = `SELECT form.*, source.name AS source_name, owner.full_name AS owner_name, campaign.name AS campaign_name, notice.notice_text, notice.version AS notice_version,
                       (SELECT count(*)::int FROM tenant.crm_leads lead WHERE lead.organization_id = form.organization_id AND lead.capture_form_id = form.id) AS lead_count
                  FROM tenant.crm_capture_forms form
                  LEFT JOIN tenant.crm_lead_sources source ON source.organization_id = form.organization_id AND source.id = form.source_id
                  LEFT JOIN users owner ON owner.id = form.owner_user_id
                  LEFT JOIN tenant.crm_campaigns campaign ON campaign.organization_id = form.organization_id AND campaign.id = form.campaign_id
                  LEFT JOIN tenant.crm_capture_notices notice ON notice.organization_id = form.organization_id AND notice.id = form.notice_id`;

function fieldsOf(row) {
  const listed = Array.isArray(row.form_schema?.fields) ? row.form_schema.fields : [];
  const required = new Set(row.required_fields ?? []);
  return listed.filter((field) => FIELD_NAMES.has(field?.name)).map((field) => ({ name: field.name, required: required.has(field.name) }));
}

function toForm(row) {
  return {
    id: row.id, name: row.name, publicKey: row.public_key, status: row.status, fields: fieldsOf(row), language: row.form_schema?.language ?? "en",
    sourceId: row.source_id, sourceName: row.source_name ?? null, campaignId: row.campaign_id ?? null, campaignName: row.campaign_name ?? null, ownerUserId: row.owner_user_id, ownerName: row.owner_name ?? null,
    allowedOrigins: row.allowed_origins ?? [], successMessage: row.success_message, thankYouUrl: row.thank_you_url ?? null,
    rateLimitPerHour: row.rate_limit_per_hour, noticeText: row.notice_text ?? null, noticeVersion: row.notice_version ?? null,
    leadCount: row.lead_count ?? 0, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function listCaptureForms(client, context) {
  requireManage(context);
  const { rows } = await client.query(`${SELECT} WHERE form.organization_id = $1 ORDER BY form.status, lower(form.name)`, [context.organizationId]);
  return rows.map(toForm);
}

export async function getCaptureForm(client, context, formId) {
  requireManage(context);
  if (!UUID.test(String(formId ?? ""))) throw new CrmError(404, "Web form not found.", "CRM_CAPTURE_FORM_NOT_FOUND");
  const row = (await client.query(`${SELECT} WHERE form.organization_id = $1 AND form.id = $2`, [context.organizationId, formId])).rows[0];
  if (!row) throw new CrmError(404, "Web form not found.", "CRM_CAPTURE_FORM_NOT_FOUND");
  return toForm(row);
}

// The versions of a form's consent notice, newest first.
export async function listCaptureNotices(client, context, formId) {
  await getCaptureForm(client, context, formId);
  const { rows } = await client.query(
    `SELECT notice.id, notice.version, notice.notice_text, notice.created_at, member.full_name AS created_by_name,
            (SELECT count(*)::int FROM tenant.crm_leads lead WHERE lead.organization_id = notice.organization_id AND lead.capture_notice_id = notice.id) AS lead_count
       FROM tenant.crm_capture_notices notice LEFT JOIN users member ON member.id = notice.created_by
      WHERE notice.organization_id = $1 AND notice.form_id = $2 ORDER BY notice.version DESC`, [context.organizationId, formId]);
  return rows.map((row) => ({ id: row.id, version: row.version, text: row.notice_text, createdAt: row.created_at, createdByName: row.created_by_name, leadCount: row.lead_count }));
}

function cleanFields(fields) {
  if (!Array.isArray(fields) || !fields.length) throw invalid("fields", "Choose the fields the form asks for.");
  const seen = new Set();
  const chosen = [];
  for (const field of fields) {
    const name = text(field?.name);
    if (!FIELD_NAMES.has(name)) throw invalid("fields", `"${name.slice(0, 40)}" is not a field a web form can ask for.`);
    if (seen.has(name)) continue;
    seen.add(name);
    chosen.push({ name, required: Boolean(field.required) });
  }
  if (!chosen.some((field) => field.required && ["firstName", "lastName", "companyName"].includes(field.name)))
    throw invalid("fields", "Require a name or the company, so every lead says who it is.");
  if (!chosen.some((field) => ["email", "mobile", "phone"].includes(field.name)))
    throw invalid("fields", "Ask for an email address or a phone number, so the lead can be contacted.");
  return chosen;
}

function cleanOrigins(origins) {
  const list = (Array.isArray(origins) ? origins : String(origins ?? "").split(/[\s,]+/)).map(text).filter(Boolean);
  return [...new Set(list.map((origin) => {
    let url;
    try { url = new URL(/^https?:\/\//i.test(origin) ? origin : `https://${origin}`); } catch { throw invalid("allowedOrigins", `"${origin.slice(0, 60)}" is not a website address.`); }
    if (!["http:", "https:"].includes(url.protocol)) throw invalid("allowedOrigins", `"${origin.slice(0, 60)}" is not a website address.`);
    return url.origin;
  }))].slice(0, 20);
}

async function cleanInput(client, context, input, current = null) {
  const next = {};
  // The language the form is shown in (CRM plan 5.6).
  if (has(input, "language")) {
    next.language = text(input.language).toLowerCase() || "en";
    if (!FORM_LANGUAGES.includes(next.language)) throw invalid("language", "Choose the form's language from the list.");
  }
  if (!current || has(input, "name")) {
    next.name = text(input.name).slice(0, 120);
    if (!next.name) throw invalid("name", "Name the form.");
  }
  if (!current || has(input, "fields")) next.fields = cleanFields(input.fields ?? CAPTURE_FORM_FIELDS.filter((field) => ["firstName", "lastName", "email", "mobile", "companyName", "description"].includes(field.name))
    .map((field) => ({ name: field.name, required: field.name === "firstName" })));
  if (has(input, "sourceId")) {
    next.sourceId = text(input.sourceId) || null;
    if (next.sourceId) await assertActiveLeadSource(client, context, next.sourceId);
  }
  if (has(input, "campaignId")) {
    next.campaignId = text(input.campaignId) || null;
    if (next.campaignId) await assertUsableCampaign(client, context, next.campaignId, current?.campaignId ?? null);
  }
  if (has(input, "ownerUserId")) {
    next.ownerUserId = text(input.ownerUserId) || null;
    if (next.ownerUserId && !(await client.query("SELECT 1 FROM organization_memberships WHERE organization_id = $1 AND user_id = $2 AND status = 'active'",
      [context.organizationId, next.ownerUserId])).rows[0]) throw invalid("ownerUserId", "Choose an active member as the owner.");
  }
  if (has(input, "allowedOrigins")) next.allowedOrigins = cleanOrigins(input.allowedOrigins);
  if (has(input, "successMessage")) {
    next.successMessage = text(input.successMessage).slice(0, 500);
    if (!next.successMessage) throw invalid("successMessage", "Write what the visitor reads after sending the form.");
  }
  if (has(input, "thankYouUrl")) {
    next.thankYouUrl = text(input.thankYouUrl) || null;
    if (next.thankYouUrl && !/^https:\/\/[^\s]+$/i.test(next.thankYouUrl)) throw invalid("thankYouUrl", "The thank-you page must be an https:// address.");
  }
  if (has(input, "rateLimitPerHour")) {
    next.rateLimitPerHour = Number(input.rateLimitPerHour);
    if (!Number.isInteger(next.rateLimitPerHour) || next.rateLimitPerHour < 1 || next.rateLimitPerHour > 10000) throw invalid("rateLimitPerHour", "Allow between 1 and 10,000 submissions an hour from one visitor.");
  }
  if (has(input, "noticeText")) {
    next.noticeText = text(input.noticeText).slice(0, 4000) || null;
  }
  return next;
}

// A new wording becomes the next version (the old ones stay); the same wording keeps the current version.
async function setNotice(client, context, formId, currentText, wanted) {
  if ((wanted ?? null) === (currentText ?? null)) return undefined;
  if (!wanted) return null;
  const version = (await client.query("SELECT COALESCE(max(version), 0) + 1 AS next FROM tenant.crm_capture_notices WHERE organization_id = $1 AND form_id = $2",
    [context.organizationId, formId])).rows[0].next;
  return (await client.query(
    `INSERT INTO tenant.crm_capture_notices (organization_id, form_id, version, notice_text, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [context.organizationId, formId, version, wanted, context.userId ?? null])).rows[0].id;
}

export async function createCaptureForm(client, context, input = {}) {
  requireManage(context);
  const next = await cleanInput(client, context, input);
  const taken = (await client.query("SELECT 1 FROM tenant.crm_capture_forms WHERE organization_id = $1 AND lower(name) = lower($2)", [context.organizationId, next.name])).rows[0];
  if (taken) throw invalid("name", "Another form already has this name.");
  const row = (await client.query(
    `INSERT INTO tenant.crm_capture_forms (organization_id, name, form_schema, required_fields, source_id, owner_user_id, allowed_origins, success_message, thank_you_url,
                                           rate_limit_per_hour, status, published_at, created_by, updated_by)
     VALUES ($1, $2, $3::jsonb, $4::text[], $5, $6, $7::text[], COALESCE($8, 'Thank you. Our team will contact you shortly.'), $9, COALESCE($10, 60), 'active', now(), $11, $11)
     RETURNING id`,
    [context.organizationId, next.name, JSON.stringify({ fields: next.fields.map(({ name }) => ({ name })), language: next.language ?? "en" }), next.fields.filter((field) => field.required).map((field) => field.name),
      next.sourceId ?? null, next.ownerUserId ?? null, next.allowedOrigins ?? [], next.successMessage ?? null, next.thankYouUrl ?? null, next.rateLimitPerHour ?? null,
      context.userId ?? null])).rows[0];
  if (next.campaignId) await client.query("UPDATE tenant.crm_capture_forms SET campaign_id = $3 WHERE organization_id = $1 AND id = $2", [context.organizationId, row.id, next.campaignId]);
  if (next.noticeText) {
    const noticeId = await setNotice(client, context, row.id, null, next.noticeText);
    await client.query("UPDATE tenant.crm_capture_forms SET notice_id = $3, consent_text = $4 WHERE organization_id = $1 AND id = $2", [context.organizationId, row.id, noticeId, next.noticeText]);
  }
  return getCaptureForm(client, context, row.id);
}

export async function updateCaptureForm(client, context, formId, input = {}) {
  const current = await getCaptureForm(client, context, formId);
  if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== new Date(current.updatedAt).getTime())
    throw new CrmError(409, "This form was changed by someone else. Reload it and try again.", "CRM_STALE_WRITE");
  const next = await cleanInput(client, context, input, current);
  if (next.name && next.name.toLowerCase() !== current.name.toLowerCase()) {
    const taken = (await client.query("SELECT 1 FROM tenant.crm_capture_forms WHERE organization_id = $1 AND lower(name) = lower($2) AND id <> $3", [context.organizationId, next.name, formId])).rows[0];
    if (taken) throw invalid("name", "Another form already has this name.");
  }
  const sets = [];
  const values = [context.organizationId, formId];
  const set = (column, value, cast = "") => { values.push(value); sets.push(`${column} = $${values.length}${cast}`); };
  if (next.name) set("name", next.name);
  if (next.fields || has(next, "language"))
    set("form_schema", JSON.stringify({ fields: (next.fields ?? current.fields).map(({ name }) => ({ name })), language: next.language ?? current.language ?? "en" }), "::jsonb");
  if (next.fields) set("required_fields", next.fields.filter((field) => field.required).map((field) => field.name), "::text[]");
  if (has(next, "sourceId")) set("source_id", next.sourceId);
  if (has(next, "campaignId")) set("campaign_id", next.campaignId);
  if (has(next, "ownerUserId")) set("owner_user_id", next.ownerUserId);
  if (next.allowedOrigins) set("allowed_origins", next.allowedOrigins, "::text[]");
  if (next.successMessage) set("success_message", next.successMessage);
  if (has(next, "thankYouUrl")) set("thank_you_url", next.thankYouUrl);
  if (next.rateLimitPerHour) set("rate_limit_per_hour", next.rateLimitPerHour);
  if (has(next, "noticeText")) {
    const noticeId = await setNotice(client, context, formId, current.noticeText, next.noticeText);
    if (noticeId !== undefined) { set("notice_id", noticeId); set("consent_text", next.noticeText); }
  }
  if (sets.length) {
    set("updated_by", context.userId ?? null);
    await client.query(`UPDATE tenant.crm_capture_forms SET ${sets.join(", ")}, updated_at = now() WHERE organization_id = $1 AND id = $2`, values);
  }
  return getCaptureForm(client, context, formId);
}

// Switched off, the form's page and its embeds stop taking submissions (the public lookups only find an active form).
export async function setCaptureFormStatus(client, context, formId, status) {
  if (!["active", "inactive"].includes(status)) throw invalid("status", "Choose active or inactive.");
  await getCaptureForm(client, context, formId);
  await client.query(
    `UPDATE tenant.crm_capture_forms SET status = $3, published_at = CASE WHEN $3 = 'active' THEN now() ELSE published_at END,
            unpublished_at = CASE WHEN $3 = 'inactive' THEN now() ELSE unpublished_at END, updated_by = $4, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, formId, status, context.userId ?? null]);
  return getCaptureForm(client, context, formId);
}

// What the hosted page and the embed show, for a public visitor (no organization context): null when the form is unknown or off.
export async function getPublicCaptureForm(queryable, formKey) {
  if (!/^[0-9a-f]{24,64}$/i.test(String(formKey ?? ""))) return null;
  const row = (await queryable.query("SELECT * FROM tenant.crm_public_capture_definition($1)", [formKey])).rows[0];
  if (!row) return null;
  const required = new Set(row.required_fields ?? []);
  const listed = Array.isArray(row.form_schema?.fields) ? row.form_schema.fields : [];
  const language = row.form_schema?.language ?? "en";
  return {
    organizationName: row.organization_name, name: row.form_name, language,
    // the labels in the form's language (CRM plan 5.6)
    fields: listed.filter((field) => FIELD_NAMES.has(field?.name)).map((field) => {
      const definition = CAPTURE_FORM_FIELDS.find((entry) => entry.name === field.name);
      return { ...definition, label: formLabel(language, definition.name, definition.label), required: required.has(field.name) };
    }),
    submitLabel: formLabel(language, "submit", "Send"),
    notice: row.notice_text ? { text: row.notice_text, version: row.notice_version } : null,
    successMessage: row.success_message, thankYouUrl: row.thank_you_url ?? null,
  };
}
