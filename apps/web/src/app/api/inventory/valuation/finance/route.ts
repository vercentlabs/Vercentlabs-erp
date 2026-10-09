import { reconcileInventoryWithFinance } from "@vercentlabs/api";
import { STOCK_VALUATION_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

// Inventory value per Inventory Asset account against the account's General Ledger balance. A difference is shown, never adjusted.
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ finance: await reconcileInventoryWithFinance(client, context) }), STOCK_VALUATION_PERMISSIONS.financeReconcile);
}
