import { z } from "zod";

import { rejectPosReturn } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: a supervisor rejects the return (with a reason); its held quantities are released.
const schema = z.object({ reason: z.string().trim().min(1).max(300), expectedVersion: z.number().int().optional() });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ posReturn: await rejectPosReturn(client, context, id, input) }), 200, "pos.view");
}
