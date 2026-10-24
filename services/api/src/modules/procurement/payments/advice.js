// The payment advice sent to the supplier (Procurement report Phase 2): when a payment is recorded (after Pay selected, or once Finance
// approves it), its advice PDF — the bills it settles, TDS deducted, the amount and reference — is emailed to the supplier's accounts
// contact (else its main contact, else the supplier's email), so the supplier can match the money without calling. A WhatsApp message
// with the same summary is offered too. Every send is kept. Sending automatically is a Procurement Setup switch (on by default).
import { whatsappNumber } from "@vercentlabs/shared-types";
import { sendMail } from "../../../core/platform/mail/transport.js";
import { poCan } from "../purchase-orders/access.js";
import { BILL_PERMISSIONS, SupplierBillError, requireUuid, text } from "../supplier-bills/constants.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PAID = ["posted", "partially_applied", "applied"];
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const rupees = (value, currency) => `${currency === "INR" ? "₹" : `${currency} `}${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Whom the advice goes to: the accounts contact, else the primary contact, else the supplier's own email and phone.
export async function paymentAdviceRecipient(client, organizationId, supplierId) {
  const row = (await client.query(
    `SELECT supplier.primary_email, supplier.primary_phone, party.display_name,
            accounts.email AS accounts_email, COALESCE(accounts.mobile, accounts.phone) AS accounts_phone, COALESCE(accounts.display_name, concat_ws(' ', accounts.first_name, accounts.last_name)) AS accounts_name,
            main.email AS main_email, COALESCE(main.mobile, main.phone) AS main_phone, COALESCE(main.display_name, concat_ws(' ', main.first_name, main.last_name)) AS main_name
       FROM tenant.procurement_suppliers supplier
       JOIN tenant.business_parties party ON party.organization_id = supplier.organization_id AND party.id = supplier.party_id
       LEFT JOIN tenant.procurement_supplier_defaults defaults ON defaults.organization_id = supplier.organization_id AND defaults.supplier_id = supplier.id
       LEFT JOIN tenant.procurement_supplier_contacts accounts_link ON accounts_link.organization_id = supplier.organization_id AND accounts_link.id = defaults.accounts_contact_id
       LEFT JOIN tenant.contacts accounts ON accounts.organization_id = accounts_link.organization_id AND accounts.id = accounts_link.contact_id
       LEFT JOIN tenant.procurement_supplier_contacts main_link ON main_link.organization_id = supplier.organization_id AND main_link.id = defaults.primary_contact_id
       LEFT JOIN tenant.contacts main ON main.organization_id = main_link.organization_id AND main.id = main_link.contact_id
      WHERE supplier.organization_id = $1 AND supplier.id = $2`, [organizationId, supplierId])).rows[0];
  if (!row) return { email: null, phone: null, name: null };
  return {
    email: row.accounts_email || row.main_email || row.primary_email || null,
    phone: row.accounts_phone || row.main_phone || row.primary_phone || null,
    name: row.accounts_email ? row.accounts_name : row.main_email ? row.main_name : row.display_name,
  };
}

// The message: the amount, the reference and the bills it settles. detail: getSupplierPayment's result.
export function paymentAdviceText(detail, company) {
  const { payment, allocations, planned } = detail;
  const bills = (allocations.length ? allocations.filter((entry) => !entry.reversed) : planned)
    .map((entry) => `${entry.supplierInvoice ?? entry.billNumber}: ${rupees(entry.amount, payment.currencyCode)}`);
  return [
    `Payment advice from ${company ?? "us"}`,
    `We have paid ${rupees(payment.amount, payment.currencyCode)} on ${payment.date}${payment.reference ? ` (reference ${payment.reference})` : ""}, payment ${payment.number}.`,
    ...(bills.length ? ["", "For your invoices:", ...bills.map((line) => `• ${line}`)] : []),
    ...(Number(payment.tdsWithheld) > 0 ? ["", `TDS deducted: ${rupees(payment.tdsWithheld, payment.currencyCode)}.`] : []),
  ].join("\n");
}

async function companyName(client, organizationId) {
  return (await client.query(`SELECT name FROM public.organizations WHERE id = $1`, [organizationId])).rows[0]?.name ?? null;
}

// sendPaymentAdvice. detail: getSupplierPayment's result; attachment: { fileName, content } (the advice PDF). input: { to?, cc?, auto? }.
// Returns { sent, to, reason }. An automatic send that cannot go (no email, mail not set up) is kept as not sent, never an error.
export async function sendPaymentAdvice(client, context, detail, input = {}, attachment = null, env = process.env) {
  if (!poCan(context, BILL_PERMISSIONS.payments) && !poCan(context, BILL_PERMISSIONS.view))
    throw new SupplierBillError(403, "You do not have permission to send payment advice.", "PERMISSION_DENIED");
  const { payment, supplier } = detail;
  const auto = Boolean(input.auto);
  const keep = async (status, recipients, messageId = null, reason = null) => {
    await client.query(
      `INSERT INTO tenant.procurement_payment_advice_sends (organization_id, vendor_payment_id, channel, recipients, status, message_id, reason, automatic, sent_by)
       VALUES ($1, $2, 'email', $3, $4, $5, $6, $7, $8)`, [context.organizationId, payment.id, recipients, status, messageId, reason, auto, context.userId ?? null]);
    return { sent: status === "sent", to: recipients, reason };
  };
  if (!PAID.includes(payment.status)) {
    if (auto) return { sent: false, to: null, reason: "The payment is not recorded yet." };
    throw new SupplierBillError(409, "Send the advice once the payment is recorded.", "PAYMENT_ADVICE_NOT_PAID");
  }
  const recipient = await paymentAdviceRecipient(client, context.organizationId, supplier.id);
  const to = text(input.to, 320) ?? recipient.email;
  if (!to || !EMAIL.test(to)) {
    if (auto) return keep("not_sent", "", null, "The supplier has no email address.");
    throw new SupplierBillError(400, "Enter the supplier's email address.", "PAYMENT_ADVICE_EMAIL_INVALID", { issues: [{ field: "to", message: "Enter an email address." }] });
  }
  const cc = (text(input.cc, 1000) ?? "").split(/[,;\s]+/).filter(Boolean);
  if (cc.some((address) => !EMAIL.test(address))) throw new SupplierBillError(400, "Check the CC email addresses.", "PAYMENT_ADVICE_EMAIL_INVALID");
  const company = await companyName(client, context.organizationId);
  const message = paymentAdviceText(detail, company);
  const subject = `Payment advice ${payment.number} · ${rupees(payment.amount, payment.currencyCode)}`;
  const result = await sendMail({
    meter: { client, organizationId: context.organizationId }, to, cc: cc.length ? cc : undefined, subject, text: message,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${escapeHtml(message).replace(/\n/g, "<br>")}</body></html>`,
    attachments: attachment?.content?.length ? [{ filename: `${attachment.fileName}.pdf`.replace(/\.pdf\.pdf$/, ".pdf"), content: attachment.content, contentType: "application/pdf" }] : undefined,
  }, env);
  const recipients = [to, ...cc].join(", ");
  if (!result.sent) {
    if (auto) return keep("not_sent", recipients, null, "Email is not set up for this workspace.");
    throw new SupplierBillError(409, "Email is not set up for this workspace. Download the advice and send it yourself.", "PAYMENT_ADVICE_EMAIL_UNAVAILABLE");
  }
  return keep("sent", recipients, result.messageId ?? null);
}

// What was sent, and the WhatsApp link with the same summary.
export async function paymentAdviceSends(client, context, detail) {
  const rows = (await client.query(
    `SELECT send.channel, send.recipients, send.status, send.reason, send.automatic, send.created_at, sender.full_name AS sent_by_name
       FROM tenant.procurement_payment_advice_sends send LEFT JOIN public.users sender ON sender.id = send.sent_by
      WHERE send.organization_id = $1 AND send.vendor_payment_id = $2 ORDER BY send.created_at DESC`, [context.organizationId, requireUuid(detail.payment.id, "Payment")])).rows;
  const recipient = await paymentAdviceRecipient(client, context.organizationId, detail.supplier.id);
  const phone = whatsappNumber(recipient.phone);
  const message = paymentAdviceText(detail, await companyName(client, context.organizationId));
  return {
    sends: rows.map((row) => ({ channel: row.channel, recipients: row.recipients, status: row.status, reason: row.reason, automatic: row.automatic, at: row.created_at, by: row.sent_by_name })),
    recipient: { email: recipient.email, name: recipient.name },
    whatsapp: `https://wa.me/${phone ?? ""}?text=${encodeURIComponent(message)}`,
  };
}

export async function paymentAdviceAuto(client, organizationId) {
  return (await client.query(`SELECT payment_advice_auto FROM tenant.procurement_settings WHERE organization_id = $1`, [organizationId])).rows[0]?.payment_advice_auto !== false;
}
