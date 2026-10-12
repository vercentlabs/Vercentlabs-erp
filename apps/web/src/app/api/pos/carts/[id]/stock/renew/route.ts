import { z } from "zod";

import { renewPosCheckoutStock } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: renew the checkout's stock reservation while payment is under way (never past the outlet's maximum hold); a lapsed one is reserved again.
const schema = z.object({});

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context) => ({ renewal: await renewPosCheckoutStock(client, context, id) }), 200, "pos.sale.create");
}
