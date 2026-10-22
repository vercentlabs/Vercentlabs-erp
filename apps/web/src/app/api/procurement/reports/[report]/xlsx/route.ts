import { exportProcurementReport } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { procurementContext } from "@/features/procurement/shared/procurement-context";

// A Procurement report as an Excel workbook, with the same filters as the screen (the registers' export).
const FILTERS = ["supplierId", "buyingRegistrationId", "from", "to", "status"];

export async function GET(request: Request, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const url = new URL(request.url);
  const filters = Object.fromEntries(FILTERS.map((key) => [key, url.searchParams.get(key) ?? undefined]).filter(([, value]) => value));
  return workspaceRoute(request, { module: "procurement", permission: "procurement.view" }, async ({ client, session }) => {
    const file = await exportProcurementReport(client as Parameters<typeof exportProcurementReport>[0], procurementContext(session), report, filters);
    return new Response(new Uint8Array(file.body), {
      headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store" },
    });
  });
}
