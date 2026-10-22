import { z } from "zod";

import { assignCustomersToRoute } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";

// Puts customers on a beat, or takes them off (routeId null). Only customers the person may see change.
const schema = z.object({ customerIds: z.array(z.string().uuid()).min(1).max(500), routeId: z.string().uuid().nullable() });

export async function POST(request: Request) {
  return salesMutation(request, "sales.customers.edit", schema, async (client, context, input) => assignCustomersToRoute(client, context, input));
}
