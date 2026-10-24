// The Sales + CRM bridge for WhatsApp: payment reminders go through the company's WhatsApp Business number, which is connected in CRM.
// Without CRM, or without a connected number, nothing is sent and the reason is given.
import { sendTeamWhatsApp } from "../../crm/whatsapp/records.js";
import { crmOn } from "./crm.js";

// Returns { sent, error? }; never throws for WhatsApp's answer.
export async function sendWhatsAppTemplate(client, context, message, options = {}) {
  if (!(await crmOn(client, context))) return { sent: false, error: "WhatsApp is connected in CRM, which is switched off." };
  return sendTeamWhatsApp(client, context.organizationId, message, options);
}
