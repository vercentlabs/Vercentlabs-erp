import { getProjectExpenseSummary } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// A project's expense summary: claims by stage, recognized cost by source and category, open commitments, reimbursements and recharge —
// separate figures, never one total.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ summary: await getProjectExpenseSummary(client, context, id) }));
}
