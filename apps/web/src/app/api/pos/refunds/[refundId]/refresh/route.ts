import { z } from "zod";

import { refreshPosRefund } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ refundId: string }> };

// POST: ask the provider again about refunds still processing or unknown.
const schema = z.object({ });

export async function POST(request: Request, { params }: Params) {
  const { refundId } = await params;
  return posMutation(request, schema, async (client, context) => ({ refund: await refreshPosRefund(client, context, refundId) }), 200, "pos.view");
}
