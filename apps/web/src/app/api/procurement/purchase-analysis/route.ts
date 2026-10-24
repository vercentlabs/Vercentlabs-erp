import { exportPurchaseAnalysis, getPurchaseAnalysis } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { procurementContext } from "@/features/procurement/shared/procurement-context";
import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Purchase analysis (report Phase 3): ?rows=supplier&columns=month&measure=amount&from=&to=; &format=xlsx downloads it.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const options = { rows: params.get("rows") ?? undefined, columns: params.get("columns") || null, measure: params.get("measure") ?? undefined,
    from: params.get("from") ?? undefined, to: params.get("to") ?? undefined };
  if (params.get("format") === "xlsx")
    return workspaceRoute(request, { module: "procurement", permission: "procurement.view" }, async ({ client, session }) => {
      const file = await exportPurchaseAnalysis(client, procurementContext(session), options);
      return new Response(new Uint8Array(file.body), { headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
    });
  return procurementRead(request, async (client, context) => ({ analysis: await getPurchaseAnalysis(client, context, options) }));
}
