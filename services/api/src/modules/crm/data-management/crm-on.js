// CRM's public entry points (web forms, website chat, lead connectors, WhatsApp and call/SMS callbacks) run without a signed-in person,
// so the CRM-app check every signed-in CRM route gets (workspaceRoute module "crm") is made here instead: once the organization is
// known, nothing is created or changed while CRM is switched off or not in the plan (core/access/apps.js, the same decision).
import { appOn } from "../../../core/access/apps.js";
import { CrmError } from "./errors.js";

export const crmIsOn = (client, organizationId) => appOn(client, { organizationId }, "crm");

// For a visitor-facing entry (a form, the chat): refuses as "not found", so a switched-off CRM leaves nothing on the website.
export async function requireCrmOn(client, organizationId, message) {
  if (!(await crmIsOn(client, organizationId))) throw new CrmError(404, message, "CRM_APP_OFF");
}
