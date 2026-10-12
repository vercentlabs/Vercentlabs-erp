import { z } from "zod";

import { sweepPosCheckoutReservations } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

// POST: release expired checkout reservations now (Inventory reconcilers, POS settings or reconciliation managers).
const schema = z.object({});

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context) => ({ sweep: await sweepPosCheckoutReservations(client, context) }), 200, "pos.view");
}
