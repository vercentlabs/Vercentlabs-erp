import { getPosApproval } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ approvalId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { approvalId } = await params;
  return posRead(request, async (client, context) => ({ approval: await getPosApproval(client, context, approvalId) }), "pos.view");
}
