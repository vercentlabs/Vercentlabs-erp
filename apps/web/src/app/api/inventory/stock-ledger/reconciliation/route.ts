import { listStockLedgerReconciliations, reconcileStockLedger } from "@vercentlabs/api";
import { STOCK_LEDGER_PERMISSIONS } from "@vercentlabs/permissions";
import { z } from "zod";

import { inventoryMutation, inventoryRead } from "@/features/inventory/shared/route-helpers";

// The recorded reconciliation runs; POST runs one (balances, batches, serials and postings against the ledger).
export async function GET(request: Request) {
  return inventoryRead(request, async (client, context) => ({ runs: await listStockLedgerReconciliations(client, context) }), STOCK_LEDGER_PERMISSIONS.reconcile);
}

export async function POST(request: Request) {
  return inventoryMutation(request, z.object({ itemId: z.string().optional(), warehouseId: z.string().optional() }),
    async (client, context, input) => ({ reconciliation: await reconcileStockLedger(client, context, input) }), 200, STOCK_LEDGER_PERMISSIONS.reconcile);
}
