// Public web-to-lead capture: a website form (the marketing site's demo
// request, or a customer's own site) posts a lead with a capture-form key.
// The key resolves its organization before any organization context exists;
// from there the submission is an ordinary createLead, so validation,
// duplicate detection, assignment rules and history all apply.
//
// The public response never reveals whether a matching record already
// exists: a duplicate submission is accepted and not created again. Inside the
// CRM it is never lost: the enquiry is logged on the matching lead (or the
// contact it became) and its owner is told.
import { withConsentSource } from "../data-management/consent.js";
import { mediumFromUtm } from "@vercentlabs/shared-types";

import { createNotification } from "../../../core/platform/notifications/index.js";
import { campaignFromUtm } from "../campaigns/records.js";
import { CrmError } from "../data-management/errors.js";
import { createLead } from "./records.js";
import { LEAD_PERMISSIONS } from "./constants.js";

// What a public visitor reads when a required field is empty (never the internal field name).
const FIELD_LABELS = Object.freeze({
  firstName: "first name", lastName: "last name", companyName: "company or organization", jobTitle: "job title", email: "email address", phone: "phone number",
  mobile: "mobile number", website: "website", city: "city", state: "state", countryCode: "country", industry: "industry", productInterest: "interest",
  description: "message", sourceDetail: "details",
});
const CAPTURE_FIELDS = Object.freeze([
  "firstName", "lastName", "companyName", "jobTitle", "email", "phone", "mobile", "website", "city", "state", "countryCode",
  "industry", "productInterest", "description", "sourceDetail", "consentEmail", "consentSms", "consentWhatsapp",
]);

// Ingress lookup through the definer function: no organization context yet.
export async function resolvePublicCaptureOrganization(queryable, formKey) {
  const result = await queryable.query("SELECT form.organization_id FROM tenant.crm_public_capture_form($1) AS form", [formKey]);
  return result.rows[0]?.organization_id ?? null;
}

// requestContext: { origin, fingerprint, selfOrigin } — selfOrigin is the app's own origin: its hosted form page (and an embed of it) always may post.
export async function captureCrmLead(client, formKey, input = {}, requestContext = {}) {
  const form = (await client.query(`SELECT * FROM tenant.crm_public_capture_form($1)`, [formKey])).rows[0];
  if (!form) throw new CrmError(404, "Lead-capture form not found.");
  await client.query("SELECT set_config('app.current_organization_id', $1, true)", [form.organization_id]);

  const origin = String(requestContext.origin || "");
  if (form.allowed_origins?.length && !form.allowed_origins.includes(origin) && !(requestContext.selfOrigin && origin === requestContext.selfOrigin))
    throw new CrmError(403, "This origin is not allowed to submit the form.");
  // Honeypot fields: a real visitor never fills them.
  if (input.websiteUrl || input.companyWebsiteHidden) throw new CrmError(400, "Submission rejected.");

  const windowStart = new Date();
  windowStart.setMinutes(0, 0, 0);
  const rate = await client.query(
    `INSERT INTO tenant.crm_capture_rate_limits (organization_id, form_id, fingerprint, window_started_at, attempts)
     VALUES ($1, $2, $3, $4, 1)
     ON CONFLICT (organization_id, form_id, fingerprint, window_started_at)
     DO UPDATE SET attempts = tenant.crm_capture_rate_limits.attempts + 1
     RETURNING attempts`,
    [form.organization_id, form.id, String(requestContext.fingerprint || "unknown"), windowStart],
  );
  if (Number(rate.rows[0].attempts) > Number(form.rate_limit_per_hour)) throw new CrmError(429, "Too many submissions. Try again later.");
  for (const field of form.required_fields || [])
    if (!String(input[field] ?? "").trim()) throw new CrmError(400, `Enter your ${FIELD_LABELS[field] ?? "details"}.`);

  // A capture runs as the organization itself: it may create a lead and
  // nothing else. The acting user recorded on the lead is the organization's
  // creator, since a public visitor has no user.
  const actor = (await client.query(`SELECT created_by FROM public.organizations WHERE id = $1`, [form.organization_id])).rows[0]?.created_by ?? null;
  const context = {
    organizationId: form.organization_id,
    userId: actor,
    roleSlugs: [],
    permissions: [LEAD_PERMISSIONS.create, LEAD_PERMISSIONS.assign, LEAD_PERMISSIONS.viewAll, LEAD_PERMISSIONS.viewSensitive, "crm.records.view_all"],
  };
  const lead = Object.fromEntries(CAPTURE_FIELDS.filter((field) => input[field] !== undefined && input[field] !== null).map((field) => [field, input[field]]));
  if (form.source_id) lead.sourceId = form.source_id;
  // A form in another language records that the visitor speaks it (CRM plan 5.6).
  const formLanguage = (await client.query("SELECT form_schema->>'language' AS language FROM tenant.crm_capture_forms WHERE organization_id = $1 AND id = $2", [form.organization_id, form.id])).rows[0]?.language;
  if (formLanguage && formLanguage !== "en" && !lead.languageCode) lead.languageCode = formLanguage;
  if (form.owner_user_id) lead.ownerUserId = form.owner_user_id;
  // Where the visitor came from (CRM plan 3.4): the page's utm_campaign names one of the campaigns (by its code or name), else the
  // form's own campaign; utm_medium is read into a medium, else the campaign's; utm_source is noted with the lead's source.
  const utm = (key) => String(input[key] ?? "").trim().slice(0, 200);
  const fromUtm = await campaignFromUtm(client, form.organization_id, utm("utmCampaign"));
  const campaign = fromUtm ?? (form.campaign_id
    ? (await client.query("SELECT id, medium FROM tenant.crm_campaigns WHERE organization_id = $1 AND id = $2 AND status = 'active'", [form.organization_id, form.campaign_id])).rows[0] ?? null
    : null);
  if (campaign) lead.campaignId = campaign.id;
  const medium = mediumFromUtm(utm("utmMedium")) ?? campaign?.medium ?? null;
  if (medium) lead.medium = medium;
  if (utm("utmSource") && !lead.sourceDetail) lead.sourceDetail = `utm_source: ${utm("utmSource")}${utm("utmCampaign") && !fromUtm ? ` · utm_campaign: ${utm("utmCampaign")}` : ""}`.slice(0, 240);
  // The consent notice the visitor was shown (CRM plan 3.2): agreeing to it is consent to be emailed about the enquiry; the lead keeps
  // which version they saw. A form with a notice cannot be sent without agreeing.
  const notice = (await client.query(
    `SELECT notice.id, notice.version FROM tenant.crm_capture_forms capture JOIN tenant.crm_capture_notices notice ON notice.organization_id = capture.organization_id AND notice.id = capture.notice_id
      WHERE capture.organization_id = $1 AND capture.id = $2`, [form.organization_id, form.id])).rows[0] ?? null;
  if (notice && input.consentAccepted !== true) throw new CrmError(400, "Please agree to the notice to send the form.");
  if (notice) lead.consentEmail = true;

  // The consent ledger records the form and the exact notice wording the visitor agreed to.
  try {
    const created = await withConsentSource(client, "web_form", notice ? `Form ${form.id}, notice version ${notice.version}` : `Form ${form.id}`,
      () => createLead(client, context, lead, { origin: "integration" }));
    await client.query("UPDATE tenant.crm_leads SET capture_form_id = $3, capture_notice_id = $4 WHERE organization_id = $1 AND id = $2",
      [form.organization_id, created.id, form.id, notice?.id ?? null]);
    return { message: form.success_message, leadId: created.id };
  } catch (error) {
    if (!(error instanceof CrmError && error.code === "CRM_LEAD_DUPLICATE")) throw error;
    const recorded = await recordRepeatEnquiry(client, context, form, lead, error.details?.matches ?? []);
    return { message: form.success_message, leadId: null, duplicateSuppressed: true, repeatEnquiry: recorded };
  }
}

// A known person enquired again: a completed "Website enquiry" activity on the matched lead (or the contact it was converted into), with
// what they wrote, and a notification to its owner. Returns the record it was logged on.
// via: how they enquired, for the activity ("Website enquiry") and the owner's notice ("submitted the website form again").
export async function recordRepeatEnquiry(client, context, form, lead, matches, via = { title: "Website enquiry", notice: "submitted the website form again" }) {
  const strong = matches.filter((match) => match.strength === "exact");
  const target = strong.find((match) => match.kind === "lead" && !match.isArchived) ?? strong.find((match) => match.kind === "contact") ?? strong.find((match) => match.kind === "lead");
  if (!target) return null;
  const table = target.kind === "lead" ? "crm_leads" : "contacts";
  const row = (await client.query(`SELECT id, owner_user_id FROM tenant.${table} WHERE organization_id = $1 AND id = $2`, [context.organizationId, target.id])).rows[0];
  if (!row) return null;
  const said = [lead.productInterest && `Interested in: ${lead.productInterest}`, lead.description, lead.sourceDetail].filter(Boolean).join(" · ").slice(0, 4000);
  const name = [lead.firstName, lead.lastName].filter(Boolean).join(" ") || "Someone";
  await client.query(
    `INSERT INTO tenant.crm_activities (organization_id, entity_type, entity_id, activity_type, subject, description, status, assigned_to, start_at, completed_at, is_inbound, created_by, updated_by)
     VALUES ($1, $2, $3, 'other', $4, $5, 'completed', $6, now(), now(), true, $7, $7)`,
    [context.organizationId, target.kind, row.id, `${via.title} from ${name}`.slice(0, 300), said || null, row.owner_user_id, context.userId]);
  if (target.kind === "lead")
    await client.query(`UPDATE tenant.crm_leads SET last_activity_at = now() WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id]);
  if (row.owner_user_id)
    await createNotification(client, { organizationId: context.organizationId, userId: row.owner_user_id, category: "crm_repeat_enquiry",
      title: `${name} enquired again`, message: `${target.code ?? target.name ?? "A known contact"} ${via.notice}.${said ? ` ${said.slice(0, 160)}` : ""}`,
      href: target.kind === "lead" ? `/crm/leads/${row.id}` : `/crm/contacts/${row.id}`, entityType: target.kind === "lead" ? "crm.lead" : "crm.contact", entityId: row.id });
  return { kind: target.kind, id: row.id };
}
