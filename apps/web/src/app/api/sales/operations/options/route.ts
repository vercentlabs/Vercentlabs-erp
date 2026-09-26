import { listSalesPass1Options } from "@vercentlabs/api";

import { salesRead } from "@/features/sales/shared/route-helpers";

// Orders (with their lines), commission rules, suppliers and users for the
// operations dialogs -- scoped to the caller's company by the domain function.
export async function GET(request: Request) {
  return salesRead(request, "sales.view", async (client, context) => ({ options: await listSalesPass1Options(client, context) }));
}
