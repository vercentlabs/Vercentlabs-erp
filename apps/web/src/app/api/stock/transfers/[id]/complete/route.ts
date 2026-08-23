import { completeStockTransfer } from "@vercentlabs/api";
import { stockSession, tenantTransaction } from "@/modules/stock/server";
import { errorResponse, ok } from "@/core/http";
export async function POST(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { context } = await stockSession(true);
    return ok({
      transfer: await tenantTransaction(context.organizationId, (c) =>
        completeStockTransfer(c, context, id),
      ),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
