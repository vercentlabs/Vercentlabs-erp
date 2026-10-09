import { getGoodsIssueAvailability } from "@vercentlabs/api";
import { GOODS_ISSUE_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// An item's stock in a warehouse for the line editor: positions with on hand, reserved, available and disposition; batches; serials in stock.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = { warehouseId: url.searchParams.get("warehouseId") ?? "", itemId: url.searchParams.get("itemId") ?? "" };
  return inventoryRead(request, async (client, context) => ({ availability: await getGoodsIssueAvailability(client, context, input) }), GOODS_ISSUE_PERMISSIONS.view);
}
