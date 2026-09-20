import { z } from "zod";

import { createProcurementReorderRequest } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";

// The domain validates every field and demands the operation's own permission;
// this schema only rejects malformed transport data.
export async function POST(request: Request) {
  return procurementMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => ({ reorderRequest: await createProcurementReorderRequest(client, context, input) }), 201);
}
