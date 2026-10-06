// What the Return Note prints: the return as recorded (customer, order,
// delivery, invoices that billed the goods, date, warehouse, reason, each
// line's quantity and condition) and the customer notes. Never prices,
// never internal notes.
import { requireReturnPermission } from "./access.js";
import { RETURN_PERMISSIONS, RETURN_STATUS, ReturnError } from "./constants.js";
import { getSalesReturn } from "./records.js";

export async function getReturnNote(client, context, returnId) {
  requireReturnPermission(context, RETURN_PERMISSIONS.print, "You do not have permission to print return notes.");
  const detail = await getSalesReturn(client, context, returnId);
  if (detail.salesReturn.status === RETURN_STATUS.cancelled) throw new ReturnError(409, "A cancelled return has no return note.", "SALES_RETURN_CANCELLED");
  const company = (await client.query(`SELECT name, legal_name, tax_id FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0] ?? {};
  return { ...detail, company: { name: company.legal_name || company.name || null, taxId: company.tax_id ?? null } };
}
