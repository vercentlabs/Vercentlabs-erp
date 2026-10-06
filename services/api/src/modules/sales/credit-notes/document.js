// What the credit note PDF prints, from the credit note's own snapshots only:
// the seller registration, customer, original invoice number and date, the
// reason, the lines with HSN/SAC and their tax components, and the totals.
// Internal notes, and how the credit was applied, are never printed.
import { requireCreditNotePermission } from "./access.js";
import { CREDIT_NOTE_PERMISSIONS, CreditNoteError } from "./constants.js";
import { getCreditNote } from "./records.js";

export async function getCreditNoteDocument(client, context, creditNoteId) {
  requireCreditNotePermission(context, CREDIT_NOTE_PERMISSIONS.print, "You do not have permission to print credit notes.");
  const detail = await getCreditNote(client, context, creditNoteId);
  if (detail.creditNote.status === "cancelled") throw new CreditNoteError(409, "A cancelled draft has no credit note document.", "SALES_CREDIT_NOTE_CANCELLED");
  const company = (await client.query(`SELECT name, legal_name, tax_id FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0] ?? {};
  return { ...detail, company: { name: company.legal_name || company.name || null, taxId: company.tax_id ?? null } };
}
