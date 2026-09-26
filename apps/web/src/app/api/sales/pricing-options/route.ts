import { listSalesPricingOptions } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { salesContext } from "@/features/sales/shared/sales-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "sales", permission: "sales.view" }, async ({ client, session }) => {
    const result = await listSalesPricingOptions(client, salesContext(session));
    return ok(result);
  });
}
