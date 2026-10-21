// Sending Sales documents on WhatsApp (Sales audit M6): documents travel on WhatsApp in India. "Send on WhatsApp" on a quotation, its
// proforma, an order confirmation, an invoice or a credit note writes the message (number, amount, validity or due date) to the contact's
// mobile, opens WhatsApp with it ready (click-to-chat: the salesperson's own WhatsApp, where they attach the PDF just downloaded), and
// records the document as sent on WhatsApp. It works with or without CRM; a number on the company's opt-out list is never messaged.
import { optOutOf } from "../crm/data-management/consent.js";
import { markSalesInvoiceSent } from "./invoices/communication.js";
import { markCreditNoteSent } from "./credit-notes/communication.js";
import { markOrderConfirmationSent } from "./order-confirmations/communication.js";
import { markQuotationSent } from "./quotations/lifecycle.js";
import { SalesError } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const KINDS = Object.freeze(["quotation", "proforma", "order", "invoice", "credit_note"]);
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
  return one(`SELECT invoice.invoice_number AS number, invoice.invoice_date AS date, invoice.due_date, invoice.party_id, invoice.outstanding_amount, invoice.grand_total AS total,
                     invoice.currency_code, COALESCE(sales.contact_snapshot, note.contact_snapshot) AS contact_snapshot, COALESCE(sales.customer_snapshot, note.customer_snapshot) AS customer_snapshot
                FROM tenant.accounting_customer_invoices invoice
                LEFT JOIN tenant.sales_invoices sales ON sales.organization_id = invoice.organization_id AND sales.customer_invoice_id = invoice.id
                LEFT JOIN tenant.sales_credit_notes note ON note.organization_id = invoice.organization_id AND note.customer_invoice_id = invoice.id
               WHERE invoice.organization_id = $1 AND invoice.id = $2 AND invoice.invoice_type = '${kind === "invoice" ? "invoice" : "credit_note"}'`);
}

function messageOf(kind, doc, company) {
  const contact = doc.contact_snapshot ?? {};
  const name = [contact.first_name, contact.last_name].filter(Boolean).join(" ") || doc.customer_snapshot?.displayName || "Sir/Madam";
  const total = amount(doc.currency_code, doc.total);
  const line = {
    quotation: `please find our quotation ${doc.number} dated ${day(doc.date)} for ${total}${doc.valid_until ? `, valid until ${day(doc.valid_until)}` : ""}.`,
    proforma: `please find our proforma invoice against quotation ${doc.number} for ${total}${doc.valid_until ? `, valid until ${day(doc.valid_until)}` : ""}.`,
    order: `thank you for your order${doc.customer_po_number ? ` ${doc.customer_po_number}` : ""}. Please find our order confirmation ${doc.number} for ${total}.`,
    invoice: `please find our invoice ${doc.number} dated ${day(doc.date)} for ${total}${doc.due_date ? `, due on ${day(doc.due_date)}` : ""}.${Number(doc.outstanding_amount ?? 0) > 0 && Number(doc.outstanding_amount) < Number(doc.total) ? ` Balance due: ${amount(doc.currency_code, doc.outstanding_amount)}.` : ""}`,
    credit_note: `please find our credit note ${doc.number} dated ${day(doc.date)} for ${total}.`,
  }[kind];
  return `Dear ${name},\n\n${line[0].toUpperCase()}${line.slice(1)} The PDF follows.\n\nRegards,\n${company}`;
}

// input: { kind, id, phone? (else the contact's mobile, else the customer's phone), body? (the message as edited), idempotencyKey? }
// Returns { phone, body, link } — the wa.me link opens WhatsApp with the message — and records the document as sent on WhatsApp
// (a proforma is not a document of its own and is not marked).
export async function sendDocumentOnWhatsApp(client, context, input = {}) {
  const kind = String(input.kind ?? "");
  if (!KINDS.includes(kind)) throw new SalesError(400, "Choose a quotation, proforma, order, invoice or credit note.", "SALES_WHATSAPP_INVALID");
  if (!UUID.test(String(input.id ?? ""))) throw new SalesError(404, "Document not found.", "SALES_WHATSAPP_NOT_FOUND");
  // A proforma is the quotation's: whoever sends quotations sends it (the other documents' own "mark as sent" checks their permission).
  if (kind === "proforma" && !(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes("sales.quotation.send")))
    throw new SalesError(403, "You do not have permission to send quotations.", "PERMISSION_DENIED");
  const doc = await documentOf(client, context.organizationId, kind, input.id);
  if (!doc) throw new SalesError(404, "Document not found.", "SALES_WHATSAPP_NOT_FOUND");
  const party = (await client.query("SELECT phone FROM tenant.business_parties WHERE organization_id = $1 AND id = $2", [context.organizationId, doc.party_id])).rows[0];
  const phone = waNumber(input.phone || doc.contact_snapshot?.mobile || doc.contact_snapshot?.phone || party?.phone);
  if (phone.length < 10) throw new SalesError(400, "Enter the customer's WhatsApp number: the document's contact has no mobile.", "SALES_WHATSAPP_NO_PHONE", { field: "phone" });
  if (await optOutOf(client, context.organizationId, { phone }, "whatsapp"))
    throw new SalesError(409, "This number is on the opt-out list for WhatsApp.", "SALES_WHATSAPP_OPTED_OUT");
  const company = (await client.query("SELECT COALESCE(legal_name, name) AS name FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0]?.name ?? "";
  const body = String(input.body ?? "").trim().slice(0, 4000) || messageOf(kind, doc, company);
  const recipient = `WhatsApp +${phone}`;
  const key = input.idempotencyKey ? String(input.idempotencyKey).slice(0, 180) : undefined;
  if (kind === "quotation") await markQuotationSent(client, context, input.id, { channel: "whatsapp", recipient });
  if (kind === "order") await markOrderConfirmationSent(client, context, input.id, { channel: "whatsapp", recipient, idempotencyKey: key });
  if (kind === "invoice") await markSalesInvoiceSent(client, context, input.id, { channel: "whatsapp", recipient, idempotencyKey: key });
  if (kind === "credit_note") await markCreditNoteSent(client, context, input.id, { channel: "whatsapp", recipient, idempotencyKey: key });
  return { phone: `+${phone}`, body, link: `https://wa.me/${phone}?text=${encodeURIComponent(body)}` };
}
