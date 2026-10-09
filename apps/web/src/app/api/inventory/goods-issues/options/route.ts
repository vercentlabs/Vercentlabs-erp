import { getGoodsIssueOptions } from "@vercentlabs/api";
import { GOODS_ISSUE_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ options: await getGoodsIssueOptions(client, context) }), GOODS_ISSUE_PERMISSIONS.view);
}
