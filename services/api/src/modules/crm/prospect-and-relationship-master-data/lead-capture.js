import { evaluateLeadDuplicateRisk } from "./lead-duplicates.js";
import { resolveIngestionLeadSource } from "./lead-source-validation.js";
import { getEligibleLeadAssignee } from "../lead-lifecycle-qualification-and-prioritization/lead-governance.js";
import { CrmError } from "../crm-data-operations-and-customization/errors.js";
import { createCrmRecord, runCrmAutomation } from "../crm-data-operations-and-customization/resource-mutation-service.js";



export async function captureCrmLead(
  client,
  formKey,
  input,
  requestContext = {},
) {
  const formResult = await client.query(
    `SELECT * FROM tenant.crm_public_capture_form($1)`,
    [formKey],
  );
  const form = formResult.rows[0];
  if (!form) throw new CrmError(404, "Lead-capture form not found.");
  await client.query(
    "SELECT set_config('app.current_organization_id', $1, true)",
    [form.organization_id],
  );
  const origin = String(requestContext.origin || "");
  if (form.allowed_origins?.length && !form.allowed_origins.includes(origin))
    throw new CrmError(403, "This origin is not allowed to submit the form.");
  if (input.websiteUrl || input.companyWebsiteHidden)
    throw new CrmError(400, "Submission rejected.");
  const fingerprint = String(requestContext.fingerprint || "unknown"),
    window = new Date();
  window.setMinutes(0, 0, 0);
  const rate = await client.query(
    `INSERT INTO tenant.crm_capture_rate_limits (organization_id, form_id, fingerprint, window_started_at, attempts) VALUES ($1,$2,$3,$4,1) ON CONFLICT (organization_id, form_id, fingerprint, window_started_at) DO UPDATE SET attempts=tenant.crm_capture_rate_limits.attempts+1 RETURNING attempts`,
    [form.organization_id, form.id, fingerprint, window],
  );
  if (Number(rate.rows[0].attempts) > Number(form.rate_limit_per_hour))
    throw new CrmError(429, "Too many submissions. Try again later.");
  for (const field of form.required_fields || [])
    if (!input[field] || String(input[field]).trim() === "")
      throw new CrmError(400, `${field} is required.`);
  const context = {
    organizationId: form.organization_id,
    userId: form.owner_user_id || null,
    activeCompanyId: form.company_id,
    activeBranchId: form.branch_id,
    allowAllCompanies: false,
  };
  if (!context.userId) {
    const owner = await client.query(
      `SELECT created_by FROM public.organizations WHERE id=$1`,
      [form.organization_id],
    );
    context.userId = owner.rows[0]?.created_by;
  }
  // F008 public repeat submissions are checked with the same canonical
  // organization-wide engine as authenticated create. Exact duplicates are
  // suppressed without exposing whether a CRM record exists.
  const duplicateEvaluation = await evaluateLeadDuplicateRisk(
    client,
    context,
    input,
    { lock: true },
  );
  if (duplicateEvaluation.classification === "exact") {
    return {
      message: form.success_message,
      leadId: null,
      duplicateSuppressed: true,
    };
  }
  const resolvedSourceId = await resolveIngestionLeadSource(
    client,
    context,
    form.source_id,
  );
  const configuredCaptureOwner = form.owner_user_id
    ? await getEligibleLeadAssignee(client, context, form.owner_user_id, {
        companyId: form.company_id,
        branchId: form.branch_id,
      })
    : null;
  const lead = await createCrmRecord(client, context, "leads", {
    ...input,
    companyId: form.company_id,
    branchId: form.branch_id,
    sourceId: resolvedSourceId,
    campaignId: form.campaign_id,
    ownerUserId: configuredCaptureOwner?.id || null,
  });
  if (form.campaign_id) {
    const membership = await client.query(
      `INSERT INTO tenant.crm_campaign_members (organization_id,campaign_id,lead_id,member_status,created_by) VALUES ($1,$2,$3,'responded',$4) ON CONFLICT DO NOTHING RETURNING id`,
      [form.organization_id, form.campaign_id, lead.id, context.userId],
    );
    if (membership.rows[0])
      await runCrmAutomation(client, context, "campaign.member_responded", "lead", lead.id, {
        ...lead,
        campaignId: form.campaign_id,
      });
  }
  return {
    message: form.success_message,
    leadId: lead.id,
    duplicateWarning: duplicateEvaluation.classification === "probable",
  };
}
