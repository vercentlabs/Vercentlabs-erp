import { postStockMovement } from "@vercentlabs/api";
import { stockSession, tenantTransaction } from "@/modules/stock/server";
import { errorResponse, ok } from "@/core/http";
export async function POST(r: Request) {
  try {
    const { context } = await stockSession(true);
    const input = await r.json();
    return ok(
      {
        movement: await tenantTransaction(context.organizationId, (c) =>
          postStockMovement(c, context, input),
        ),
      },
      201,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
