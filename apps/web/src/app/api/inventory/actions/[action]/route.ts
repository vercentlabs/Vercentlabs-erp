import { z } from "zod";

import {
  createStockBatch,
  receiveSerializedStock,
  setStockBatchStatus,
  updateStockSettings,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

const body = z.record(z.string(), z.unknown());
const idOf = (input: Record<string, unknown>) => {
  const id = String(input.id ?? "");
  if (!id) throw new HttpError(400, "A record id is required.");
  return id;
};

// One mutation endpoint per Inventory operation. Each domain function enforces its OWN permission
// (stock.receive / issue / adjust / reserve / manage / settings.manage) and replays an
// idempotency key, so a double-click or retry never posts twice.
export async function POST(
  request: Request,
  ctx: { params: Promise<{ action: string }> },
) {
  const { action } = await ctx.params;
  return inventoryMutation(request, body, async (client, context, input) => {
    switch (action) {
      case "batch":
        return { record: await createStockBatch(client, context, input) };
      case "batch-status":
        return {
          record: await setStockBatchStatus(
            client,
            context,
            idOf(input),
            String(input.status ?? ""),
            String(input.reason ?? ""),
          ),
        };
      case "serials":
        return { record: await receiveSerializedStock(client, context, input) };
      case "settings":
        return { record: await updateStockSettings(client, context, input) };
      default:
        throw new HttpError(404, "Unknown inventory action.");
    }
  });
}
