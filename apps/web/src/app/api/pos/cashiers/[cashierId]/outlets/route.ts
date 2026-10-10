import { z } from "zod";

import { setCashierOutlets } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ cashierId: string }> };

// body: { outletIds, defaultOutletId? } — the whole list of outlets the cashier may work at. The outlet of an open session stays.
export async function PUT(request: Request, { params }: Params) {
  const { cashierId } = await params;
  return posMutation(request, z.object({ outletIds: z.array(z.string()), defaultOutletId: z.string().nullable().optional() }),
    async (client, context, input) => ({ cashier: await setCashierOutlets(client, context, cashierId, input.outletIds, { defaultOutletId: input.defaultOutletId }) }), 200,
    "pos.cashiers.view");
}
