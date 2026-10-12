import { z } from "zod";

import { cancelPosReturn } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: cancel an unposted return; its held quantities are released. A posted return is never cancelled.
const schema = z.object({ reason: z.string().trim().max(300).optional(), expectedVersion: z.number().int().optional() });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ posReturn: await cancelPosReturn(client, context, id, input) }), 200, "pos.view");
}
