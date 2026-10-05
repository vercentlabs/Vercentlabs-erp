// What the invoice PDF prints, from the invoice's own snapshots only: the
// seller registration, customer, addresses, place of supply, payment terms,
// lines with HSN/SAC and their tax components, and the totals. Today's
// customer, product, tax rate or terms are never read. Internal notes are
// never printed.
import { requireInvoicePermission } from "./access.js";
import { INVOICE_PERMISSIONS, InvoiceError } from "./constants.js";
import { getSalesInvoice } from "./records.js";

export async function getSalesInvoiceDocument(client, context, invoiceId) {
  requireInvoicePermission(context, INVOICE_PERMISSIONS.print, "You do not have permission to print invoices.");
  const detail = await getSalesInvoice(client, context, invoiceId);
  if (detail.invoice.status === "cancelled") throw new InvoiceError(409, "A cancelled draft has no invoice document.", "SALES_INVOICE_CANCELLED");
  const company = (await client.query(`SELECT name, legal_name, tax_id FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0] ?? {};
  return { ...detail, company: { name: company.legal_name || company.name || null, taxId: company.tax_id ?? null } };
}
