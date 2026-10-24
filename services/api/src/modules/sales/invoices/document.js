// What the invoice PDF prints, from the invoice's own snapshots only: the
// seller registration, customer, addresses, place of supply, payment terms,
// lines with HSN/SAC and their tax components, and the totals. Today's
// customer, product, tax rate or terms are never read. Internal notes are
// never printed.
import { requireInvoicePermission } from "./access.js";
import { INVOICE_PERMISSIONS, InvoiceError } from "./constants.js";
import { getSalesInvoice } from "./records.js";
import { issuedBatches } from "../deliveries/note.js";

export async function getSalesInvoiceDocument(client, context, invoiceId) {
  requireInvoicePermission(context, INVOICE_PERMISSIONS.print, "You do not have permission to print invoices.");
  const detail = await getSalesInvoice(client, context, invoiceId);
  if (detail.invoice.status === "cancelled") throw new InvoiceError(409, "A cancelled draft has no invoice document.", "SALES_INVOICE_CANCELLED");
  const company = (await client.query(`SELECT name, legal_name, tax_id FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0] ?? {};
  // The batch and expiry of the goods, for lines billed from a dispatch (Sales plan).
  const batches = await issuedBatches(client, context.organizationId, detail.lines.map((line) => line.source_sales_delivery_line_id));
  // An export invoice prints its shipping bill, port and the LUT it is made under (Sales report Phase 3).
  const exportDetails = ["export", "sez"].includes(detail.invoice.supply_type) ? (await client.query(
    `SELECT sales.shipping_bill_number, sales.shipping_bill_date::text AS shipping_bill_date, sales.port_code, registration.lut_number, registration.lut_date::text AS lut_date
       FROM tenant.sales_invoices sales LEFT JOIN tenant.tax_registrations registration ON registration.id = sales.seller_registration_id
      WHERE sales.organization_id = $1 AND sales.customer_invoice_id = $2`, [context.organizationId, invoiceId])).rows[0] ?? null : null;
  return { ...detail, lines: detail.lines.map((line) => ({ ...line, batches: batches.get(line.source_sales_delivery_line_id) ?? [] })),
    company: { name: company.legal_name || company.name || null, taxId: company.tax_id ?? null }, exportDetails };
}
