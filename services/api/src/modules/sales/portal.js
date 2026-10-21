// The customer's link to a quotation or invoice (Sales audit, should-have: customer portal). Staff share a link (by WhatsApp, email or
// anywhere); the customer opens it without signing in to read the document, download its PDF, accept a quotation — giving their name,
// recorded on the quotation's history as accepted online — or pay an invoice by UPI. The token is the only credential: 24 random bytes,
// kept hashed for lookup and encrypted so the same link is given every time; revoking it ends it.
import { createHash, randomBytes } from "node:crypto";
import { setTenantContext } from "@vercentlabs/database";

import { decryptSecret, encryptSecret } from "../../core/platform/secrets/index.js";
import { recordQuotationDecision } from "./quotations/lifecycle.js";
import { SalesError } from "./index.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TOKEN = /^[0-9a-f]{48}$/;
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const can = (c, permission) => Boolean(c.roleSlugs?.includes("organization_owner") || c.permissions?.includes(permission));
const day = (value) => (value instanceof Date
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
  : value ? String(value).slice(0, 10) : null);
const SHARE_PERMISSION = { quotation: "sales.quotation.send", invoice: "sales.invoice.send" };
// What the link acts with: the documents it names and nothing else.
const linkContext = (organizationId) => ({ organizationId, userId: null, roleSlugs: [],
  permissions: ["sales.view", "sales.quotation.view", "sales.quotation.view_all", "sales.quotation.accept_on_behalf", "sales.invoice.view", "sales.invoice.view_all", "sales.quotation.export", "sales.invoice.print"] });

async function documentExists(client, organizationId, kind, id) {
  const sql = kind === "quotation"
    ? "SELECT quotation_number AS number FROM tenant.sales_quotations WHERE organization_id = $1 AND id = $2"
    : "SELECT invoice_number AS number FROM tenant.accounting_customer_invoices WHERE organization_id = $1 AND id = $2 AND invoice_type = 'invoice' AND posted_at IS NOT NULL";
  return (await client.query(sql, [organizationId, id])).rows[0] ?? null;
}

// The link for a quotation or a posted invoice: the same one every time until revoked.
export async function shareDocumentLink(client, c, kind, documentId, env = process.env) {
  if (!SHARE_PERMISSION[kind]) throw new SalesError(400, "Share a quotation or an invoice.", "SALES_LINK_INVALID");
  if (!can(c, SHARE_PERMISSION[kind])) throw new SalesError(403, "You do not have permission to share this document.", "PERMISSION_DENIED");
  if (!UUID.test(String(documentId ?? ""))) throw new SalesError(404, "Document not found.", "SALES_LINK_NOT_FOUND");
  const document = await documentExists(client, c.organizationId, kind, documentId);
  if (!document) throw new SalesError(404, kind === "invoice" ? "Post the invoice before sharing it." : "Quotation not found.", "SALES_LINK_NOT_FOUND");
  const existing = (await client.query(
    "SELECT token_encrypted FROM tenant.sales_document_links WHERE organization_id = $1 AND document_type = $2 AND document_id = $3 AND revoked_at IS NULL", [c.organizationId, kind, documentId])).rows[0];
  let token = existing ? (await decryptSecret(existing.token_encrypted, env))?.token : null;
  if (!token) {
    token = randomBytes(24).toString("hex");
    await client.query(
      `INSERT INTO tenant.sales_document_links (organization_id, document_type, document_id, token_hash, token_encrypted, created_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [c.organizationId, kind, documentId, hash(token), JSON.stringify(await encryptSecret({ token }, env)), c.userId ?? null]);
  }
  return { url: `${String(env.APP_URL ?? "").replace(/\/+$/, "")}/d/${token}`, documentNumber: document.number };
}

export async function revokeDocumentLink(client, c, kind, documentId) {
  if (!SHARE_PERMISSION[kind] || !can(c, SHARE_PERMISSION[kind])) throw new SalesError(403, "You do not have permission to share this document.", "PERMISSION_DENIED");
  const result = await client.query("UPDATE tenant.sales_document_links SET revoked_at = now() WHERE organization_id = $1 AND document_type = $2 AND document_id = $3 AND revoked_at IS NULL",
    [c.organizationId, kind, documentId]);
  return { revoked: result.rowCount > 0 };
}

// The document behind a token, with the organization context set; null for an unknown or revoked link, or a company without Sales.
export async function resolveSharedDocument(client, token) {
  if (!TOKEN.test(String(token ?? ""))) return null;
  const found = (await client.query("SELECT * FROM tenant.sales_resolve_document_link($1)", [hash(token)])).rows[0];
  if (!found) return null;
  await setTenantContext(client, found.organization_id);
  const sales = (await client.query("SELECT 1 FROM public.organization_modules WHERE organization_id = $1 AND module_key = 'sales' AND status = 'enabled'", [found.organization_id])).rows[0];
  if (!sales) return null;
  return { organizationId: found.organization_id, kind: found.document_type, documentId: found.document_id, context: linkContext(found.organization_id) };
}

// What the customer sees: the company, the document's figures and lines, and what they can do (accept; pay by UPI).
export async function loadSharedDocument(client, token) {
  const shared = await resolveSharedDocument(client, token);
  if (!shared) return null;
  const { organizationId, kind, documentId } = shared;
  await client.query("UPDATE tenant.sales_document_links SET view_count = view_count + 1, last_viewed_at = now() WHERE token_hash = $1", [hash(token)]);
  const company = (await client.query("SELECT COALESCE(NULLIF(legal_name, ''), name) AS name, upi_id FROM public.organizations WHERE id = $1", [organizationId])).rows[0] ?? {};
  if (kind === "quotation") {
    const quote = (await client.query(
      `SELECT quote.quotation_number, quote.quotation_date, quote.valid_until, quote.lifecycle_status, quote.converted_order_id, version.customer_snapshot, version.currency_code,
              version.subtotal, version.discount_total, version.tax_total, version.grand_total, version.terms_and_conditions, version.customer_notes, version.id AS version_id
         FROM tenant.sales_quotations quote JOIN tenant.sales_quotation_versions version ON version.id = quote.current_version_id
        WHERE quote.organization_id = $1 AND quote.id = $2`, [organizationId, documentId])).rows[0];
    if (!quote) return null;
    const lines = (await client.query(
      `SELECT COALESCE(description_snapshot, item_name_snapshot) AS description, quantity, uom_snapshot, unit_price, tax_amount, line_total, tax_rate
         FROM tenant.sales_quotation_lines WHERE organization_id = $1 AND quotation_version_id = $2 ORDER BY sequence`, [organizationId, quote.version_id])).rows;
    const today = (await client.query("SELECT tenant.company_today()::text AS today")).rows[0].today;
    const expired = Boolean(quote.valid_until) && day(quote.valid_until) < today;
    return {
      kind, company: company.name, number: quote.quotation_number, date: day(quote.quotation_date), validUntil: day(quote.valid_until), currencyCode: String(quote.currency_code).trim(),
      customer: quote.customer_snapshot?.displayName ?? null, status: quote.lifecycle_status, totals: { subtotal: Number(quote.subtotal), discount: Number(quote.discount_total),
        tax: Number(quote.tax_total), total: Number(quote.grand_total) }, terms: quote.terms_and_conditions, notes: quote.customer_notes,
      lines: lines.map((line) => ({ description: line.description, quantity: Number(line.quantity), unit: line.uom_snapshot, unitPrice: Number(line.unit_price),
        taxRate: Number(line.tax_rate ?? 0), lineTotal: Number(line.line_total) })),
      canAccept: ["approved", "sent", "viewed"].includes(quote.lifecycle_status) && !expired, accepted: quote.lifecycle_status === "accepted", expired,
    };
  }
  const invoice = (await client.query(
    `SELECT invoice.invoice_number, invoice.invoice_date, invoice.due_date, invoice.currency_code, invoice.subtotal, invoice.discount_total, invoice.tax_total, invoice.grand_total,
            invoice.outstanding_amount, invoice.status, invoice.customer_snapshot, sales.customer_snapshot AS sales_customer
       FROM tenant.accounting_customer_invoices invoice LEFT JOIN tenant.sales_invoices sales ON sales.customer_invoice_id = invoice.id
      WHERE invoice.organization_id = $1 AND invoice.id = $2`, [organizationId, documentId])).rows[0];
  if (!invoice) return null;
  const lines = (await client.query(
    `SELECT line.description, line.quantity, sales_line.uom_snapshot, line.unit_price, line.line_total, sales_line.tax_rate
       FROM tenant.accounting_customer_invoice_lines line LEFT JOIN tenant.sales_invoice_lines sales_line ON sales_line.customer_invoice_line_id = line.id
      WHERE line.organization_id = $1 AND line.customer_invoice_id = $2 ORDER BY line.sequence`, [organizationId, documentId])).rows;
  const due = Number(invoice.outstanding_amount);
  const currency = String(invoice.currency_code).trim();
  const payable = due > 0.005 && !["cancelled", "reversed"].includes(invoice.status);
  return {
    kind, company: company.name, number: invoice.invoice_number, date: day(invoice.invoice_date), dueDate: day(invoice.due_date), currencyCode: currency,
    customer: (invoice.sales_customer ?? invoice.customer_snapshot)?.displayName ?? null, status: invoice.status,
    totals: { subtotal: Number(invoice.subtotal), discount: Number(invoice.discount_total), tax: Number(invoice.tax_total), total: Number(invoice.grand_total), due },
    lines: lines.map((line) => ({ description: line.description, quantity: Number(line.quantity), unit: line.uom_snapshot, unitPrice: Number(line.unit_price),
      taxRate: Number(line.tax_rate ?? 0), lineTotal: Number(line.line_total) })),
    // UPI: the company's UPI ID, the amount due and the invoice number as the note (any UPI app opens it).
    upiLink: payable && company.upi_id && currency === "INR"
      ? `upi://pay?pa=${encodeURIComponent(company.upi_id)}&pn=${encodeURIComponent(company.name ?? "")}&am=${due.toFixed(2)}&cu=INR&tn=${encodeURIComponent(invoice.invoice_number)}` : null,
    paid: !payable && invoice.status !== "cancelled",
  };
}

// The customer accepts the quotation from the link: their name (and an optional note) is recorded as the acceptance, made online.
export async function acceptSharedQuotation(client, token, input = {}) {
  const shared = await resolveSharedDocument(client, token);
  if (!shared || shared.kind !== "quotation") return null;
  const name = String(input.name ?? "").trim().slice(0, 200);
  if (name.length < 2) throw new SalesError(400, "Enter your name to accept.", "SALES_LINK_NAME_REQUIRED", { field: "name" });
  const note = String(input.note ?? "").trim().slice(0, 2000);
  const status = (await client.query("SELECT lifecycle_status FROM tenant.sales_quotations WHERE organization_id = $1 AND id = $2", [shared.organizationId, shared.documentId])).rows[0]?.lifecycle_status;
  if (status === "approved") {
    // A finalised quotation the customer opened from the link counts as sent by link.
    await client.query("UPDATE tenant.sales_quotations SET lifecycle_status = 'sent', acceptance_status = 'pending', sent_at = COALESCE(sent_at, now()), sent_channel = COALESCE(sent_channel, 'link') WHERE organization_id = $1 AND id = $2",
      [shared.organizationId, shared.documentId]);
  }
  await recordQuotationDecision(client, shared.context, shared.documentId, { decision: "accepted", customerName: name, reference: "Accepted online through the shared link", notes: note || undefined });
  return { accepted: true };
}

// The PDF behind a link, rendered as staff would print it.
export async function renderSharedDocumentPdf(client, token) {
  const shared = await resolveSharedDocument(client, token);
  if (!shared) return null;
  const { renderAuthorizedDocument } = await import("../../orchestration/documents/registry.js");
  return renderAuthorizedDocument(client, shared.context, shared.kind === "quotation" ? "sales.quotation" : "sales.invoice", shared.documentId);
}
