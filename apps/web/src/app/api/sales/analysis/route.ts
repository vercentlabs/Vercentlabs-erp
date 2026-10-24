import { exportSalesAnalysis, getSalesAnalysis } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { salesContext } from "@/features/sales/shared/sales-context";
import { salesRead } from "@/features/sales/shared/route-helpers";

// Sales analysis (Sales report Phase 3): ?rows=customer&columns=month&measure=amount&from=&to=; &format=xlsx downloads it.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const options = { rows: params.get("rows") ?? undefined, columns: params.get("columns") || null, measure: params.get("measure") ?? undefined,
    from: params.get("from") ?? undefined, to: params.get("to") ?? undefined };
  if (params.get("format") === "xlsx")
    return workspaceRoute(request, { module: "sales", permission: "sales.reports.view" }, async ({ client, session }) => {
      const file = await exportSalesAnalysis(client, salesContext(session), options);
      return new Response(new Uint8Array(file.body), { headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
    });
  return salesRead(request, "sales.reports.view", async (client, context) => ({ analysis: await getSalesAnalysis(client, context, options) }));
}
