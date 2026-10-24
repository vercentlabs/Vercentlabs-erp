// Reminders on WhatsApp and SMS (CRM audit M6): field salespeople live on WhatsApp and the phone, not email. Each person chooses
// for themselves whether their reminders also reach them on WhatsApp or by SMS, at the mobile their calls ring (crm_call_agents).
// The company names the approved WhatsApp template and the DLT SMS template that carry a reminder — WhatsApp and TRAI let a business
// send only those. The template's two values are what the reminder says: its title ({{1}} / first {#var#}) and the details ({{2}}).
// The in-app notification always goes too; WhatsApp and SMS are extra and never hold it up.
import { CrmError } from "../data-management/errors.js";
import { sendTeamSms } from "../channels/records.js";
import { sendTeamWhatsApp } from "../whatsapp/records.js";

const MANAGE = "crm.settings.manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (value) => String(value ?? "").trim();
const has = (input, field) => Object.prototype.hasOwnProperty.call(input ?? {}, field);
const invalid = (field, message) => new CrmError(400, message, "CRM_REMINDER_CHANNEL_VALIDATION", { issues: [{ field, message }] });

async function companySetup(client, organizationId) {
  const row = (await client.query(
    `SELECT settings.reminder_whatsapp_template, settings.reminder_whatsapp_language, settings.reminder_sms_template_id,
            whatsapp.mode = 'cloud_api' AND whatsapp.phone_number_id IS NOT NULL AS whatsapp_connected, COALESCE(sms.provider, 'none') <> 'none' AS sms_connected
       FROM (SELECT $1::uuid AS organization_id) org
       LEFT JOIN tenant.crm_settings settings ON settings.organization_id = org.organization_id
       LEFT JOIN tenant.crm_whatsapp_settings whatsapp ON whatsapp.organization_id = org.organization_id
       LEFT JOIN tenant.crm_sms_settings sms ON sms.organization_id = org.organization_id`, [organizationId])).rows[0] ?? {};
  return {
    whatsappTemplate: row.reminder_whatsapp_template ?? null, whatsappLanguage: row.reminder_whatsapp_language ?? "en", smsTemplateId: row.reminder_sms_template_id ?? null,
    // Whether a person can turn each on: the channel is connected and the company named its reminder template.
    whatsappReady: Boolean(row.whatsapp_connected && row.reminder_whatsapp_template), smsReady: Boolean(row.sms_connected && row.reminder_sms_template_id),
    whatsappConnected: Boolean(row.whatsapp_connected), smsConnected: Boolean(row.sms_connected),
  };
}

// Why a channel cannot be turned on yet, in words, or null when it can.
const missing = (connected, template, what) => (connected ? (template ? null : `the company has not chosen its ${what} reminder template`) : `${what} is not connected for the company`);

// The caller's own choice, their mobile, and what the company has made possible.
export async function getMyReminderChannels(client, context) {
  const mine = (await client.query("SELECT whatsapp, sms FROM tenant.crm_reminder_channels WHERE organization_id = $1 AND user_id = $2", [context.organizationId, context.userId])).rows[0];
  const phone = (await client.query("SELECT phone FROM tenant.crm_call_agents WHERE organization_id = $1 AND user_id = $2", [context.organizationId, context.userId])).rows[0]?.phone ?? null;
  const company = await companySetup(client, context.organizationId);
  return { whatsapp: Boolean(mine?.whatsapp), sms: Boolean(mine?.sms), mobile: phone, whatsappReady: company.whatsappReady, smsReady: company.smsReady,
    whatsappMissing: missing(company.whatsappConnected, company.whatsappTemplate, "WhatsApp"), smsMissing: missing(company.smsConnected, company.smsTemplateId, "SMS") };
}

// Sends the caller a test reminder now on the channels they saved, so they see it arrive. Returns { whatsapp?, sms? }: "sent" or why not.
export async function sendTestReminder(client, context, options = {}) {
  if (!context.userId) throw new CrmError(403, "Sign in to test your reminders.", "PERMISSION_DENIED");
  const mine = await getMyReminderChannels(client, context);
  if (!mine.whatsapp && !mine.sms) throw invalid("whatsapp", "Turn on WhatsApp or SMS and save first.");
  return remindOnOutsideChannels(client, context.organizationId, context.userId,
    { title: "Test reminder", message: "This is how your CRM follow-up and task reminders arrive." }, options);
}

// input: { whatsapp?, sms?, mobile? } — the mobile is the same number calls ring (one "my mobile" in CRM).
export async function saveMyReminderChannels(client, context, input = {}) {
  if (!context.userId) throw new CrmError(403, "Sign in to choose your reminders.", "PERMISSION_DENIED");
  const current = await getMyReminderChannels(client, context);
  if (has(input, "mobile")) {
    const mobile = text(input.mobile);
    const digits = mobile.replace(/\D/g, "");
    if (mobile && (digits.length < 10 || digits.length > 15)) throw invalid("mobile", "Enter your mobile number, such as +91 98765 43210.");
    if (mobile)
      await client.query(`INSERT INTO tenant.crm_call_agents (organization_id, user_id, phone, updated_at) VALUES ($1, $2, $3, now())
        ON CONFLICT (organization_id, user_id) DO UPDATE SET phone = EXCLUDED.phone, updated_at = now()`, [context.organizationId, context.userId, mobile]);
    else await client.query("DELETE FROM tenant.crm_call_agents WHERE organization_id = $1 AND user_id = $2", [context.organizationId, context.userId]);
  }
  const whatsapp = has(input, "whatsapp") ? input.whatsapp === true : current.whatsapp;
  const sms = has(input, "sms") ? input.sms === true : current.sms;
  const mobile = has(input, "mobile") ? text(input.mobile) : current.mobile;
  if ((whatsapp || sms) && !mobile) throw invalid("mobile", "Enter your mobile number to get reminders on it.");
  if (whatsapp && !current.whatsappReady) throw invalid("whatsapp", "WhatsApp reminders are not set up for the company yet. Ask your CRM administrator.");
  if (sms && !current.smsReady) throw invalid("sms", "SMS reminders are not set up for the company yet. Ask your CRM administrator.");
  await client.query(
    `INSERT INTO tenant.crm_reminder_channels (organization_id, user_id, whatsapp, sms, updated_at) VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (organization_id, user_id) DO UPDATE SET whatsapp = EXCLUDED.whatsapp, sms = EXCLUDED.sms, updated_at = now()`, [context.organizationId, context.userId, whatsapp, sms]);
  return getMyReminderChannels(client, context);
}

// The company's reminder templates (CRM settings managers).
export async function getReminderTemplates(client, context) {
  const company = await companySetup(client, context.organizationId);
  return { whatsappTemplate: company.whatsappTemplate, whatsappLanguage: company.whatsappLanguage, smsTemplateId: company.smsTemplateId,
    whatsappConnected: company.whatsappConnected, smsConnected: company.smsConnected };
}

// input: { whatsappTemplate?, whatsappLanguage?, smsTemplateId? } — empty clears one.
export async function saveReminderTemplates(client, context, input = {}) {
  if (!(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)))
    throw new CrmError(403, "You do not have permission to set up reminders.", "PERMISSION_DENIED");
  const current = await getReminderTemplates(client, context);
  const whatsappTemplate = has(input, "whatsappTemplate") ? text(input.whatsappTemplate) || null : current.whatsappTemplate;
  if (whatsappTemplate && !/^[a-z0-9_]{1,512}$/.test(whatsappTemplate)) throw invalid("whatsappTemplate", "Use the template's name as approved in WhatsApp Manager (lower case and underscores).");
  const whatsappLanguage = has(input, "whatsappLanguage") ? text(input.whatsappLanguage) || "en" : current.whatsappLanguage;
  if (!/^[a-z]{2,3}(_[A-Z]{2})?$/.test(whatsappLanguage)) throw invalid("whatsappLanguage", "Use the template's language code, such as en or hi.");
  const smsTemplateId = has(input, "smsTemplateId") ? text(input.smsTemplateId) || null : current.smsTemplateId;
  if (smsTemplateId && !(UUID.test(smsTemplateId) && (await client.query(
    "SELECT 1 FROM tenant.crm_sms_templates WHERE organization_id = $1 AND id = $2 AND status = 'active' AND category <> 'promotional'", [context.organizationId, smsTemplateId])).rows[0]))
    throw invalid("smsTemplateId", "Choose an active service (not promotional) SMS template.");
  await client.query(
    `INSERT INTO tenant.crm_settings (organization_id, reminder_whatsapp_template, reminder_whatsapp_language, reminder_sms_template_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (organization_id) DO UPDATE SET reminder_whatsapp_template = EXCLUDED.reminder_whatsapp_template, reminder_whatsapp_language = EXCLUDED.reminder_whatsapp_language,
       reminder_sms_template_id = EXCLUDED.reminder_sms_template_id, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, whatsappTemplate, whatsappLanguage, smsTemplateId, context.userId ?? null]);
  return getReminderTemplates(client, context);
}

// The worker, after the in-app reminder: sends it on the channels the person chose. Returns { whatsapp?, sms? } — each "sent" or
// why not — and never throws (a WhatsApp or SMS failure never fails the reminder itself).
export async function remindOnOutsideChannels(client, organizationId, userId, { title, message }, options = {}) {
  const result = {};
  try {
    const mine = (await client.query("SELECT whatsapp, sms FROM tenant.crm_reminder_channels WHERE organization_id = $1 AND user_id = $2", [organizationId, userId])).rows[0];
    if (!mine?.whatsapp && !mine?.sms) return result;
    const phone = (await client.query("SELECT phone FROM tenant.crm_call_agents WHERE organization_id = $1 AND user_id = $2", [organizationId, userId])).rows[0]?.phone;
    const company = await companySetup(client, organizationId);
    const values = [text(title).slice(0, 200), text(message).slice(0, 800)];
    for (const [channel, chosen, ready, send] of [
      ["whatsapp", mine.whatsapp, company.whatsappReady, () => sendTeamWhatsApp(client, organizationId, { phone, templateName: company.whatsappTemplate, templateLanguage: company.whatsappLanguage, values }, options)],
      ["sms", mine.sms, company.smsReady, () => sendTeamSms(client, organizationId, { phone, templateId: company.smsTemplateId, values }, options)],
    ]) {
      if (!chosen) continue;
      if (!phone) { result[channel] = "No mobile number"; continue; }
      if (!ready) { result[channel] = "Not set up for the company"; continue; }
      try {
        const outcome = await send();
        result[channel] = outcome.sent ? "sent" : outcome.error ?? "Not sent";
      } catch (error) {
        result[channel] = String(error?.message ?? error).slice(0, 300);
      }
    }
  } catch (error) {
    result.error = String(error?.message ?? error).slice(0, 300);
  }
  return result;
}
