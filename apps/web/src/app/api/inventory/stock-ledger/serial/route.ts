import { getSerialHistory } from "@vercentlabs/api";
import { STOCK_LEDGER_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// A serial number's complete physical journey. ?serialId= or ?serialNumber=
export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = { serialId: url.searchParams.get("serialId"), serialNumber: url.searchParams.get("serialNumber") };
  return inventoryRead(request, async (client, context) => ({ history: await getSerialHistory(client, context, input) }), STOCK_LEDGER_PERMISSIONS.view);
}
