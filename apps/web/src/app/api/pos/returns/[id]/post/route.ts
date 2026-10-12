import { z } from "zod";

import { postPosReturn } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: post the return — stock by disposition, the sale's returned quantities, refunds across the original tenders, the credit note and the
// return receipt, in one transaction. cashRefundConfirmed: the cash was handed over now (else the cash refund waits for confirmation).
const schema = z.object({ expectedVersion: z.number().int().optional(), cashRefundConfirmed: z.boolean().optional(), idempotencyKey: z.string().trim().min(8).max(200) });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ posReturn: await postPosReturn(client, context, id, input) }), 200, "pos.view");
}
