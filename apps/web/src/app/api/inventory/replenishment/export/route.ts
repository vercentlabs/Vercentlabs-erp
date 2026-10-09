import { audit, exportReorderRules } from "@vercentlabs/api";
import { STOCK_REORDER_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { inventoryContext } from "@/features/inventory/shared/inventory-context";

// Rules with their planning figures as CSV or XLSX (?format=xlsx), filtered like the page. The first six columns import back.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const filters = Object.fromEntries(["view", "warehouseId", "itemId", "categoryId", "search", "overdue"].map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return workspaceRoute(request, { module: "stock", permission: STOCK_REORDER_PERMISSIONS.export }, async ({ client, session }) => {
    const file = await exportReorderRules(client, inventoryContext(session), filters, format);
    await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "stock.reorder.exported", entityType: "inventory_reorder_rule", entityId: null,
      metadata: { format, rows: file.rowCount, filters } });
    return new Response(typeof file.body === "string" ? file.body : new Uint8Array(file.body), {
      headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  });
}
