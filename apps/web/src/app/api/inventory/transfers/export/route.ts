import { audit, exportInventoryTransfers } from "@vercentlabs/api";
import { STOCK_TRANSFER_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { inventoryContext } from "@/features/inventory/shared/inventory-context";

// The filtered transfer list as CSV, for those who may export. Every download is recorded.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const filters = Object.fromEntries(["view", "type", "mode", "sourceWarehouseId", "destinationWarehouseId", "itemId", "from", "to", "search", "limit", "offset"].map((key) => [key, url.searchParams.get(key) ?? undefined]));
  return workspaceRoute(request, { module: "stock", permission: STOCK_TRANSFER_PERMISSIONS.export }, async ({ client, session }) => {
    const file = await exportInventoryTransfers(client, inventoryContext(session), filters);
    await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "stock.transfers.exported", entityType: "inventory_transfer", entityId: null,
      metadata: { filters } });
    return new Response(file.body, {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  });
}
