import { audit, exportInventoryMovementHistory } from "@vercentlabs/api";
import { STOCK_LEDGER_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { inventoryContext } from "@/features/inventory/shared/inventory-context";

import { movementFilters } from "../filters";

// The filtered item movements as CSV or XLSX (?format=xlsx), cost columns only with the valuation permission. Every download is recorded.
export async function GET(request: Request) {
  const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  const filters = movementFilters(request);
  return workspaceRoute(request, { module: "stock", permission: STOCK_LEDGER_PERMISSIONS.export }, async ({ client, session }) => {
    const file = await exportInventoryMovementHistory(client, inventoryContext(session), filters, format);
    await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "stock.movement_history.exported", entityType: "stock_movement_history",
      entityId: null, metadata: { format, rows: file.rowCount, filters } });
    return new Response(typeof file.body === "string" ? file.body : new Uint8Array(file.body), {
      headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  });
}
