// Automatic payment reminders (Sales report Phase 2). Each rule fires a set number of days before or after an invoice's due date, by
// email, WhatsApp (a template approved on the company's WhatsApp Business number) or both, once per invoice. The run skips a customer
// who promised to pay by a date still to come, an invoice in dispute, and a customer whose reminders are paused. The company chooses:
//   off      nothing runs
//   preview  the run only logs what it would send (a week of this first is the advice), so the rules can be checked
//   send     reminders go out
// Setting the rules up needs the Sales settings permission; the run is the worker's, once a day.
import { escapeHtml } from "../../../core/platform/mail/index.js";
import { sendMail } from "../../../core/platform/mail/transport.js";
import { sendWhatsAppTemplate } from "../bridges/whatsapp.js";
import { SalesError } from "../index.js";
import { companyToday } from "../today.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MODES = Object.freeze(["off", "preview", "send"]);
// How far back a new rule looks: an invoice whose reminder day passed more than this long ago is not chased now.
const CATCH_UP_DAYS = 7;
const text = (value, max) => String(value ?? "").trim().slice(0, max);
const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
const invalid = (message, field) => new SalesError(400, message, "SALES_REMINDER_INVALID", { field });
export const DEFAULT_REMINDER_MESSAGE =
  "Dear {customer},\n\nThis is a reminder that invoice {invoice} for {amount} is due on {due_date}. Please ignore this if you have already paid.\n\nThank you,\n{company}";

function requireManage(context) {
  if (!can(context, "sales.settings.manage")) throw new SalesError(403, "You do not have permission to set up payment reminders.", "PERMISSION_DENIED");
}
function requireView(context) {
  if (!can(context, "sales.settings.manage") && !can(context, "sales.customers.view_financials"))
    throw new SalesError(403, "You do not have permission to see payment reminders.", "PERMISSION_DENIED");
}

const ruleView = (row) => ({
  id: row.id, name: row.name, daysOffset: row.days_offset, sendEmail: row.send_email, sendWhatsApp: row.send_whatsapp, whatsappTemplate: row.whatsapp_template,
  whatsappLanguage: row.whatsapp_language, subject: row.subject, message: row.message, active: row.status === "active",
  when: row.days_offset === 0 ? "On the due date" : row.days_offset < 0 ? `${-row.days_offset} days before the due date` : `${row.days_offset} days after the due date`,
});

export async function getPaymentReminders(client, context) {
  requireView(context);
  const mode = (await client.query("SELECT payment_reminders_mode FROM tenant.sales_settings WHERE organization_id = $1", [context.organizationId])).rows[0]?.payment_reminders_mode ?? "off";
  const rules = (await client.query("SELECT * FROM tenant.sales_reminder_rules WHERE organization_id = $1 ORDER BY status, days_offset, lower(name)", [context.organizationId])).rows;
  return { mode, rules: rules.map(ruleView), defaultMessage: DEFAULT_REMINDER_MESSAGE };
}

export async function setPaymentRemindersMode(client, context, mode) {
  requireManage(context);
  if (!MODES.includes(mode)) throw invalid("Choose Off, Preview or On.", "mode");
  await client.query(
    `INSERT INTO tenant.sales_settings (organization_id, payment_reminders_mode, created_by, updated_by) VALUES ($1, $2, $3, $3)
     ON CONFLICT (organization_id) DO UPDATE SET payment_reminders_mode = EXCLUDED.payment_reminders_mode, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, mode, context.userId ?? null]);
  return { mode };
}

function readRule(input, current = null) {
  const pick = (key, column) => (Object.prototype.hasOwnProperty.call(input, key) ? input[key] : current?.[column]);
  const name = text(pick("name", "name"), 120);
  if (!name) throw invalid("Name the reminder.", "name");
  const days = Number(pick("daysOffset", "days_offset"));
  if (!Number.isInteger(days) || days < -60 || days > 365) throw invalid("Enter the days: up to 60 before the due date, or up to 365 after.", "daysOffset");
  const sendEmail = Boolean(pick("sendEmail", "send_email") ?? true);
  const sendWhatsApp = Boolean(pick("sendWhatsApp", "send_whatsapp") ?? false);
  if (!sendEmail && !sendWhatsApp) throw invalid("Choose email, WhatsApp or both.", "sendEmail");
  const whatsappTemplate = text(pick("whatsappTemplate", "whatsapp_template"), 120) || null;
  if (sendWhatsApp && !whatsappTemplate) throw invalid("Enter the name of the approved WhatsApp template.", "whatsappTemplate");
  return {
    name, days, sendEmail, sendWhatsApp, whatsappTemplate, whatsappLanguage: text(pick("whatsappLanguage", "whatsapp_language"), 10) || "en",
    subject: text(pick("subject", "subject"), 200) || null, message: text(pick("message", "message"), 4000) || null,
  };
}

async function lockRule(client, context, ruleId) {
  if (!UUID.test(String(ruleId ?? ""))) throw new SalesError(404, "Reminder not found.", "SALES_REMINDER_NOT_FOUND");
  const row = (await client.query("SELECT * FROM tenant.sales_reminder_rules WHERE organization_id = $1 AND id = $2 FOR UPDATE", [context.organizationId, ruleId])).rows[0];
  if (!row) throw new SalesError(404, "Reminder not found.", "SALES_REMINDER_NOT_FOUND");
  return row;
}

export async function saveReminderRule(client, context, input = {}, ruleId = null) {
  requireManage(context);
  const current = ruleId ? await lockRule(client, context, ruleId) : null;
  const rule = readRule(input, current);
  const values = [rule.name, rule.days, rule.sendEmail, rule.sendWhatsApp, rule.whatsappTemplate, rule.whatsappLanguage, rule.subject, rule.message, context.userId ?? null];
  const row = current
    ? (await client.query(
      `UPDATE tenant.sales_reminder_rules SET name = $3, days_offset = $4, send_email = $5, send_whatsapp = $6, whatsapp_template = $7, whatsapp_language = $8, subject = $9,
              message = $10, updated_by = $11, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`, [context.organizationId, current.id, ...values])).rows[0]
    : (await client.query(
      `INSERT INTO tenant.sales_reminder_rules (organization_id, name, days_offset, send_email, send_whatsapp, whatsapp_template, whatsapp_language, subject, message, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING *`, [context.organizationId, ...values])).rows[0];
  return { rule: ruleView(row) };
}

export async function setReminderRuleActive(client, context, ruleId, active) {
  requireManage(context);
  const current = await lockRule(client, context, ruleId);
  const row = (await client.query("UPDATE tenant.sales_reminder_rules SET status = $3, updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *",
    [context.organizationId, current.id, active ? "active" : "inactive", context.userId ?? null])).rows[0];
  return { rule: ruleView(row) };
}

export async function deleteReminderRule(client, context, ruleId) {
  requireManage(context);
  const current = await lockRule(client, context, ruleId);
  await client.query("DELETE FROM tenant.sales_reminder_rules WHERE organization_id = $1 AND id = $2", [context.organizationId, current.id]);
  return { deleted: true };
}

// A customer left out of automatic reminders (a key account, a dispute handled by hand), or back in.
export async function setCustomerRemindersPaused(client, context, partyId, paused) {
  if (!can(context, "sales.customers.edit") && !can(context, "sales.settings.manage") && !can(context, "sales.invoice.record_payment"))
    throw new SalesError(403, "You do not have permission to change this customer's reminders.", "PERMISSION_DENIED");
  const updated = await client.query("UPDATE tenant.business_parties SET payment_reminders_paused = $3 WHERE organization_id = $1 AND id = $2",
    [context.organizationId, UUID.test(String(partyId ?? "")) ? partyId : null, Boolean(paused)]);
  if (!updated.rowCount) throw new SalesError(404, "Customer not found.", "SALES_CUSTOMER_NOT_FOUND");
  return { paused: Boolean(paused) };
}

// What the reminders did (or would have done, in preview), newest first. options: { partyId?, limit? }
export async function listReminderLog(client, context, options = {}) {
  requireView(context);
  const values = [context.organizationId];
  let where = "log.organization_id = $1";
  if (UUID.test(String(options.partyId ?? ""))) { values.push(options.partyId); where += ` AND log.party_id = $${values.length}`; }
  const rows = (await client.query(
    `SELECT log.*, log.run_on::text AS run_day, rule.name AS rule_name, party.display_name AS customer_name, invoice.invoice_number
       FROM tenant.sales_reminder_log log
       LEFT JOIN tenant.sales_reminder_rules rule ON rule.organization_id = log.organization_id AND rule.id = log.rule_id
       LEFT JOIN tenant.business_parties party ON party.organization_id = log.organization_id AND party.id = log.party_id
       LEFT JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = log.organization_id AND invoice.id = log.invoice_id
      WHERE ${where} ORDER BY log.created_at DESC LIMIT ${Math.min(Math.max(Number(options.limit) || 50, 1), 200)}`, values)).rows;
  return {
    log: rows.map((row) => ({
      id: row.id, ruleName: row.rule_name, partyId: row.party_id, customerName: row.customer_name, invoiceId: row.invoice_id, invoiceNumber: row.invoice_number,
      runOn: row.run_day, status: row.status, channels: row.channels, amountDue: row.amount_due == null ? null : Number(row.amount_due), detail: row.detail,
    })),
  };
}

const fill = (template, values) => template.replace(/\{(customer|invoice|amount|due_date|days|company)\}/g, (_, key) => values[key] ?? "");
const amountText = (currency, value) => `${String(currency).trim()} ${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// The daily run for one company (the worker). options: { today?, env?, fetchImpl? }. Returns { mode, sent, previewed, failed, skipped }.
export async function runPaymentReminders(client, context, options = {}) {
  const mode = (await client.query("SELECT payment_reminders_mode FROM tenant.sales_settings WHERE organization_id = $1", [context.organizationId])).rows[0]?.payment_reminders_mode ?? "off";
  const tally = { mode, sent: 0, previewed: 0, failed: 0, skipped: 0 };
  if (mode === "off") return tally;
  const today = options.today ?? await companyToday(client);
  const company = (await client.query("SELECT COALESCE(NULLIF(legal_name, ''), name) AS name FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0]?.name ?? "";
  const rules = (await client.query("SELECT * FROM tenant.sales_reminder_rules WHERE organization_id = $1 AND status = 'active'", [context.organizationId])).rows;
  for (const rule of rules) {
    // The invoices whose reminder day for this rule is today, or passed within the catch-up window, not yet reminded by it.
    const due = (await client.query(
      `SELECT invoice.id, invoice.invoice_number, invoice.party_id, invoice.due_date::text AS due_day, invoice.outstanding_amount, invoice.currency_code, invoice.status,
              ($3::date - invoice.due_date) AS days_late, party.display_name, party.email AS party_email, party.phone AS party_phone, party.payment_reminders_paused,
              sales.contact_snapshot->>'email' AS contact_email, COALESCE(sales.contact_snapshot->>'mobile', sales.contact_snapshot->>'phone') AS contact_phone,
              EXISTS (SELECT 1 FROM tenant.sales_collection_notes note WHERE note.organization_id = invoice.organization_id AND note.party_id = invoice.party_id
                        AND note.kind = 'promise' AND note.promised_date >= $3::date) AS promised
         FROM tenant.accounting_customer_invoices invoice
         JOIN tenant.business_parties party ON party.organization_id = invoice.organization_id AND party.id = invoice.party_id
         LEFT JOIN tenant.sales_invoices sales ON sales.organization_id = invoice.organization_id AND sales.customer_invoice_id = invoice.id
        WHERE invoice.organization_id = $1 AND invoice.invoice_type = 'invoice' AND invoice.posted_at IS NOT NULL AND invoice.outstanding_amount > 0
          AND invoice.status IN ('posted', 'partially_paid', 'overdue', 'disputed')
          AND invoice.due_date + $2::int BETWEEN $3::date - ${CATCH_UP_DAYS} AND $3::date
          AND NOT EXISTS (SELECT 1 FROM tenant.sales_reminder_log log WHERE log.organization_id = invoice.organization_id AND log.rule_id = $4 AND log.invoice_id = invoice.id
                            AND (log.status <> 'previewed' OR $5 = 'preview'))
        ORDER BY invoice.due_date LIMIT 500`,
      [context.organizationId, rule.days_offset, today, rule.id, mode])).rows;
    for (const invoice of due) {
      const log = async (status, channels, detail) => {
        await client.query(
          `INSERT INTO tenant.sales_reminder_log (organization_id, rule_id, party_id, invoice_id, run_on, status, channels, amount_due, detail) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
           ON CONFLICT DO NOTHING`,
          [context.organizationId, rule.id, invoice.party_id, invoice.id, today, status, channels, invoice.outstanding_amount, detail]);
        tally[status === "sent" ? "sent" : status === "previewed" ? "previewed" : status === "failed" ? "failed" : "skipped"] += 1;
      };
      if (invoice.payment_reminders_paused) { await log("skipped", [], "Reminders are paused for this customer."); continue; }
      if (invoice.status === "disputed") { await log("skipped", [], "The invoice is in dispute."); continue; }
      if (invoice.promised) { await log("skipped", [], "The customer promised to pay by a later date."); continue; }
      const email = invoice.contact_email || invoice.party_email || null;
      const phone = invoice.contact_phone || invoice.party_phone || null;
      const values = { customer: invoice.display_name, invoice: invoice.invoice_number, amount: amountText(invoice.currency_code, invoice.outstanding_amount),
        due_date: invoice.due_day, days: String(Math.abs(Number(invoice.days_late))), company };
      const channels = [...(rule.send_email && email ? ["email"] : []), ...(rule.send_whatsapp && phone ? ["whatsapp"] : [])];
      if (!channels.length) { await log("skipped", [], "No email address or mobile number for this customer."); continue; }
      if (mode === "preview") { await log("previewed", channels, `Would send to ${[email, phone].filter(Boolean).join(" and ")}.`); continue; }
      const problems = [];
      const done = [];
      if (channels.includes("email")) {
        const body = fill(rule.message || DEFAULT_REMINDER_MESSAGE, values);
        const result = await sendMail({
          meter: { client, organizationId: context.organizationId }, to: email, subject: fill(rule.subject || "Payment reminder: invoice {invoice}", values), text: body,
          html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${escapeHtml(body).replace(/\n/g, "<br>")}</body></html>`,
        }, options.env ?? process.env).catch((error) => ({ sent: false, error: String(error?.message ?? error) }));
        if (result.sent) done.push("email"); else problems.push(`Email: ${result.error ?? "email is not set up"}`);
      }
      if (channels.includes("whatsapp")) {
        const result = await sendWhatsAppTemplate(client, context, { phone, templateName: rule.whatsapp_template, templateLanguage: rule.whatsapp_language,
          values: [values.customer, values.invoice, values.amount, values.due_date] }, { env: options.env ?? process.env, ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}) });
        if (result.sent) done.push("whatsapp"); else problems.push(`WhatsApp: ${result.error}`);
      }
      await log(done.length ? "sent" : "failed", done, problems.join(" ") || `Sent to ${[done.includes("email") ? email : null, done.includes("whatsapp") ? phone : null].filter(Boolean).join(" and ")}.`);
    }
  }
  return tally;
}
