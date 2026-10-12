import { z } from "zod";

import { retryPosRefundComponent } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ refundId: string; componentId: string }> };

// POST: try a definitively failed component again (a new attempt). Unknown or processing ones are never sent again.
export async function POST(request: Request, { params }: Params) {
  const { refundId, componentId } = await params;
  return posMutation(request, z.object({}).passthrough(), async (client, context) => ({ refund: await retryPosRefundComponent(client, context, refundId, { componentId }) }), 200, "pos.view");
}
