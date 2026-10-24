import { exportItc04 } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { procurementContext } from "@/features/procurement/shared/procurement-context";

// Form ITC-04 for ?from=&to= as a CSV download.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return workspaceRoute(request, { module: "procurement", permission: "procurement.view" }, async ({ client, session }) => {
    const file = await exportItc04(client, procurementContext(session), { from: params.get("from") ?? undefined, to: params.get("to") ?? undefined });
    return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
