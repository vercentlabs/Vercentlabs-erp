import { createStockTransfer } from "@vercentlabs/api";
import { stockSession, tenantTransaction } from "@/modules/stock/server";
import { assertSameOrigin, audit } from "@/core/security";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { validateStockObjectIds } from "@/modules/stock/validation";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const { session, context } = await stockSession(true);
    const rawInput = await readJson(request);
    if (!rawInput || typeof rawInput !== "object" || Array.isArray(rawInput))
      throw new HttpError(400, "Stock transfer input must be a JSON object.");
    const input = rawInput as Record<string, unknown>;
    validateStockObjectIds(
      input,
      [["itemId", "Item"], ["sourceWarehouseId", "Source warehouse"], ["destinationWarehouseId", "Destination warehouse"]],
      [["sourceLocationId", "Source warehouse location"], ["destinationLocationId", "Destination warehouse location"], ["batchId", "Batch"]],
    );
    const transfer = await tenantTransaction(context.organizationId, async (client) => {
      const result = await createStockTransfer(client, context, input);
      if (!result.replayed) {
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "stock.transfer.created",
          entityType: "stock_transfer",
          entityId: String(result.id),
          metadata: {
            itemId: result.item_id,
            sourceWarehouseId: result.source_warehouse_id,
            destinationWarehouseId: result.destination_warehouse_id,
            quantity: result.quantity,
          },
          request,
          client,
        });
      }
      return result;
    });
    return ok({ transfer }, transfer.replayed ? 200 : 201);
  } catch (error) {
    return errorResponse(error);
  }
}
