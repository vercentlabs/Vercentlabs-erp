import { z } from "zod";

import { approveSalesOrder, approveSalesOrderAmendment } from "@vercentlabs/api";

import { salesMutation } from "@/features/sales/shared/route-helpers";
import { amendmentLineage } from "@/features/sales/orders/server/amendment-lineage";

const schema = z.object({ orderVersionId: z.string().uuid() });

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return salesMutation(request, "sales.order.approve", schema, async (client, context, input) => {
    const amendment = await amendmentLineage(client, context.organizationId, id, input.orderVersionId);
    if (amendment) {
      return { result: await approveSalesOrderAmendment(client, context, id, input.orderVersionId, amendment.previousVersionId, amendment.resumeStatus) };
    }
    return { result: await approveSalesOrder(client, context, id, input.orderVersionId) };
  });
}
