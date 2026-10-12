import { z } from "zod";

import { recordPosManualRefund } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ refundId: string; componentId: string }> };

// POST: record a refund made outside the provider (standalone machine, static QR, or a confirmed unknown) with its reference. Reconciliation.
const schema = z.object({ reference: z.string().trim().min(1).max(80) });

export async function POST(request: Request, { params }: Params) {
  const { refundId, componentId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ refund: await recordPosManualRefund(client, context, refundId, { componentId, reference: input.reference }) }), 200, "pos.view");
}
