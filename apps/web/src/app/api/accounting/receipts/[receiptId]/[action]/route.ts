import { z } from "zod";

import { applyReceipt, applyReceiptToOldest, getCustomerReceiptRecord, reverseCustomerReceipt } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ receiptId: string; action: string }> };
const amount = z.string().trim().regex(/^\d{1,15}(\.\d{1,6})?$/);
const schema = z.object({
  allocations: z.array(z.object({ invoiceId: z.string().uuid(), amount, discountTaken: amount.optional(), writeoffAmount: amount.optional() })).max(200).optional(),
  reason: z.string().trim().max(500).optional(), accountingDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

// apply (chosen invoices) · apply-oldest · reverse (a receipt that did not happen).
export async function POST(request: Request, { params }: Params) {
  const { receiptId, action } = await params;
  return accountingMutation(request, schema, async (client, context, input) => {
    if (action === "apply") await applyReceipt(client, context, receiptId, { allocations: input.allocations ?? [] });
    else if (action === "apply-oldest") await applyReceiptToOldest(client, context, receiptId);
    else if (action === "reverse") await reverseCustomerReceipt(client, context, receiptId, { reason: input.reason ?? "", accountingDate: input.accountingDate });
    else throw new HttpError(404, "Unknown receipt action.");
    return { receipt: await getCustomerReceiptRecord(client, context, receiptId) };
  });
}
