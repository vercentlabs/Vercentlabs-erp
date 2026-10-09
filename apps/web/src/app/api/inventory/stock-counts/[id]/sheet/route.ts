import { exportCountSheet } from "@vercentlabs/api";
import { STOCK_COUNT_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { inventoryContext } from "@/features/inventory/shared/inventory-context";

// The count sheet, ?format=csv|xlsx (no system quantity on a blind count).
export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const format = new URL(request.url).searchParams.get("format") === "xlsx" ? "xlsx" : "csv";
  return workspaceRoute(request, { module: "stock", permission: STOCK_COUNT_PERMISSIONS.export }, async ({ client, session }) => {
    const file = await exportCountSheet(client, inventoryContext(session), id, format);
    return new Response(typeof file.body === "string" ? file.body : new Uint8Array(file.body), {
      headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" },
    });
  });
}
