import { z } from "zod";

import { setOutletBusinessDayCutoff } from "@vercentlabs/api";

import { posMutation } from "@/features/pos/shared/route-helpers";

// POST: an outlet's business-day cut-off (HH:MM local) — used by business days not yet created; closed days keep their window.
const schema = z.object({ storeId: z.string().uuid(), cutoff: z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/) });

export async function POST(request: Request) {
  return posMutation(request, schema, async (client, context, input) => ({ cutoff: await setOutletBusinessDayCutoff(client, context, input.storeId, input) }), 200, "pos.view");
}
