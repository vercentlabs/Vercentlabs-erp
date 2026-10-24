// Export invoices (Sales report Phase 3): the shipping bill and port code of an export invoice — known after the goods are cleared, so
// entered also once the invoice is final — and the LUT (Letter of Undertaking) the company's GSTIN exports under without IGST. Both are
// printed on the invoice and go to GSTR-1 table 6A.
import { InvoiceError } from "./constants.js";
import { loadInvoice, requireInvoicePermission } from "./access.js";
import { INVOICE_PERMISSIONS } from "./constants.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const text = (value, max) => String(value ?? "").trim().slice(0, max);

// input: { shippingBillNumber?, shippingBillDate?, portCode? } — empty values clear them.
export async function setInvoiceExportDetails(client, context, invoiceId, input = {}) {
  requireInvoicePermission(context, INVOICE_PERMISSIONS.post, "You do not have permission to change export details.");
  const invoice = await loadInvoice(client, context, invoiceId, { lock: true });
  if (!["export", "sez"].includes(invoice.supply_type)) throw new InvoiceError(409, "Only an export or SEZ invoice has shipping details.", "SALES_INVOICE_NOT_EXPORT");
  const number = text(input.shippingBillNumber, 20) || null;
  const date = text(input.shippingBillDate, 10) || null;
  const port = text(input.portCode, 6).toUpperCase() || null;
  if (number && !/^\d{3,7}$/.test(number)) throw new InvoiceError(400, "A shipping bill number has 3 to 7 digits.", "SALES_INVOICE_VALIDATION", { field: "shippingBillNumber" });
  if (date && !DATE.test(date)) throw new InvoiceError(400, "Enter the shipping bill date.", "SALES_INVOICE_VALIDATION", { field: "shippingBillDate" });
  if (port && !/^[A-Z0-9]{6}$/.test(port)) throw new InvoiceError(400, "A port code has 6 letters or digits (for example INNSA1).", "SALES_INVOICE_VALIDATION", { field: "portCode" });
  await client.query("UPDATE tenant.sales_invoices SET shipping_bill_number = $3, shipping_bill_date = $4, port_code = $5, updated_at = now() WHERE organization_id = $1 AND customer_invoice_id = $2",
    [context.organizationId, invoice.id, number, date, port]);
  return { shippingBillNumber: number, shippingBillDate: date, portCode: port };
}

// input: { lutNumber, lutDate } — empty clears it.
export async function setRegistrationLut(client, context, registrationId, input = {}) {
  if (!context.roleSlugs?.includes("organization_owner") && !context.permissions?.includes("tax.registrations.manage") && !context.permissions?.includes("sales.settings.manage"))
    throw new InvoiceError(403, "You do not have permission to change the GSTIN's LUT.", "PERMISSION_DENIED");
  const number = text(input.lutNumber, 40) || null;
  const date = text(input.lutDate, 10) || null;
  if (number && (!date || !DATE.test(date))) throw new InvoiceError(400, "Enter the date of the LUT.", "SALES_INVOICE_VALIDATION", { field: "lutDate" });
  const updated = await client.query("UPDATE tenant.tax_registrations SET lut_number = $3, lut_date = $4 WHERE organization_id = $1 AND id = $2 RETURNING id",
    [context.organizationId, UUID.test(String(registrationId ?? "")) ? registrationId : null, number, number ? date : null]);
  if (!updated.rows[0]) throw new InvoiceError(404, "GSTIN not found.", "SALES_REGISTRATION_NOT_FOUND");
  return { lutNumber: number, lutDate: number ? date : null };
}
