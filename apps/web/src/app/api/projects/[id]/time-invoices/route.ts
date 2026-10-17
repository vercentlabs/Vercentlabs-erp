import { getProjectTimeInvoiceSummary } from "@vercentlabs/api";

import { projectsRead } from "@/features/projects/shared/route-helpers";

// The project's billing from time: approved eligible, invoiced, reserved, in-draft and available minutes, its contract lines and the Sales
// invoices made from its time (values and balances for those allowed).
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return projectsRead(request, async (client, context) => ({ summary: await getProjectTimeInvoiceSummary(client, context, id) }));
}
