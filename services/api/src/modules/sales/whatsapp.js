// Sending Sales documents on WhatsApp (Sales audit M6): documents travel on WhatsApp in India. "Send on WhatsApp" on a quotation, its
// proforma, an order confirmation, an invoice, a credit or debit note or a payment receipt — and a payment reminder to a customer that
// owes (Sales plan) — writes the message (number, amount, validity or due date) to the contact's mobile, opens WhatsApp with it ready
// (click-to-chat: the salesperson's own WhatsApp, where they attach the PDF just downloaded), and records it as sent on WhatsApp. The
// message starts from the company's template when it has one (Setup › Print & WhatsApp templates). It works with or without CRM; a
// number on the company's opt-out list is never messaged.
import { optOutOf } from "../crm/data-management/consent.js";
import { markSalesInvoiceSent } from "./invoices/communication.js";
import { markCreditNoteSent } from "./credit-notes/communication.js";
import { markOrderConfirmationSent } from "./order-confirmations/communication.js";
import { markQuotationSent } from "./quotations/lifecycle.js";
import { loadCustomerRow } from "./customers/records.js";
import { SalesError } from "./index.js";
import { shareDocumentLink } from "./portal.js";
import { messageFromTemplate } from "./templates.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = Object.freeze(["quotation", "proforma", "order", "invoice", "credit_note", "debit_note", "receipt", "reminder"]);
const TEMPLATE_OF = Object.freeze({ quotation: "quotation", order: "order_confirmation", invoice: "invoice", credit_note: "credit_note", debit_note: "debit_note", receipt: "receipt",
  reminder: "payment_reminder" });
const day = (value) => {
  if (!value) return null;
  const text = value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : String(value).slice(0, 10);
  return `${text.slice(8, 10)}-${text.slice(5, 7)}-${text.slice(0, 4)}`;
};
const amount = (currency, value) => `${String(currency ?? "").trim() === "INR" ? "₹" : `${String(currency ?? "").trim()} `}${Number(value ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// India's numbers without the country code get it; anything else is kept as dialled.
const waNumber = (phone) => {
  const digits = String(phone ?? "").replace(/\D/g, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `91${digits.slice(1)}`;
  return digits;
};
const can = (context, permission) => context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission);

// The customer's billing (else primary) contact, for a message that is not about one document's contact.
const partyContact = async (client, organizationId, partyId) => (await client.query(
  `SELECT contact.first_name, contact.last_name, contact.mobile, contact.phone FROM tenant.crm_contact_account_relationships link
     JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id
    WHERE link.organization_id = $1 AND link.party_id = $2 AND link.status = 'active' AND contact.status = 'active'
    ORDER BY link.is_billing_contact DESC, link.is_primary_contact DESC LIMIT 1`, [organizationId, partyId])).rows[0] ?? {};

async function documentOf(client, organizationId, kind, id) {
  const one = async (sql) => (await client.query(sql, [organizationId, id])).rows[0];
  if (kind === "quotation" || kind === "proforma")
    return one(`SELECT quote.quotation_number AS number, quote.quotation_date AS date, quote.valid_until, quote.party_id, version.contact_snapshot, version.customer_snapshot,
                       version.grand_total AS total, version.currency_code FROM tenant.sales_quotations quote
                  JOIN tenant.sales_quotation_versions version ON version.organization_id = quote.organization_id AND version.id = quote.current_version_id
                 WHERE quote.organization_id = $1 AND quote.id = $2`);
  if (kind === "order")
    return one(`SELECT sales_order.sales_order_number AS number, sales_order.order_date AS date, sales_order.party_id, version.contact_snapshot, version.customer_snapshot,
                       version.grand_total AS total, version.currency_code, version.customer_po_number FROM tenant.sales_orders sales_order
                  JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
                 WHERE sales_order.organization_id = $1 AND sales_order.id = $2`);
  if (kind === "receipt") {
    const receipt = await one(`SELECT receipt.receipt_number AS number, receipt.receipt_date AS date, receipt.party_id, receipt.amount AS total, receipt.currency_code,
                                      json_build_object('displayName', party.display_name) AS customer_snapshot,
                                      (SELECT string_agg(invoice.invoice_number, ', ' ORDER BY invoice.invoice_number) FROM tenant.accounting_customer_receipt_allocations allocation
                                         JOIN tenant.accounting_customer_invoices invoice ON invoice.id = allocation.customer_invoice_id
                                        WHERE allocation.organization_id = receipt.organization_id AND allocation.receipt_id = receipt.id) AS bills
                                 FROM tenant.accounting_customer_receipts receipt JOIN tenant.business_parties party ON party.id = receipt.party_id
                                WHERE receipt.organization_id = $1 AND receipt.id = $2 AND receipt.status <> 'draft'`);
    return receipt && { ...receipt, contact_snapshot: await partyContact(client, organizationId, receipt.party_id) };
  }
  if (kind === "reminder") {
    const owed = await one(`SELECT party.id AS party_id, json_build_object('displayName', party.display_name) AS customer_snapshot,
                                   btrim(COALESCE(party.currency_code, organization.base_currency)) AS currency_code,
                                   COALESCE(sum(invoice.outstanding_amount), 0) AS total,
                                   COALESCE(sum(invoice.outstanding_amount) FILTER (WHERE invoice.due_date < tenant.company_today()), 0) AS overdue,
                                   min(invoice.due_date) FILTER (WHERE invoice.due_date < tenant.company_today()) AS oldest_due,
                                   string_agg(invoice.invoice_number, ', ' ORDER BY invoice.due_date) FILTER (WHERE invoice.due_date < tenant.company_today()) AS bills
                              FROM tenant.business_parties party JOIN public.organizations organization ON organization.id = party.organization_id
                              LEFT JOIN tenant.accounting_customer_invoices invoice ON invoice.organization_id = party.organization_id AND invoice.party_id = party.id
                                   AND invoice.invoice_type IN ('invoice', 'debit_note', 'opening') AND invoice.status IN ('posted', 'partially_paid', 'overdue', 'disputed') AND invoice.outstanding_amount > 0
                             WHERE party.organization_id = $1 AND party.id = $2 GROUP BY party.id, party.display_name, party.currency_code, organization.base_currency`);
    return owed && { ...owed, contact_snapshot: await partyContact(client, organizationId, owed.party_id) };
  }
  const type = kind === "debit_note" ? "debit_note" : kind === "invoice" ? "invoice" : "credit_note";
  return one(`SELECT invoice.invoice_number AS number, invoice.invoice_date AS date, invoice.due_date, invoice.party_id, invoice.outstanding_amount, invoice.grand_total AS total,
                     invoice.currency_code, COALESCE(sales.contact_snapshot, note.contact_snapshot) AS contact_snapshot,
                     COALESCE(sales.customer_snapshot, note.customer_snapshot, debit.customer_snapshot) AS customer_snapshot
                FROM tenant.accounting_customer_invoices invoice
                LEFT JOIN tenant.sales_invoices sales ON sales.organization_id = invoice.organization_id AND sales.customer_invoice_id = invoice.id
                LEFT JOIN tenant.sales_credit_notes note ON note.organization_id = invoice.organization_id AND note.customer_invoice_id = invoice.id
                LEFT JOIN tenant.sales_debit_notes debit ON debit.organization_id = invoice.organization_id AND debit.customer_invoice_id = invoice.id
               WHERE invoice.organization_id = $1 AND invoice.id = $2 AND invoice.invoice_type = '${type}'`);
}

// The values a template can use, and the built-in message.
function messageOf(kind, doc, company) {
  const contact = doc.contact_snapshot ?? {};
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || doc.customer_snapshot?.displayName || "Sir/Madam";
  const total = amount(doc.currency_code, doc.total);
  const values = { name, number: doc.number ?? "", date: day(doc.date) ?? "", total, valid_until: day(doc.valid_until) ?? "", due_date: day(doc.due_date) ?? "",
    balance: amount(doc.currency_code, doc.outstanding_amount ?? doc.total), po_number: doc.customer_po_number ?? "", bills: doc.bills ?? "",
    overdue: amount(doc.currency_code, doc.overdue ?? 0), oldest_due: day(doc.oldest_due) ?? "", company };
  const line = {
    quotation: `please find our quotation ${doc.number} dated ${values.date} for ${total}${doc.valid_until ? `, valid until ${values.valid_until}` : ""}.`,
    proforma: `please find our proforma invoice against quotation ${doc.number} for ${total}${doc.valid_until ? `, valid until ${values.valid_until}` : ""}.`,
    order: `thank you for your order${doc.customer_po_number ? ` ${doc.customer_po_number}` : ""}. Please find our order confirmation ${doc.number} for ${total}.`,
    invoice: `please find our invoice ${doc.number} dated ${values.date} for ${total}${doc.due_date ? `, due on ${values.due_date}` : ""}.${Number(doc.outstanding_amount ?? 0) > 0 && Number(doc.outstanding_amount) < Number(doc.total) ? ` Balance due: ${values.balance}.` : ""}`,
    credit_note: `please find our credit note ${doc.number} dated ${values.date} for ${total}.`,
    debit_note: `please find our debit note ${doc.number} dated ${values.date} for ${total}.`,
    receipt: `thank you for your payment of ${total} received on ${values.date} (receipt ${doc.number})${doc.bills ? ` against ${doc.bills}` : ""}.`,
    reminder: Number(doc.overdue ?? 0) > 0
      ? `a gentle reminder that ${values.overdue} is overdue${doc.bills ? ` on ${doc.bills}` : ""}, the oldest since ${values.oldest_due}. In all ${total} is outstanding. Please arrange the payment.`
      : `your account shows ${total} outstanding. Please arrange the payment by the due dates.`,
  }[kind];
  const attached = ["reminder", "receipt"].includes(kind) ? "" : " The PDF follows.";
  return { values, text: `Dear ${name},\n\n${line[0].toUpperCase()}${line.slice(1)}${attached}\n\nRegards,\n${company}` };
}

// input: { kind, id, phone? (else the contact's mobile, else the customer's phone), body? (the message as edited), idempotencyKey? }
// id is the document's; for a reminder, the customer's. Returns { phone, body, link } — the wa.me link opens WhatsApp with the message —
// and records it as sent on WhatsApp (a proforma is not a document of its own and is not marked; a reminder is kept on the customer).
export async function sendDocumentOnWhatsApp(client, context, input = {}) {
  const kind = String(input.kind ?? "");
  if (!KINDS.includes(kind)) throw new SalesError(400, "Choose a quotation, proforma, order, invoice, credit or debit note, receipt or reminder.", "SALES_WHATSAPP_INVALID");
  if (!UUID.test(String(input.id ?? ""))) throw new SalesError(404, "Document not found.", "SALES_WHATSAPP_NOT_FOUND");
  // A proforma is the quotation's: whoever sends quotations sends it (the other documents' own "mark as sent" checks their permission).
  if (kind === "proforma" && !can(context, "sales.quotation.send"))
    throw new SalesError(403, "You do not have permission to send quotations.", "PERMISSION_DENIED");
  if (kind === "reminder" && !can(context, "sales.customers.view_financials"))
    throw new SalesError(403, "You do not have permission to see customer balances.", "PERMISSION_DENIED");
  if (kind === "receipt" && !can(context, "sales.invoice.payments.view") && !can(context, "sales.invoice.record_payment"))
    throw new SalesError(403, "You do not have permission to see payments.", "PERMISSION_DENIED");
  if (kind === "debit_note" && !can(context, "sales.credit_note.send"))
    throw new SalesError(403, "You do not have permission to send debit notes.", "PERMISSION_DENIED");
  // A reminder goes only to a customer the person may see.
  if (kind === "reminder") await loadCustomerRow(client, context, input.id);
  const doc = await documentOf(client, context.organizationId, kind, input.id);
  if (!doc) throw new SalesError(404, "Document not found.", "SALES_WHATSAPP_NOT_FOUND");
  if (kind === "reminder" && !(Number(doc.total) > 0)) throw new SalesError(409, "This customer owes nothing.", "SALES_WHATSAPP_NOTHING_DUE");
  const party = (await client.query("SELECT phone FROM tenant.business_parties WHERE organization_id = $1 AND id = $2", [context.organizationId, doc.party_id])).rows[0];
  const phone = waNumber(input.phone || doc.contact_snapshot?.mobile || doc.contact_snapshot?.phone || party?.phone);
  if (phone.length < 10) throw new SalesError(400, "Enter the customer's WhatsApp number: the document's contact has no mobile.", "SALES_WHATSAPP_NO_PHONE", { field: "phone" });
  if (await optOutOf(client, context.organizationId, { phone }, "whatsapp"))
    throw new SalesError(409, "This number is on the opt-out list for WhatsApp.", "SALES_WHATSAPP_OPTED_OUT");
  const company = (await client.query("SELECT COALESCE(legal_name, name) AS name FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0]?.name ?? "";
  const built = messageOf(kind, doc, company);
  const templated = TEMPLATE_OF[kind] ? await messageFromTemplate(client, context.organizationId, TEMPLATE_OF[kind], "whatsapp", built.values, built.text) : built.text;
  let body = String(input.body ?? "").trim().slice(0, 4000) || templated;
  // The customer's link (accept the quotation, pay the invoice online), when the person may share it and the message was not written by hand.
  if (!input.body && ["quotation", "invoice"].includes(kind)) {
    await client.query("SAVEPOINT whatsapp_link");
    try {
      const { url } = await shareDocumentLink(client, context, kind, input.id);
      if (url.startsWith("http")) body = body.includes("\n\nRegards,")
        ? body.replace("\n\nRegards,", `\n\n${kind === "quotation" ? "View and accept it online" : "View and pay it online"}: ${url}\n\nRegards,`)
        : `${body}\n\n${kind === "quotation" ? "View and accept it online" : "View and pay it online"}: ${url}`;
      await client.query("RELEASE SAVEPOINT whatsapp_link");
    } catch {
      await client.query("ROLLBACK TO SAVEPOINT whatsapp_link");
    }
  }
  const recipient = `WhatsApp +${phone}`;
  const key = input.idempotencyKey ? String(input.idempotencyKey).slice(0, 180) : undefined;
  if (kind === "quotation") await markQuotationSent(client, context, input.id, { channel: "whatsapp", recipient });
  if (kind === "order") await markOrderConfirmationSent(client, context, input.id, { channel: "whatsapp", recipient, idempotencyKey: key });
  if (kind === "invoice") await markSalesInvoiceSent(client, context, input.id, { channel: "whatsapp", recipient, idempotencyKey: key });
  if (kind === "credit_note") await markCreditNoteSent(client, context, input.id, { channel: "whatsapp", recipient, idempotencyKey: key });
  if (kind === "debit_note")
    await client.query("UPDATE tenant.sales_debit_notes SET sent_at = clock_timestamp(), sent_channel = 'whatsapp', updated_at = clock_timestamp() WHERE organization_id = $1 AND customer_invoice_id = $2",
      [context.organizationId, input.id]);
  if (kind === "reminder")
    await client.query(
      `INSERT INTO tenant.sales_collection_notes (organization_id, party_id, kind, channel, amount_due, note, created_by) VALUES ($1, $2, 'reminder', 'whatsapp', $3, $4, $5)`,
      [context.organizationId, doc.party_id, Number(doc.total), `Reminder to ${recipient}`, context.userId ?? null]);
  return { phone: `+${phone}`, body, link: `https://wa.me/${phone}?text=${encodeURIComponent(body)}` };
}
