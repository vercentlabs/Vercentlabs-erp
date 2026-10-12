import { z } from "zod";

import { postSettlementToFinance } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ batchId: string }> };

// POST: post the payout to Finance (once; after its bank receipt is matched).
const schema = z.object({});

export async function POST(request: Request, { params }: Params) {
  const { batchId } = await params;
  return posMutation(request, schema, async (client, context) => ({ result: await postSettlementToFinance(client, context, batchId) }), 200, "pos.view");
}
