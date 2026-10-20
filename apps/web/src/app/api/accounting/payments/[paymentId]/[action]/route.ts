import { z } from "zod";

import {
  applyPayment, applyPaymentToOldest, approveVendorPayment, discardVendorPayment, getVendorPaymentRecord, postApprovedPayment, rejectVendorPaymentApproval, resubmitVendorPayment,
  reverseVendorPayment,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ paymentId: string; action: string }> };
const amount = z.string().trim().regex(/^\d{1,15}(\.\d{1,6})?$/);
const schema = z.object({
  allocations: z.array(z.object({ billId: z.string().uuid(), amount })).max(200).optional(),
  reason: z.string().trim().max(500).optional(), contentHash: z.string().max(200).optional(),
});

// approve · reject (send back) · post · apply · apply-oldest · resubmit · discard · reverse. Each step's rules (permission, the approver not
// being the preparer, the caps) are the domain's.
export async function POST(request: Request, { params }: Params) {
  const { paymentId, action } = await params;
  return accountingMutation(request, schema, async (client, context, input) => {
    switch (action) {
      case "approve": await approveVendorPayment(client, context, paymentId, input.contentHash ?? ""); break;
      case "reject": await rejectVendorPaymentApproval(client, context, paymentId); break;
      case "post": await postApprovedPayment(client, context, paymentId); break;
      case "apply": await applyPayment(client, context, paymentId, { allocations: input.allocations ?? [] }); break;
      case "apply-oldest": await applyPaymentToOldest(client, context, paymentId); break;
      case "resubmit": await resubmitVendorPayment(client, context, paymentId); break;
      case "discard": await discardVendorPayment(client, context, paymentId, { reason: input.reason ?? "" }); break;
      case "reverse": await reverseVendorPayment(client, context, paymentId, { reason: input.reason ?? "" }); break;
      default: throw new HttpError(404, "Unknown payment action.");
    }
    return { payment: await getVendorPaymentRecord(client, context, paymentId) };
  });
}
