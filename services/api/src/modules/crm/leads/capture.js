// Public web-to-lead capture: a website form (the marketing site's demo
// request, or a customer's own site) posts a lead with a capture-form key.
// The key resolves its organization before any organization context exists;
// from there the submission is an ordinary createLead, so validation,
// duplicate detection, assignment rules and history all apply.
//
// The public response never reveals whether a matching record already
// exists: a duplicate submission is accepted and silently not created.
import { CrmError } from "../data-management/errors.js";
import { createLead } from "./records.js";
import { LEAD_PERMISSIONS } from "./constants.js";

const CAPTURE_FIELDS = Object.freeze([
  "firstName", "lastName", "companyName", "jobTitle", "email", "phone", "mobile", "website", "city", "state", "countryCode",
  "industry", "productInterest", "description", "sourceDetail",
]);

// Ingress lookup through the definer function: no organization context yet.
export async function resolvePublicCaptureOrganization(queryable, formKey) {
  const result = await queryable.query("SELECT form.organization_id FROM tenant.crm_public_capture_form($1) AS form", [formKey]);
  return result.rows[0]?.organization_id ?? null;
}

// requestContext: { origin, fingerprint }
export async function captureCrmLead(client, formKey, input = {}, requestContext = {}) {
  const form = (await client.query(`SELECT * FROM tenant.crm_public_capture_form($1)`, [formKey])).rows[0];
  if (!form) throw new CrmError(404, "Lead-capture form not found.");
  await client.query("SELECT set_config('app.current_organization_id', $1, true)", [form.organization_id]);

  const origin = String(requestContext.origin || "");
  if (form.allowed_origins?.length && !form.allowed_origins.includes(origin))
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
    if (!String(input[field] ?? "").trim()) throw new CrmError(400, `${field} is required.`);

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
  if (form.owner_user_id) lead.ownerUserId = form.owner_user_id;

  try {
    const created = await createLead(client, context, lead, { origin: "integration" });
    if (form.campaign_id) {
      await client.query(`UPDATE tenant.crm_leads SET campaign_id = $3 WHERE organization_id = $1 AND id = $2`, [form.organization_id, created.id, form.campaign_id]);
      await client.query(
        `INSERT INTO tenant.crm_campaign_members (organization_id, campaign_id, lead_id, member_status, created_by)
         VALUES ($1, $2, $3, 'responded', $4) ON CONFLICT DO NOTHING`,
        [form.organization_id, form.campaign_id, created.id, actor],
      );
    }
    return { message: form.success_message, leadId: created.id };
  } catch (error) {
    if (error instanceof CrmError && error.code === "CRM_LEAD_DUPLICATE") return { message: form.success_message, leadId: null, duplicateSuppressed: true };
    throw error;
  }
}
