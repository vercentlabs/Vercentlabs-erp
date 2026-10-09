import {
  getWarehouseBatches, getWarehouseHistory, getWarehouseIncoming, getWarehouseItemBalances, getWarehouseMovements, getWarehouseOutgoing, getWarehouseSerials,
  getWarehouseTransfers,
} from "@vercentlabs/api";
import { WAREHOUSE_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError } from "@/core/http";
import { inventoryRead } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ warehouseId: string; view: string }> };

// The warehouse's tabs, all read from Inventory: stock (?search, ?categoryId, ?locationId, ?batchId, ?status), movements (?itemId,
// ?movementType, ?locationId, ?reference, ?from, ?to), incoming, outgoing, transfers, batches, serials, history.
export async function GET(request: Request, { params }: Params) {
  const { warehouseId, view } = await params;
  const filters = Object.fromEntries(new URL(request.url).searchParams.entries());
  return inventoryRead(request, async (client, context) => {
    switch (view) {
      case "stock": return getWarehouseItemBalances(client, context, warehouseId, filters);
      case "movements": return { rows: await getWarehouseMovements(client, context, warehouseId, filters) };
      case "incoming": return { rows: await getWarehouseIncoming(client, context, warehouseId) };
      case "outgoing": return { rows: await getWarehouseOutgoing(client, context, warehouseId) };
      case "transfers": return { rows: await getWarehouseTransfers(client, context, warehouseId) };
      case "batches": return { rows: await getWarehouseBatches(client, context, warehouseId) };
      case "serials": return { rows: await getWarehouseSerials(client, context, warehouseId) };
      case "history": return { rows: await getWarehouseHistory(client, context, warehouseId) };
      default: throw new HttpError(404, "Unknown warehouse view.");
    }
  }, WAREHOUSE_PERMISSIONS.view);
}
