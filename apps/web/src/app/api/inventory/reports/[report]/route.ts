import { audit, exportInventoryReport, getInventoryReport } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { inventoryContext } from "@/features/inventory/shared/inventory-context";
import { inventoryRead } from "@/features/inventory/shared/route-helpers";

const FILTERS = ["asOf", "from", "to", "warehouseId", "itemId", "categoryId", "search", "grain"] as const;

// One Inventory report: stock-balance | stock-valuation | stock-movement, with ?asOf= or ?from=&to=, ?warehouseId=, ?itemId=, ?categoryId=, ?search=, ?grain=warehouse|item.
// ?format=csv|xlsx downloads it; every download is recorded. The report checks its own permission.
export async function GET(request: Request, { params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const search = new URL(request.url).searchParams;
  const filters = Object.fromEntries(FILTERS.flatMap((key) => (search.get(key) ? [[key, search.get(key)]] : [])));
  const format = search.get("format");
  if (format !== "csv" && format !== "xlsx") return inventoryRead(request, (client, context) => getInventoryReport(client, context, report, filters));
  return workspaceRoute(request, { module: "stock", permission: "stock.view" }, async ({ client, session }) => {
    const file = await exportInventoryReport(client, inventoryContext(session), report, filters, format);
    await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "stock.report.exported", entityType: "inventory_report", entityId: null,
      metadata: { report, format, rows: file.rowCount, filters } });
    return new Response(typeof file.body === "string" ? file.body : new Uint8Array(file.body), {
      headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  });
}
