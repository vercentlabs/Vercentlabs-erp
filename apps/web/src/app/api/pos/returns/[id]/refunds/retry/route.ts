import { z } from "zod";

import { retryPosReturnRefunds } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: retry failed refunds. A refund processing or with an unknown outcome is asked of the provider, never sent again.
const schema = z.object({ });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ posReturn: await retryPosReturnRefunds(client, context, id, input) }), 200, "pos.view");
}
