import { z } from "zod";

import { requestPosReturnApproval } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// POST: ask a supervisor to approve this version of the return (only when it carries an exception).
const schema = z.object({ expectedVersion: z.number().int().optional() });

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return posMutation(request, schema, async (client, context, input) => ({ posReturn: await requestPosReturnApproval(client, context, id, input) }), 200, "pos.view");
}
