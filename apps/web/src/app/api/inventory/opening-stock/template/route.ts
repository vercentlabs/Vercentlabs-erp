import { buildOpeningStockTemplate } from "@vercentlabs/api";
import { OPENING_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";

// The import template: SKU, Warehouse, Location, Qty, UOM, Unit Cost, Batch, Manufactured, Expiry, Serial, Disposition, Notes.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "stock", permission: OPENING_STOCK_PERMISSIONS.view }, async () =>
    new Response(buildOpeningStockTemplate(), {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="opening-stock-template.csv"', "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    }));
}
