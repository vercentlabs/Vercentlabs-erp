import { createExpenseRechargeRequest, linkGoodsIssueToProject, linkSupplierBillToProject } from "@vercentlabs/api";
import { z } from "zod";

import { HttpError } from "@/core/http";
import { projectsMutation } from "@/features/projects/shared/route-helpers";

// POST link-bill { vendorBillLineId, amount?, categoryId?, taskId? } · link-goods-issue { goodsIssueId } · recharge { expenseIds, note? }
type Params = { params: Promise<{ id: string; action: string }> };
export async function POST(request: Request, ctx: Params) {
  const { id, action } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => {
    if (action === "link-bill") return linkSupplierBillToProject(client, context, id, input);
    if (action === "link-goods-issue") return linkGoodsIssueToProject(client, context, id, input);
    if (action === "recharge") return createExpenseRechargeRequest(client, context, id, input);
    throw new HttpError(404, "Unknown project expense action.", "NOT_FOUND");
  });
}
