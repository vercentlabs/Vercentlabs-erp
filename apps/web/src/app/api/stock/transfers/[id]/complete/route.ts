import { completeStockTransfer } from "@vercentlabs/api";
import { stockSession, tenantTransaction } from "@/modules/stock/server";
import { assertSameOrigin, audit } from "@/core/security";
import { errorResponse, ok } from "@/core/http";
import { assertStockUuid } from "@/modules/stock/validation";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertSameOrigin(request);
    const { id } = await params;
    assertStockUuid(id, "Stock transfer");
    const { session, context } = await stockSession(true);
    const transfer = await tenantTransaction(context.organizationId, async (client) => {
      const result = await completeStockTransfer(client, context, id);
      if (!result.replayed) {
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "stock.transfer.completed",
          entityType: "stock_transfer",
          entityId: String(result.id),
          metadata: { itemId: result.item_id, quantity: result.quantity },
          request,
          client,
        });
      }
      return result;
    });
    return ok({ transfer });
  } catch (error) {
    return errorResponse(error);
  }
}
