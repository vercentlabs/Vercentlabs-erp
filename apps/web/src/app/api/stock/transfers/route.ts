import { createStockTransfer } from "@vercentlabs/api";
import { stockSession, tenantTransaction } from "@/lib/stock-route";
import { errorResponse, ok } from "@/lib/http";
export async function POST(r: Request) {
  try {
    const { context } = await stockSession(true);
    const input = await r.json();
    return ok(
      {
        transfer: await tenantTransaction(context.organizationId, (c) =>
          createStockTransfer(c, context, input),
        ),
      },
      201,
    );
  } catch (e) {
    return errorResponse(e);
  }
}
