// The customer's link to a quotation or invoice (Sales audit, should-have: customer portal). Staff share a link (by WhatsApp, email or
// anywhere); the customer opens it without signing in to read the document, download its PDF, accept a quotation — giving their name,
// recorded on the quotation's history as accepted online — or pay an invoice by UPI. The token is the only credential: 24 random bytes,
// kept hashed for lookup and encrypted so the same link is given every time; revoking it ends it.
import { createHash, randomBytes } from "node:crypto";
import { setTenantContext } from "@vercentlabs/database";

import { prepareFileUpload, storeFile } from "../../core/platform/files/service.js";
import { notifyRecordOwner } from "../../core/platform/notifications/index.js";
import { decryptSecret, encryptSecret } from "../../core/platform/secrets/index.js";
import { recordQuotationDecision } from "./quotations/lifecycle.js";
import { createSalesOrderFromQuotation } from "./quotations/order.js";
import { recordQuotationEvent } from "./quotations/versions.js";
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
  permissions: ["sales.view", "sales.quotation.view", "sales.quotation.view_all", "sales.quotation.accept_on_behalf", "sales.quotation.reject", "sales.invoice.view", "sales.invoice.view_all",
    "sales.quotation.export", "sales.invoice.print"] });

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
  if (!document) throw new SalesError(404, kind === "invoice" ? "Finalise the invoice before sharing it." : "Quotation not found.", "SALES_LINK_NOT_FOUND");
  return { url: await linkUrl(client, c.organizationId, kind, documentId, c.userId ?? null, env), documentNumber: document.number };
}

// The document's shared link for the customer portal (Sales report Phase 3): the active one, or a new one.
export const linkUrlFor = (client, organizationId, kind, documentId, env = process.env) => linkUrl(client, organizationId, kind, documentId, null, env);

// The document's link: the active one, or a new one.
async function linkUrl(client, organizationId, kind, documentId, userId, env) {
  const existing = (await client.query(
    "SELECT token_encrypted FROM tenant.sales_document_links WHERE organization_id = $1 AND document_type = $2 AND document_id = $3 AND revoked_at IS NULL", [organizationId, kind, documentId])).rows[0];
  let token = existing ? (await decryptSecret(existing.token_encrypted, env))?.token : null;
  if (!token) {
    token = randomBytes(24).toString("hex");
    await client.query(
      `INSERT INTO tenant.sales_document_links (organization_id, document_type, document_id, token_hash, token_encrypted, created_by) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
      [organizationId, kind, documentId, hash(token), JSON.stringify(await encryptSecret({ token }, env)), userId]);
  }
  return `${String(env.APP_URL ?? "").replace(/\/+$/, "")}/d/${token}`;
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
export async function loadSharedDocument(client, token, env = process.env) {
  const shared = await resolveSharedDocument(client, token);
  if (!shared) return null;
  const { organizationId, kind, documentId } = shared;
  await client.query("UPDATE tenant.sales_document_links SET view_count = view_count + 1, last_viewed_at = now() WHERE token_hash = $1", [hash(token)]);
  const company = (await client.query("SELECT COALESCE(NULLIF(legal_name, ''), name) AS name, upi_id FROM public.organizations WHERE id = $1", [organizationId])).rows[0] ?? {};
  if (kind === "quotation") {
    const quote = (await client.query(
      `SELECT quote.quotation_number, quote.quotation_date, quote.valid_until, quote.lifecycle_status, quote.converted_order_id, quote.customer_viewed_at, quote.owner_user_id,
              quote.created_by, version.customer_snapshot, version.currency_code, version.optional_lines,
              version.subtotal, version.discount_total, version.tax_total, version.grand_total, version.terms_and_conditions, version.customer_notes, version.id AS version_id
         FROM tenant.sales_quotations quote JOIN tenant.sales_quotation_versions version ON version.id = quote.current_version_id
        WHERE quote.organization_id = $1 AND quote.id = $2`, [organizationId, documentId])).rows[0];
    if (!quote) return null;
    const lines = (await client.query(
      `SELECT COALESCE(description_snapshot, item_name_snapshot) AS description, quantity, uom_snapshot, unit_price, tax_amount, line_total, tax_rate
         FROM tenant.sales_quotation_lines WHERE organization_id = $1 AND quotation_version_id = $2 ORDER BY sequence`, [organizationId, quote.version_id])).rows;
    const today = (await client.query("SELECT tenant.company_today()::text AS today")).rows[0].today;
    const expired = Boolean(quote.valid_until) && day(quote.valid_until) < today;
    if (!quote.customer_viewed_at && ["approved", "sent"].includes(quote.lifecycle_status)) await markViewed(client, shared, quote);
    const newer = quote.lifecycle_status === "withdrawn" ? await newerVersion(client, organizationId, documentId, env) : null;
    return {
      kind, company: company.name, number: quote.quotation_number, date: day(quote.quotation_date), validUntil: day(quote.valid_until), currencyCode: String(quote.currency_code).trim(),
      customer: quote.customer_snapshot?.displayName ?? null, status: quote.lifecycle_status, totals: { subtotal: Number(quote.subtotal), discount: Number(quote.discount_total),
        tax: Number(quote.tax_total), total: Number(quote.grand_total) }, terms: quote.terms_and_conditions, notes: quote.customer_notes,
      lines: lines.map((line) => ({ description: line.description, quantity: Number(line.quantity), unit: line.uom_snapshot, unitPrice: Number(line.unit_price),
        taxRate: Number(line.tax_rate ?? 0), lineTotal: Number(line.line_total) })),
      canAccept: ["approved", "sent", "viewed"].includes(quote.lifecycle_status) && !expired, accepted: quote.lifecycle_status === "accepted", expired,
      declined: quote.lifecycle_status === "rejected",
      newerVersion: newer,
      // Optional products the customer may add when accepting (Sales report Phase 3).
      optionalLines: (quote.optional_lines ?? []).map((line, index) => ({ index, description: line.description || line.name, quantity: Number(line.quantity), unit: line.unit,
        unitPrice: Number(line.unitPrice), taxRate: Number(line.taxRate ?? 0), lineTotal: Number(line.lineTotal) })),
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
    // Pay now through the company's own Razorpay account (Sales report Phase 3).
    payOnline: payable && currency === "INR" && Boolean((await client.query("SELECT 1 FROM tenant.sales_payment_gateways WHERE organization_id = $1 AND status = 'active'",
      [organizationId])).rows[0]),
  };
}

// The customer's first look at a quotation (Sales report H6): kept on the quotation and its history, and the salesperson is told once.
async function markViewed(client, shared, quote) {
  const updated = await client.query(
    "UPDATE tenant.sales_quotations SET customer_viewed_at = now() WHERE organization_id = $1 AND id = $2 AND customer_viewed_at IS NULL", [shared.organizationId, shared.documentId]);
  if (!updated.rowCount) return;
  await recordQuotationEvent(client, shared.context, shared.documentId, "quotation.viewed", quote.lifecycle_status, quote.lifecycle_status, { online: true });
  await notifyRecordOwner(client, shared.context, { userId: quote.owner_user_id ?? quote.created_by, category: "sales_document",
    title: `Quotation ${quote.quotation_number} was opened`, message: `${quote.customer_snapshot?.displayName ?? "The customer"} opened the quotation's link.`,
    href: `/sales/quotations/${shared.documentId}`, entityType: "sales_quotation", entityId: shared.documentId });
}

// An old version's link points to the revision that replaced it (Sales report H10): the latest one sent, with its own link.
async function newerVersion(client, organizationId, quotationId, env) {
  let current = quotationId;
  let latest = null;
  for (let depth = 0; depth < 20; depth += 1) {
    const next = (await client.query(
      `SELECT id, quotation_number FROM tenant.sales_quotations WHERE organization_id = $1 AND revision_of_quotation_id = $2 AND sent_at IS NOT NULL
        ORDER BY created_at DESC LIMIT 1`, [organizationId, current])).rows[0];
    if (!next) break;
    latest = next;
    current = next.id;
  }
  if (!latest) return null;
  return { number: latest.quotation_number, url: await linkUrl(client, organizationId, "quotation", latest.id, null, env) };
}

// The signature the customer drew: a PNG data URL, kept as a file on the quotation.
const SIGNATURE = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;
async function storeSignature(client, shared, name, signature, env) {
  const match = SIGNATURE.exec(String(signature ?? ""));
  if (!match) throw new SalesError(400, "Sign in the box to accept.", "SALES_LINK_SIGNATURE_REQUIRED", { field: "signature" });
  const bytes = Buffer.from(match[1], "base64");
  if (bytes.length < 200 || bytes.length > 512 * 1024) throw new SalesError(400, "Sign in the box to accept.", "SALES_LINK_SIGNATURE_REQUIRED", { field: "signature" });
  const prepared = await prepareFileUpload({ fileName: `Signature - ${name.replace(/[^\w .-]+/g, "").slice(0, 60) || "customer"}.png`, mimeType: "image/png", bytes,
    maximumBytes: 512 * 1024, allowedTypes: ["image/png"] }, env);
  const file = await storeFile(client, { organizationId: shared.organizationId, entityType: "sales.quotation", entityId: shared.documentId, prepared, uploadedBy: null }, { env });
  await client.query("UPDATE tenant.sales_quotations SET signature_file_id = $3, signed_by_name = $4 WHERE organization_id = $1 AND id = $2",
    [shared.organizationId, shared.documentId, file.id, name]);
  return file.id;
}

// A finalised quotation the customer answers from the link counts as sent by link.
async function sentByLink(client, shared) {
  const status = (await client.query("SELECT lifecycle_status FROM tenant.sales_quotations WHERE organization_id = $1 AND id = $2", [shared.organizationId, shared.documentId])).rows[0]?.lifecycle_status;
  if (status === "approved")
    await client.query("UPDATE tenant.sales_quotations SET lifecycle_status = 'sent', acceptance_status = 'pending', sent_at = COALESCE(sent_at, now()), sent_channel = COALESCE(sent_channel, 'link') WHERE organization_id = $1 AND id = $2",
      [shared.organizationId, shared.documentId]);
}

const nameOf = (input, verb) => {
  const name = String(input.name ?? "").trim().slice(0, 200);
  if (name.length < 2) throw new SalesError(400, `Enter your name to ${verb}.`, "SALES_LINK_NAME_REQUIRED", { field: "name" });
  return name;
};

// The customer declines from the link (Sales report Phase 2): recorded as rejected, with their reason.
export async function declineSharedQuotation(client, token, input = {}) {
  const shared = await resolveSharedDocument(client, token);
  if (!shared || shared.kind !== "quotation") return null;
  const name = nameOf(input, "decline");
  const reason = String(input.reason ?? "").trim().slice(0, 2000);
  if (reason.length < 3) throw new SalesError(400, "Tell us why, so we can do better.", "SALES_LINK_REASON_REQUIRED", { field: "reason" });
  await sentByLink(client, shared);
  await recordQuotationDecision(client, shared.context, shared.documentId, { decision: "rejected", customerName: name, reference: "Declined online through the shared link", notes: reason });
  return { declined: true };
}

// The customer asks for changes (Sales report Phase 2): kept on the quotation's history and the salesperson is told. Nothing else changes.
export async function requestQuotationChanges(client, token, input = {}) {
  const shared = await resolveSharedDocument(client, token);
  if (!shared || shared.kind !== "quotation") return null;
  const name = nameOf(input, "send your request");
  const note = String(input.note ?? "").trim().slice(0, 2000);
  if (note.length < 3) throw new SalesError(400, "Say what you would like changed.", "SALES_LINK_NOTE_REQUIRED", { field: "note" });
  const quote = (await client.query("SELECT quotation_number, lifecycle_status, owner_user_id, created_by FROM tenant.sales_quotations WHERE organization_id = $1 AND id = $2",
    [shared.organizationId, shared.documentId])).rows[0];
  if (!["approved", "sent"].includes(quote?.lifecycle_status)) throw new SalesError(409, "This quotation can no longer be changed.", "SALES_LINK_CLOSED");
  await recordQuotationEvent(client, shared.context, shared.documentId, "quotation.changes_requested", quote.lifecycle_status, quote.lifecycle_status, { customerName: name, note });
  await notifyRecordOwner(client, shared.context, { userId: quote.owner_user_id ?? quote.created_by, category: "sales_document",
    title: `Changes asked on ${quote.quotation_number}`, message: `${name}: ${note.slice(0, 300)}`, href: `/sales/quotations/${shared.documentId}`,
    entityType: "sales_quotation", entityId: shared.documentId });
  return { requested: true };
}

// The customer accepts the quotation from the link: their name, their drawn signature and an optional note, recorded as accepted online.
export async function acceptSharedQuotation(client, token, input = {}, env = process.env) {
  const shared = await resolveSharedDocument(client, token);
  if (!shared || shared.kind !== "quotation") return null;
  const name = nameOf(input, "accept");
  const note = String(input.note ?? "").trim().slice(0, 2000);
  await sentByLink(client, shared);
  await storeSignature(client, shared, name, input.signature, env);
  // The optional products ticked (indexes into the quotation's extras): the order made from it includes them.
  const offered = (await client.query(
    "SELECT jsonb_array_length(version.optional_lines) AS n FROM tenant.sales_quotations quote JOIN tenant.sales_quotation_versions version ON version.id = quote.current_version_id WHERE quote.organization_id = $1 AND quote.id = $2",
    [shared.organizationId, shared.documentId])).rows[0]?.n ?? 0;
  const chosen = [...new Set((Array.isArray(input.optionalChosen) ? input.optionalChosen : []).map(Number).filter((index) => Number.isInteger(index) && index >= 0 && index < offered))];
  if (chosen.length)
    await client.query("UPDATE tenant.sales_quotations SET optional_chosen = $3::jsonb WHERE organization_id = $1 AND id = $2", [shared.organizationId, shared.documentId, JSON.stringify(chosen)]);
  await recordQuotationDecision(client, shared.context, shared.documentId, { decision: "accepted", customerName: name, reference: "Accepted and signed online through the shared link",
    notes: [note, chosen.length ? `Added ${chosen.length} optional ${chosen.length === 1 ? "product" : "products"}.` : null].filter(Boolean).join(" ") || undefined });
  const order = await orderOnAcceptance(client, shared);
  return { accepted: true, ...(order ? { orderNumber: order.orderNumber } : {}) };
}

// With "Create the order when the customer accepts online" on (Sales report H5), the order is made as from the quotation's page. If it
// cannot be (a closed customer, say), the acceptance stands and the salesperson is told to make it.
async function orderOnAcceptance(client, shared) {
  const on = (await client.query("SELECT order_on_online_acceptance FROM tenant.sales_settings WHERE organization_id = $1", [shared.organizationId])).rows[0]?.order_on_online_acceptance;
  if (!on) return null;
  const context = { ...shared.context, permissions: [...shared.context.permissions, "sales.order.create"] };
  const quote = (await client.query("SELECT quotation_number, owner_user_id, created_by FROM tenant.sales_quotations WHERE organization_id = $1 AND id = $2",
    [shared.organizationId, shared.documentId])).rows[0];
  await client.query("SAVEPOINT order_on_acceptance");
  try {
    const order = await createSalesOrderFromQuotation(client, context, shared.documentId, {});
    await client.query("RELEASE SAVEPOINT order_on_acceptance");
    await notifyRecordOwner(client, context, { userId: quote.owner_user_id ?? quote.created_by, category: "sales_document",
      title: `Order ${order.orderNumber} made from ${quote.quotation_number}`, message: "The customer accepted online, so the sales order was made as a draft. Check and confirm it.",
      href: `/sales/orders/${order.orderId}`, entityType: "sales_order", entityId: order.orderId });
    return order;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT order_on_acceptance");
    if (!error?.status || error.status >= 500) throw error;
    await notifyRecordOwner(client, context, { userId: quote.owner_user_id ?? quote.created_by, category: "sales_document",
      title: `Make the order for ${quote.quotation_number}`, message: `The customer accepted online, but the order could not be made: ${String(error.message).slice(0, 300)}`,
      href: `/sales/quotations/${shared.documentId}`, entityType: "sales_quotation", entityId: shared.documentId });
    return null;
  }
}

// The PDF behind a link, rendered as staff would print it.
export async function renderSharedDocumentPdf(client, token) {
  const shared = await resolveSharedDocument(client, token);
  if (!shared) return null;
  const { renderAuthorizedDocument } = await import("../../orchestration/documents/registry.js");
  return renderAuthorizedDocument(client, shared.context, shared.kind === "quotation" ? "sales.quotation" : "sales.invoice", shared.documentId);
}
