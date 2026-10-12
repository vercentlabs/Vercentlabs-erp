import { z } from "zod";

import { previewPosRefund } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: how a refund of the amount (default: everything still owed) would be split across the original tenders, and whether it needs a
// supervisor. Nothing is reserved, paid or approved.
const schema = z.object({ amount: z.string().regex(/^\d+(\.\d{1,6})?$/).optional() });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ preview: await previewPosRefund(client, context, "pos_return", id, input) }), 200, "pos.view");
}
