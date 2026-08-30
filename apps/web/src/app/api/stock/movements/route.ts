import { postStockMovement } from "@vercentlabs/api";
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
      throw new HttpError(400, "Stock movement input must be a JSON object.");
    const input = rawInput as Record<string, unknown>;
    validateStockObjectIds(
      input,
      [["itemId", "Item"], ["warehouseId", "Warehouse"]],
      [["warehouseLocationId", "Warehouse location"], ["batchId", "Batch"], ["serialId", "Serial"], ["referenceId", "Reference record"]],
    );
    const movement = await tenantTransaction(context.organizationId, async (client) => {
      const result = await postStockMovement(client, context, input);
      if (!result.replayed) {
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: `stock.movement.${String(result.movement_type || input.movementType)}`,
          entityType: "stock_movement",
          entityId: String(result.id),
          metadata: {
            movementType: result.movement_type,
            itemId: result.item_id,
            warehouseId: result.warehouse_id,
            quantity: result.quantity,
            referenceType: result.reference_type,
            referenceId: result.reference_id,
          },
          request,
          client,
        });
      }
      return result;
    });
    return ok({ movement }, movement.replayed ? 200 : 201);
  } catch (error) {
    return errorResponse(error);
  }
}
