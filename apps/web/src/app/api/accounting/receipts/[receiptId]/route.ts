import { getCustomerReceiptRecord } from "@vercentlabs/api";

import { accountingRead } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ receiptId: string }> };

// One receipt: what it settled, what it could still settle, and its trail.
export async function GET(request: Request, { params }: Params) {
  const { receiptId } = await params;
  return accountingRead(request, async (client, context) => ({ receipt: await getCustomerReceiptRecord(client, context, receiptId) }));
}
