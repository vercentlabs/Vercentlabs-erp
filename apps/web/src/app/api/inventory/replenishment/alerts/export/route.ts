import { audit, exportLowStockAlerts } from "@vercentlabs/api";
import { STOCK_ALERT_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { inventoryContext } from "@/features/inventory/shared/inventory-context";

import { ALERT_FILTER_KEYS } from "../filters";

// The filtered alerts as CSV or XLSX (?format=xlsx). Every download is recorded.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const filters = Object.fromEntries(ALERT_FILTER_KEYS.map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return workspaceRoute(request, { module: "stock", permission: STOCK_ALERT_PERMISSIONS.export }, async ({ client, session }) => {
    const file = await exportLowStockAlerts(client, inventoryContext(session), filters, format);
    await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "stock.low_stock_alerts.exported", entityType: "inventory_low_stock_alert",
      entityId: null, metadata: { format, rows: file.rowCount, filters } });
    return new Response(typeof file.body === "string" ? file.body : new Uint8Array(file.body), {
      headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  });
}
