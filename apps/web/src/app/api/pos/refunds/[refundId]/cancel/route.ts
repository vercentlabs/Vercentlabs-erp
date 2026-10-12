import { z } from "zod";

import { cancelPosRefund } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ refundId: string }> };

// POST: cancel a refund before any money moved (its reservation is released). Anything sent or paid cannot be cancelled.
const schema = z.object({ reason: z.string().trim().min(1).max(300), expectedVersion: z.number().int().optional() });

export async function POST(request: Request, { params }: Params) {
  const { refundId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ refund: await cancelPosRefund(client, context, refundId, input) }), 200, "pos.view");
}
