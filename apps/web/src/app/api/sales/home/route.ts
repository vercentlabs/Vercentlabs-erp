import { getSalesHome } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// The Sales home: what needs doing now and what happened last.
export async function GET(request: Request) {
  return salesRead(request, "sales.view", async (client, context) => ({ home: await getSalesHome(client, context) }));
}
