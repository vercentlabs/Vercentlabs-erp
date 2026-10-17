import { getProjectExpense, updateProjectExpense } from "@vercentlabs/api";
import { z } from "zod";

import { projectsMutation, projectsRead } from "@/features/projects/shared/route-helpers";

// One expense: its details, history, receipts, duplicates, reimbursement, cost, recharge and corrections · PATCH a draft or returned claim.
type Params = { params: Promise<{ expenseId: string }> };
export async function GET(request: Request, ctx: Params) {
  const { expenseId } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ expense: await getProjectExpense(client, context, expenseId) }));
}
export async function PATCH(request: Request, ctx: Params) {
  const { expenseId } = await ctx.params;
  return projectsMutation(request, z.record(z.string(), z.unknown()), async (client, context, input) => updateProjectExpense(client, context, expenseId, input));
}
