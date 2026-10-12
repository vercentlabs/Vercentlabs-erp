import { z } from "zod";

import { finalizePosCardCheckout } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

type Params = { params: Promise<{ checkoutId: string }> };

// Try again to finalise a bill whose card payment is captured (after a stock or tax problem). Nothing is charged again.
export async function POST(request: Request, { params }: Params) {
  const { checkoutId } = await params;
  return posMutation(request, z.object({}).passthrough(), async (client, context) => ({ attempt: await finalizePosCardCheckout(client, context, checkoutId) }), 200, "pos.sale.create");
}
