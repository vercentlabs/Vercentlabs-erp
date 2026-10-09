import { audit, exportNegativeStock } from "@vercentlabs/api";
import { NEGATIVE_STOCK_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { inventoryContext } from "@/features/inventory/shared/inventory-context";

import { negativeStockFilters } from "../filters";

// The negative-stock report as CSV or XLSX (?format=xlsx), with the screen's filters. Every download is recorded.
export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const filters = negativeStockFilters(request);
  return workspaceRoute(request, { module: "stock", permission: NEGATIVE_STOCK_PERMISSIONS.export }, async ({ client, session }) => {
    const file = await exportNegativeStock(client, inventoryContext(session), filters, format);
    await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "stock.negative.exported", entityType: "negative_stock", entityId: null,
      metadata: { format, rows: file.rowCount, filters } });
    return new Response(typeof file.body === "string" ? file.body : new Uint8Array(file.body), {
      headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  });
}
