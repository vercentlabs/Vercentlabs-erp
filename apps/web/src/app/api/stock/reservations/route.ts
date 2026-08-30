import { reserveStock } from "@vercentlabs/api";
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
      throw new HttpError(400, "Stock reservation input must be a JSON object.");
    const input = rawInput as Record<string, unknown>;
    validateStockObjectIds(
      input,
      [["itemId", "Item"], ["warehouseId", "Warehouse"], ["referenceId", "Reservation reference record"]],
      [["warehouseLocationId", "Warehouse location"], ["batchId", "Batch"]],
    );
    const reservation = await tenantTransaction(context.organizationId, async (client) => {
      const result = await reserveStock(client, context, input);
      if (!result.replayed) await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "stock.reservation.created", entityType: "stock_reservation", entityId: String(result.id), metadata: { itemId: result.item_id, warehouseId: result.warehouse_id, referenceType: result.reference_type, referenceId: result.reference_id }, request, client });
      return result;
    });
    return ok({ reservation }, 201);
  } catch (error) { return errorResponse(error); }
}
