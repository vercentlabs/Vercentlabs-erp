import { purchaseReturnEwayBillJson } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { procurementContext } from "@/features/procurement/shared/procurement-context";

// The e-way bill JSON for the portal's bulk upload, as a file.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return workspaceRoute(request, { module: "procurement", permission: "procurement.view" }, async ({ client, session }) => {
    const file = await purchaseReturnEwayBillJson(client as Parameters<typeof purchaseReturnEwayBillJson>[0], procurementContext(session), id);
    return new Response(JSON.stringify(file.json, null, 2), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store" },
    });
  });
}
