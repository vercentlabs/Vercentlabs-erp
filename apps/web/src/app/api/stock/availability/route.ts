import { getStockAvailability } from "@vercentlabs/api";
import { stockSession, tenantTransaction } from "@/modules/stock/server";
import { errorResponse, ok } from "@/core/http";
import { assertStockUuid } from "@/modules/stock/validation";
export async function GET(request: Request) {
  try {
    const { context } = await stockSession();
    const input = Object.fromEntries(new URL(request.url).searchParams.entries());
    assertStockUuid(input.itemId, "Item");
    assertStockUuid(input.warehouseId, "Warehouse", { optional: true });
    assertStockUuid(input.warehouseLocationId, "Warehouse location", { optional: true });
    assertStockUuid(input.batchId, "Batch", { optional: true });
    return ok({ availability: await tenantTransaction(context.organizationId, (client) => getStockAvailability(client, context, input)) });
  } catch (error) { return errorResponse(error); }
}
