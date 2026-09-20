import { createHash } from "node:crypto";

import { z } from "zod";

import {
  completeStockTransfer,
  createStockBatch,
  createStockTransfer,
  postStockMovement,
  receiveSerializedStock,
  releaseStockReservation,
  reserveStock,
  saveStockReorderRule,
  setStockBatchStatus,
  updateStockSettings,
} from "@vercentlabs/api";

import { HttpError } from "@/core/http";
import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

const body = z.record(z.string(), z.unknown());
// A manual hold has no source document; give it a stable reference derived from the request's
// idempotency key so a retry replays the same reservation instead of creating another.
function manualReference(input: Record<string, unknown>) {
  const hex = createHash("sha256").update(String(input.idempotencyKey ?? Math.random())).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
const idOf = (input: Record<string, unknown>) => {
  const id = String(input.id ?? "");
  if (!id) throw new HttpError(400, "A record id is required.");
  return id;
};

// One mutation endpoint per Inventory operation. Each domain function enforces its OWN permission
// (stock.receive / issue / adjust / transfer / reserve / manage / settings.manage) and replays an
// idempotency key, so a double-click or retry never posts twice.
export async function POST(request: Request, ctx: { params: Promise<{ action: string }> }) {
  const { action } = await ctx.params;
  return inventoryMutation(request, body, async (client, context, input) => {
    switch (action) {
      case "movement":
        return { record: await postStockMovement(client, context, input) };
      case "transfer":
        return { record: await createStockTransfer(client, context, input) };
      case "transfer-complete":
        return { record: await completeStockTransfer(client, context, idOf(input)) };
      case "reserve":
        return { record: await reserveStock(client, context, { ...input, referenceType: input.referenceType || "manual_hold", referenceId: input.referenceId || manualReference(input) }) };
      case "reservation-release":
        return { record: await releaseStockReservation(client, context, idOf(input), { status: input.status === "cancelled" ? "cancelled" : "released" }) };
      case "batch":
        return { record: await createStockBatch(client, context, input) };
      case "batch-status":
        return { record: await setStockBatchStatus(client, context, idOf(input), String(input.status ?? ""), String(input.reason ?? "")) };
      case "serials":
        return { record: await receiveSerializedStock(client, context, input) };
      case "reorder-rule":
        return { record: await saveStockReorderRule(client, context, input) };
      case "settings":
        return { record: await updateStockSettings(client, context, input) };
      default:
        throw new HttpError(404, "Unknown inventory action.");
    }
  });
}
