// What the refund voucher prints: evidence of a payment, never a tax
// document (the credit note is the tax adjustment). The refund number and
// date, the customer, the amount, how and with what reference it was paid,
// the credit it settles and the reason. Internal notes are never printed.
import { REFUND_STATUS, RefundError } from "./constants.js";
import { getCustomerRefund } from "./records.js";

export async function getRefundVoucher(client, context, refundId) {
  const detail = await getCustomerRefund(client, context, refundId);
  if (detail.refund.status === REFUND_STATUS.cancelled) throw new RefundError(409, "A cancelled draft has no refund voucher.", "ACCOUNTING_REFUND_CANCELLED");
  const company = (await client.query(`SELECT name, legal_name, tax_id FROM public.organizations WHERE id = $1`, [context.organizationId])).rows[0] ?? {};
  return { ...detail, company: { name: company.legal_name || company.name || null, taxId: company.tax_id ?? null } };
}
