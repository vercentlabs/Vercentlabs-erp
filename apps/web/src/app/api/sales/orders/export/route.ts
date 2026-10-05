import { exportSalesOrders } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { csvResponse, orderFiltersFromUrl } from "@/features/sales/orders/server/order-http";
import { salesContext } from "@/features/sales/shared/sales-context";

export async function GET(request: Request) {
  const filters = orderFiltersFromUrl(new URL(request.url));
  return workspaceRoute(request, { module: "sales", permission: "sales.order.export" }, async ({ client, session }) => {
    const exported = await exportSalesOrders(client, salesContext(session), filters);
    return csvResponse(exported.csv, exported.fileName);
  });
}
