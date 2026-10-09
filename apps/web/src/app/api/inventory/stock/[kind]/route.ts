import { getStockSettings, listStockOperationOptions } from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Inventory reads shared by several screens: the company stock settings (valuation defaults) and the operation options (warehouses, items,
// units). Gated by stock.view; the domain functions re-check.
export async function GET(request: Request, ctx: { params: Promise<{ kind: string }> }) {
  const { kind } = await ctx.params;
  return inventoryRead(request, async (client, context) => {
    switch (kind) {
      case "settings":
        return { settings: await getStockSettings(client, context) };
      case "options":
        return { options: await listStockOperationOptions(client, context) };
      default:
        throw new HttpError(404, "Unknown inventory view.");
    }
  });
}
