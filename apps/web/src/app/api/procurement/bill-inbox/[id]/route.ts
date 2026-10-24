import { getBillInboxEntry } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { procurementContext } from "@/features/procurement/shared/procurement-context";

// One emailed bill: what its QR says, for the bill form to start from.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return workspaceRoute(request, { module: "procurement", permission: "procurement.bills.view" }, async ({ client, session }) =>
    Response.json({ entry: await getBillInboxEntry(client, procurementContext(session), id) }));
}
