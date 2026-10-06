import { getRefundableCustomerCredit } from "@vercentlabs/api";

import { fail } from "@/core/http";
import { accountingRead } from "@/features/accounting/shared/route-helpers";

// The customer's credit that can be refunded now: what is left on posted credit notes and unapplied on receipts.
export async function GET(request: Request) {
  const partyId = new URL(request.url).searchParams.get("partyId");
  if (!partyId) return fail("Choose the customer.", 400, { code: "ACCOUNTING_REFUND_CUSTOMER_REQUIRED" });
  return accountingRead(request, async (client, context) => ({ credit: await getRefundableCustomerCredit(client, context, partyId) }), "accounting.customer_credit.view");
}
