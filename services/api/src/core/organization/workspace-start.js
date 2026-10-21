// The first screens of a workspace (MVP 44): the one GST question a new company is asked.
import { hasSessionPermission } from "../access/index.js";
import { updateCompanyProfile } from "./company-profile.js";

export class WorkspaceStartError extends Error {
  constructor(status, message, code = "WORKSPACE_START_ERROR", details) {
    super(message);
    this.name = "WorkspaceStartError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}

// The GST question: needed while GST is on and no company registration says which state the business is in.
export async function getGstDetailsStatus(client, session) {
  const settings = (await client.query(`SELECT COALESCE(tax_enabled, true) AS tax_enabled FROM tenant.tax_settings WHERE organization_id = $1`, [session.organizationId])).rows[0];
  const registration = (await client.query(`SELECT registration_number, state_code FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' AND state_code IS NOT NULL
      ORDER BY is_default DESC, created_at LIMIT 1`, [session.organizationId])).rows[0];
  const organization = (await client.query(`SELECT state_code FROM public.organizations WHERE id = $1`, [session.organizationId])).rows[0];
  const taxEnabled = settings?.tax_enabled !== false;
  return { needed: taxEnabled ? !registration : !organization?.state_code, taxEnabled, gstin: registration?.registration_number ?? null,
    stateCode: registration?.state_code ?? organization?.state_code ?? null, canEdit: hasSessionPermission(session, "organization.manage") };
}
// input: registered (true: gstin — the state comes from it; false: stateCode only, and sales are made without GST; purchases still carry the GST
// suppliers charge, which an unregistered business can't claim back).
export async function saveGstDetails(client, session, input = {}) {
  if (!hasSessionPermission(session, "organization.manage")) throw new WorkspaceStartError(403, "Ask the owner or an administrator to add the GST details.", "GST_DETAILS_DENIED");
  const registered = input.registered === true || input.registered === "true";
  if (registered) {
    const gstin = String(input.gstin ?? "").trim().toUpperCase();
    if (!gstin) throw new WorkspaceStartError(422, "Enter your GSTIN.", "GST_DETAILS_INVALID", { field: "gstin" });
    await updateCompanyProfile(client, session, { gstin, address: { stateCode: gstin.slice(0, 2) } });
    await client.query(`INSERT INTO tenant.tax_settings (organization_id, tax_enabled) VALUES ($1, true) ON CONFLICT (organization_id) DO UPDATE SET tax_enabled = true`, [session.organizationId]);
  } else {
    const stateCode = String(input.stateCode ?? "").trim();
    if (!/^\d{2}$/.test(stateCode)) throw new WorkspaceStartError(422, "Pick your state.", "GST_DETAILS_INVALID", { field: "stateCode" });
    await updateCompanyProfile(client, session, { address: { stateCode } });
    await client.query(`INSERT INTO tenant.tax_settings (organization_id, tax_enabled, purchase_tax_enabled) VALUES ($1, false, true)
      ON CONFLICT (organization_id) DO UPDATE SET tax_enabled = false, purchase_tax_enabled = true`, [session.organizationId]);
  }
  return getGstDetailsStatus(client, session);
}

