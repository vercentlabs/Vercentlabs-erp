import { z } from "zod";

import { requestShiftClosingApproval } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: ask a supervisor to accept exactly this count's difference.
const schema = z.object({ reason: z.string().trim().max(500).optional(), idempotencyKey: z.string().trim().max(120).optional() });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ approval: await requestShiftClosingApproval(client, context, id, input) }), 201, "pos.shift.close");
}
