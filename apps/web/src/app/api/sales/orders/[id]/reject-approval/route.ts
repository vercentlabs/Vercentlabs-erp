import { z } from "zod";

import { rejectSalesOrderAmendment, rejectSalesOrderApproval } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";
import { amendmentLineage } from "@/features/sales/orders/server/amendment-lineage";

// F041: a rejection always says why; the reason is kept on the order.
const schema = z.object({ orderVersionId: z.string().uuid(), reason: z.string().trim().min(5, "Say why the approval is rejected (at least 5 characters).").max(2000) });

// The domain's reject functions do not check a permission themselves, so the
// route's own gate (sales.order.approve) is the only thing between a user and
// bouncing someone's order back to draft.
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.approve", schema, async (client, context, input) => {
    const amendment = await amendmentLineage(client, context.organizationId, id, input.orderVersionId);
    if (amendment) {
      return { result: await rejectSalesOrderAmendment(client, context, id, input.orderVersionId, amendment.previousVersionId, amendment.resumeStatus) };
    }
    await rejectSalesOrderApproval(client, context, id, input.reason);
    return { result: { orderId: id, status: "draft" } };
  });
}
