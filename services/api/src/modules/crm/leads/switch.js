// The leads switch (CRM plan 5.7). A business that does not qualify enquiries separately can switch leads off: Leads leaves the menu,
// and every enquiry that arrives on its own — a web form, a lead connector, an email, WhatsApp — is converted straight into a company,
// contact and deal (the matching ones when found), as Convert would with its suggested choices. One that cannot be converted (no way to
// reach the person, say) stays a lead, reachable from the deal list's "Unconverted enquiries" link. Leads typed in or imported are kept
// as leads. Switching back on changes nothing already converted.
import { CrmError } from "../data-management/errors.js";

export async function leadsEnabled(client, organizationId) {
  const row = (await client.query("SELECT leads_enabled FROM tenant.crm_settings WHERE organization_id = $1", [organizationId])).rows[0];
  return row?.leads_enabled ?? true;
}

export async function setLeadsEnabled(client, context, enabled) {
  if (!context.roleSlugs?.includes("organization_owner") && !context.permissions?.includes("crm.settings.manage"))
    throw new CrmError(403, "You do not have permission to change CRM settings.", "PERMISSION_DENIED");
  await client.query(
    `INSERT INTO tenant.crm_settings (organization_id, leads_enabled, created_by, updated_by) VALUES ($1, $2, $3, $3)
     ON CONFLICT (organization_id) DO UPDATE SET leads_enabled = EXCLUDED.leads_enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, Boolean(enabled), context.userId ?? null]);
  return { leadsEnabled: Boolean(enabled) };
}

// What converting an arriving enquiry may do: create the company, contact and deal, use matching ones, and convert without the
// qualification a person would record. Recorded as the organization's creator (or the lead's owner).
async function conversionAuthority(client, organizationId, actAs) {
  const creator = (await client.query("SELECT created_by FROM public.organizations WHERE id = $1", [organizationId])).rows[0]?.created_by ?? null;
  return {
    organizationId, userId: actAs ?? creator, roleSlugs: [],
    permissions: ["crm.view", "crm.records.view_all", "crm.leads.view", "crm.leads.view_all", "crm.leads.view_sensitive", "crm.leads.edit", "crm.leads.convert",
      "crm.leads.override_qualification", "crm.leads.convert_use_existing", "crm.leads.convert_create_account", "crm.leads.convert_create_contact",
      "crm.leads.convert_change_owner", "crm.accounts.view", "crm.accounts.view_all", "crm.accounts.create", "crm.contacts.view", "crm.contacts.view_all",
      "crm.contacts.create", "crm.opportunities.view", "crm.opportunities.view_all", "crm.opportunities.create", "crm.opportunities.assign", "parties.manage",
      "crm.follow_ups.view_all", "crm.tasks.view_all"],
  };
}

// After an enquiry arrived as a lead: with leads switched off, converts it. Returns the conversion, or null (leads on, or it could not be
// converted — then it stays a lead). Never throws for the enquiry's sake.
export async function convertArrivingLead(client, organizationId, leadId) {
  if (await leadsEnabled(client, organizationId)) return null;
  const owner = (await client.query("SELECT owner_user_id FROM tenant.crm_leads WHERE organization_id = $1 AND id = $2", [organizationId, leadId])).rows[0]?.owner_user_id ?? null;
  const authority = await conversionAuthority(client, organizationId, owner);
  const { previewLeadConversion } = await import("../conversion/preview.js");
  const { convertLead } = await import("../conversion/convert.js");
  await client.query("SAVEPOINT convert_arriving_lead");
  try {
    const preview = await previewLeadConversion(client, authority, leadId);
    const closeDate = (await client.query("SELECT to_char((now() AT TIME ZONE COALESCE(timezone, 'Asia/Kolkata'))::date + 30, 'YYYY-MM-DD') AS d FROM public.organizations WHERE id = $1",
      [organizationId])).rows[0].d;
    const done = await convertLead(client, authority, leadId, {
      account: { ...preview.defaults.account, acknowledgeMatches: true }, contact: { ...preview.defaults.contact, acknowledgeMatches: true },
      opportunity: { ...preview.defaults.opportunity, expectedCloseDate: preview.defaults.opportunity?.expectedCloseDate ?? closeDate, acknowledgeMatches: true },
      overrideReason: "Leads are switched off: enquiries become deals as they arrive.", idempotencyKey: `arriving:${leadId}`,
    });
    await client.query("RELEASE SAVEPOINT convert_arriving_lead");
    return done;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT convert_arriving_lead");
    if (!(error instanceof CrmError)) throw error;
    return null;
  }
}
