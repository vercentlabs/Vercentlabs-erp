// Receipt reminders (Procurement report Phase 2): once a day, the worker asks suppliers about goods still to come — a few days before an
// order's expected date ("please confirm you will deliver") and, once it has passed, a follow-up ("the goods are late"). Each email
// carries the supplier's page, where they confirm or propose a new date. The company chooses off (default), preview (logged, not sent)
// or sending in Procurement Setup, and how many days before and after. Each order is reminded once per kind (the log is the stamp).
import { escapeHtml } from "../../../core/platform/mail/index.js";
import { sendMail } from "../../../core/platform/mail/transport.js";
import { requirePoAccess, requirePoPermission } from "./access.js";
import { PO_PERMISSIONS, dayOf, fail, has } from "./constants.js";
import { supplierLinkToken, supplierPageUrl } from "./supplier-page.js";

const CATCH_UP_DAYS = 3;
export const RECEIPT_REMINDER_MODES = Object.freeze([
  { code: "off", label: "Off" }, { code: "preview", label: "Preview: log what would be sent" }, { code: "sending", label: "Send to suppliers" },
]);

async function settingsOf(client, organizationId) {
  const row = (await client.query(`SELECT receipt_reminders_mode, receipt_reminder_days_before, receipt_reminder_days_after FROM tenant.procurement_settings WHERE organization_id = $1`,
    [organizationId])).rows[0] ?? {};
  return { mode: row.receipt_reminders_mode ?? "off", daysBefore: row.receipt_reminder_days_before ?? 2, daysAfter: row.receipt_reminder_days_after ?? 1 };
}

// Whom the reminder goes to: the ordering contact, else the primary contact, else the supplier's email.
async function recipientOf(client, organizationId, supplierId) {
  const row = (await client.query(
    `SELECT COALESCE(ordering.email, main.email, supplier.primary_email) AS email
       FROM tenant.procurement_suppliers supplier
       LEFT JOIN tenant.procurement_supplier_defaults defaults ON defaults.organization_id = supplier.organization_id AND defaults.supplier_id = supplier.id
       LEFT JOIN tenant.procurement_supplier_contacts ordering_link ON ordering_link.organization_id = supplier.organization_id AND ordering_link.id = defaults.ordering_contact_id
       LEFT JOIN tenant.contacts ordering ON ordering.organization_id = ordering_link.organization_id AND ordering.id = ordering_link.contact_id
       LEFT JOIN tenant.procurement_supplier_contacts main_link ON main_link.organization_id = supplier.organization_id AND main_link.id = defaults.primary_contact_id
       LEFT JOIN tenant.contacts main ON main.organization_id = main_link.organization_id AND main.id = main_link.contact_id
      WHERE supplier.organization_id = $1 AND supplier.id = $2`, [organizationId, supplierId])).rows[0];
  return row?.email ?? null;
}

const MESSAGES = {
  before: (order, company, url) => ({
    subject: `Purchase order ${order.purchase_order_number}: delivery due ${order.expected_day}`,
    text: `Dear ${order.supplier_name},\n\nOur purchase order ${order.purchase_order_number} is due for delivery on ${order.expected_day}. Please confirm you will deliver on time, or tell us `
      + `the date you can deliver:\n${url}\n\nThank you,\n${company}`,
  }),
  overdue: (order, company, url) => ({
    subject: `Purchase order ${order.purchase_order_number}: delivery was due ${order.expected_day}`,
    text: `Dear ${order.supplier_name},\n\nThe goods on our purchase order ${order.purchase_order_number} were due on ${order.expected_day} and have not all arrived. Please tell us `
      + `when you will deliver:\n${url}\n\nThank you,\n${company}`,
  }),
};

// runReceiptReminders: the day's reminders for the company. Returns { mode, sent, previewed, failed, skipped }.
export async function runReceiptReminders(client, context, options = {}) {
  const settings = await settingsOf(client, context.organizationId);
  const tally = { mode: settings.mode, sent: 0, previewed: 0, failed: 0, skipped: 0 };
  if (settings.mode === "off") return tally;
  const env = options.env ?? process.env;
  const today = options.today ?? (await client.query(`SELECT (now() AT TIME ZONE COALESCE(NULLIF(timezone, ''), 'Asia/Kolkata'))::date::text AS d FROM public.organizations WHERE id = $1`,
    [context.organizationId])).rows[0].d;
  const company = (await client.query("SELECT COALESCE(NULLIF(legal_name, ''), name) AS name FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0]?.name ?? "";
  for (const kind of ["before", "overdue"]) {
    // "before": due within the next days (the reminder day is today, or passed in the catch-up window); "overdue": due date plus the follow-up
    // days reached. Only confirmed orders with goods still to come, not reminded of this kind yet.
    const window = kind === "before"
      ? `po.expected_delivery_date - $3::int BETWEEN $2::date - ${CATCH_UP_DAYS} AND $2::date AND po.expected_delivery_date >= $2::date`
      : `po.expected_delivery_date + $3::int BETWEEN $2::date - ${CATCH_UP_DAYS} AND $2::date`;
    const orders = (await client.query(
      `SELECT po.id, po.purchase_order_number, po.supplier_id, po.expected_delivery_date::text AS expected_day, po.acknowledged_at, po.supplier_proposed_date, party.display_name AS supplier_name
         FROM tenant.purchase_orders po JOIN tenant.business_parties party ON party.organization_id = po.organization_id AND party.id = po.party_id
        WHERE po.organization_id = $1 AND po.status = 'confirmed' AND po.expected_delivery_date IS NOT NULL AND ${window}
          AND EXISTS (SELECT 1 FROM tenant.purchase_order_line_status line WHERE line.organization_id = po.organization_id AND line.purchase_order_id = po.id AND line.remaining_to_receive > 0)
          AND NOT EXISTS (SELECT 1 FROM tenant.procurement_receipt_reminder_log log WHERE log.organization_id = po.organization_id AND log.purchase_order_id = po.id AND log.kind = $4
                            AND (log.status <> 'previewed' OR $5 = 'preview'))
        ORDER BY po.expected_delivery_date LIMIT 500`,
      [context.organizationId, today, kind === "before" ? settings.daysBefore : settings.daysAfter, kind, settings.mode])).rows;
    for (const order of orders) {
      const log = async (status, recipients, detail) => {
        await client.query(
          `INSERT INTO tenant.procurement_receipt_reminder_log (organization_id, purchase_order_id, kind, run_on, status, recipients, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (organization_id, purchase_order_id, kind, status) DO NOTHING`, [context.organizationId, order.id, kind, today, status, recipients, detail]);
        tally[status === "sent" ? "sent" : status === "previewed" ? "previewed" : status === "failed" ? "failed" : "skipped"] += 1;
      };
      // Already answered: a "before" reminder is not needed once the supplier confirmed or proposed a date.
      if (kind === "before" && (order.acknowledged_at || order.supplier_proposed_date)) { await log("skipped", "", "The supplier already answered."); continue; }
      const email = await recipientOf(client, context.organizationId, order.supplier_id);
      if (!email) { await log("skipped", "", "The supplier has no email address."); continue; }
      if (settings.mode === "preview") { await log("previewed", email, `Would send to ${email}.`); continue; }
      const token = await supplierLinkToken(client, { organizationId: context.organizationId, userId: null }, "purchase_order", order.id, env);
      const message = MESSAGES[kind]({ ...order, expected_day: dayOf(order.expected_day) }, company, supplierPageUrl(token, env));
      const result = await sendMail({ meter: { client, organizationId: context.organizationId }, to: email, subject: message.subject, text: message.text,
        html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${escapeHtml(message.text).replace(/\n/g, "<br>")}</body></html>` }, env)
        .catch((error) => ({ sent: false, error: String(error?.message ?? error) }));
      await log(result.sent ? "sent" : "failed", email, result.sent ? `Sent to ${email}.` : `Email: ${result.error ?? "email is not set up"}`);
    }
  }
  return tally;
}

// The reminders of one order, for its page.
export async function receiptRemindersOf(client, context, orderId) {
  requirePoAccess(context);
  return (await client.query(`SELECT kind, run_on, status, recipients, detail, created_at FROM tenant.procurement_receipt_reminder_log WHERE organization_id = $1 AND purchase_order_id = $2
      ORDER BY created_at DESC`, [context.organizationId, orderId])).rows.map((row) => ({ kind: row.kind, runOn: dayOf(row.run_on), status: row.status, recipients: row.recipients, detail: row.detail }));
}

// Setup: input { mode?, daysBefore?, daysAfter? }.
export async function updateReceiptReminderSettings(client, context, input = {}) {
  requirePoPermission(context, PO_PERMISSIONS.settings, "You do not have permission to change procurement settings.");
  const current = await settingsOf(client, context.organizationId);
  const mode = has(input, "mode") ? input.mode : current.mode;
  if (!RECEIPT_REMINDER_MODES.some((entry) => entry.code === mode)) fail("Choose off, preview or send.", "mode");
  const days = (value, label) => { const number = Number(value); if (!Number.isInteger(number) || number < 0 || number > 30) fail(`${label} is a whole number of days, 0 to 30.`); return number; };
  const daysBefore = has(input, "daysBefore") ? days(input.daysBefore, "Days before") : current.daysBefore;
  const daysAfter = has(input, "daysAfter") ? days(input.daysAfter, "Days after") : current.daysAfter;
  await client.query(
    `INSERT INTO tenant.procurement_settings (organization_id, receipt_reminders_mode, receipt_reminder_days_before, receipt_reminder_days_after, updated_by, updated_at)
     VALUES ($1, $2, $3, $4, $5, now()) ON CONFLICT (organization_id) DO UPDATE SET receipt_reminders_mode = EXCLUDED.receipt_reminders_mode,
       receipt_reminder_days_before = EXCLUDED.receipt_reminder_days_before, receipt_reminder_days_after = EXCLUDED.receipt_reminder_days_after, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, mode, daysBefore, daysAfter, context.userId ?? null]);
  return { mode, daysBefore, daysAfter };
}
export const getReceiptReminderSettings = (client, context) => { requirePoAccess(context); return settingsOf(client, context.organizationId); };
