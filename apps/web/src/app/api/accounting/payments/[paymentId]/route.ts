import { getVendorPaymentRecord } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ paymentId: string }> };

// One supplier payment: its approval, the bills it was approved for, what it settled, and its trail.
export async function GET(request: Request, { params }: Params) {
  const { paymentId } = await params;
  return accountingRead(request, async (client, context) => ({ payment: await getVendorPaymentRecord(client, context, paymentId) }));
}
