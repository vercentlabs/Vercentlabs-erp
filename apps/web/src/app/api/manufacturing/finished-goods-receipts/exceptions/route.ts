import { getFinishedGoodsReceiptExceptions } from "@vercentlabs/api";

import { manufacturingRead } from "@/features/manufacturing/shared/route-helpers";

// The receipt exceptions queue: approvals and corrections waiting, failed sales allocations, postings needing recovery, accepted output not received.
export async function GET(request: Request) {
  return manufacturingRead(request, async (client, context) => ({ exceptions: await getFinishedGoodsReceiptExceptions(client, context) }));
}
