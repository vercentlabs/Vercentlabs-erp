import { getOutletAccess } from "@vercentlabs/api";

import { posRead } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ outletId: string }> };

// The cashiers who may work at the outlet. Access is given to a cashier under POS → Cashiers.
export async function GET(request: Request, { params }: Params) {
  const { outletId } = await params;
  return posRead(request, async (client, context) => ({ access: await getOutletAccess(client, context, outletId) }));
}
