import { z } from "zod";

import { approvePosRefund } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ refundId: string }> };

// POST: a supervisor approves exactly this version of the refund — never the requester; APPROVE_REFUND_EXCEPTION covering the amount.
const schema = z.object({ expectedVersion: z.number().int().optional(), note: z.string().trim().max(300).optional() });

export async function POST(request: Request, { params }: Params) {
  const { refundId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ refund: await approvePosRefund(client, context, refundId, input) }), 200, "pos.view");
}
