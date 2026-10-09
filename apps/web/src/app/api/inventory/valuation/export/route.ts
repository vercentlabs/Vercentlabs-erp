import { audit, exportInventoryValuation } from "@vercentlabs/api";
import { STOCK_VALUATION_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { inventoryContext } from "@/features/inventory/shared/inventory-context";

import { valuationFilters } from "../filters";

// The valuation report as CSV or XLSX (?format=xlsx), with the screen's filters. Every download is recorded.
export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const filters = valuationFilters(request);
  return workspaceRoute(request, { module: "stock", permission: STOCK_VALUATION_PERMISSIONS.export }, async ({ client, session }) => {
    const file = await exportInventoryValuation(client, inventoryContext(session), filters, format);
    await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "stock.valuation.exported", entityType: "inventory_valuation", entityId: null,
      metadata: { format, rows: file.rowCount, filters } });
    return new Response(typeof file.body === "string" ? file.body : new Uint8Array(file.body), {
      headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  });
}
