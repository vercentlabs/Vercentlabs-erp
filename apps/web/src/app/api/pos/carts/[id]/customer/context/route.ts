import { getPosCustomerContext } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ id: string }> };

// The bill's customer context: walk-in or registered, buyer details, receipt contact (masked unless allowed), the outlet's policy.
export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return posRead(request, async (client, context) => ({ context: await getPosCustomerContext(client, context, id) }), "pos.view");
}
