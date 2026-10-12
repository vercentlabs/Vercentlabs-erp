import { z } from "zod";

import { previewPosReturnRefundAllocation } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// How this return's refund would be shared across the sale's original tenders under the company's policy. Nothing is refunded.
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, z.object({}).passthrough(), async (client, context) => ({ allocation: await previewPosReturnRefundAllocation(client, context, id) }), 200, "pos.view");
}
