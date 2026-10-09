import { getInventoryMovementHistory, getMovementGroups } from "@vercentlabs/api";
import { STOCK_LEDGER_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

import { movementFilters } from "./filters";

// Inventory Movement History, a page at a time: item movements (?mode=items, one row per ledger leg) or transaction events (?mode=events, one
// row per posting). Read-only.
export async function GET(request: Request) {
  const filters = movementFilters(request);
  const events = new URL(request.url).searchParams.get("mode") === "events";
  return inventoryRead(request, async (client, context) => ({
    history: events ? await getMovementGroups(client, context, filters) : await getInventoryMovementHistory(client, context, filters),
  }), STOCK_LEDGER_PERMISSIONS.view);
}
