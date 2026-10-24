import { msme1Return } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";
import { workspaceRoute } from "@/core/workspace-route";
import { procurementContext } from "@/features/procurement/shared/procurement-context";

// MSME-1 for ?half=2026-H1 (April–September) or 2026-H2 (October–March): the rows, or the CSV with ?format=csv.
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const half = params.get("half") ?? undefined;
  if (params.get("format") === "csv")
    return workspaceRoute(request, { module: "procurement", permission: "procurement.bills.view" }, async ({ client, session }) => {
      const file = await msme1Return(client, procurementContext(session), { half });
      return new Response(file.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
    });
  return procurementRead(request, async (client, context) => {
    const { csv: _csv, ...result } = await msme1Return(client, context, { half });
    void _csv;
    return result;
  }, "procurement.bills.view");
}
