import { exportInvoiceRegistration } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { assetsContext } from "@/features/assets/shared/assets-context";

// The registration's results as CSV.
type Params = { params: Promise<{ id: string }> };
export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  return workspaceRoute(request, { module: "assets", permission: "assets.invoice.export" }, async ({ client, session }) => {
    const file = await exportInvoiceRegistration(client, assetsContext(session), id);
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
