import { getStockLedger } from "@vercentlabs/api";
import { STOCK_LEDGER_PERMISSIONS } from "@vercentlabs/permissions";

import { inventoryRead } from "@/features/inventory/shared/route-helpers";

import { ledgerFilters } from "./filters";

// The Stock Ledger, a page at a time, with the running balance of the scope the filters name.
export async function GET(request: Request) {
  const filters = ledgerFilters(request);
  return inventoryRead(request, async (client, context) => ({ ledger: await getStockLedger(client, context, filters) }), STOCK_LEDGER_PERMISSIONS.view);
}
