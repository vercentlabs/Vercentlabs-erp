import { readPurchaseOrderFile, removePurchaseOrderFile } from "@vercentlabs/api";

import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";
import { workspaceRoute } from "@/core/workspace-route";
import { procurementContext } from "@/features/procurement/shared/procurement-context";

// One file: download it, or remove it.
type Params = { params: Promise<{ id: string; fileId: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "procurement", permission: "procurement.po.view" }, async ({ client, session }) => {
    const file = await readPurchaseOrderFile(client, procurementContext(session), id, fileId);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Length": String(file.body.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

export async function DELETE(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context) => ({ result: await removePurchaseOrderFile(client, context, id, fileId) }), 200, "procurement.po.view");
}
