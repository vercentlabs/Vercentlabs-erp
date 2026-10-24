import { listGspConnections } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// Each GSTIN and its own GSP connection (no secret is ever returned), with the GSPs that can be chosen (Sales report Phase 2).
export async function GET(request: Request) {
  return salesRead(request, "sales.view", async (client, context) => listGspConnections(client, context));
}
