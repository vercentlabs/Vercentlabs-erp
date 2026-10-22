import { createPurchaseOrderFromIndents } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";


// One draft purchase order to a supplier for approved indent lines.
export async function POST(request: Request) {
  return procurementMutation(request, bodySchema, async (client, context, input) => ({ result: await createPurchaseOrderFromIndents(client, context, input) }), 201);
}
