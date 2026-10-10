import { z } from "zod";

import { approvePosException } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ approvalId: string }> };

// A supervisor approves (never the requester; their own profile must hold the approval grant and cover the amount). body: { note? }
export async function POST(request: Request, { params }: Params) {
  const { approvalId } = await params;
  return posMutation(request, z.object({ note: z.string().max(500).optional() }), async (client, context, input) => ({ approval: await approvePosException(client, context, approvalId, input) }),
    200, "pos.view");
}
