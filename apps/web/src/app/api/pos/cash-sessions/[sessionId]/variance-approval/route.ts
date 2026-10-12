import { z } from "zod";

import { requestCashSessionVarianceApproval } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ sessionId: string }> };

// POST: ask a supervisor to accept exactly the current count's difference (count, expected cash, cash ledger version, policy).
const schema = z.object({ reason: z.string().trim().max(500).optional(), reasonCode: z.string().trim().max(40).optional(), idempotencyKey: z.string().trim().max(120).optional() });

export async function POST(request: Request, { params }: Params) {
  const { sessionId } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ approval: await requestCashSessionVarianceApproval(client, context, sessionId, input) }), 201, "pos.shift.close");
}
