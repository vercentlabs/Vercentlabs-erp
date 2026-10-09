import { z } from "zod";

import { readAdjustmentFile, removeAdjustmentFile } from "@vercentlabs/api";
import { STOCK_ADJUSTMENT_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { inventoryContext } from "@/features/inventory/shared/inventory-context";
import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string; fileId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, fileId } = await params;
  return workspaceRoute(request, { module: "stock", permission: STOCK_ADJUSTMENT_PERMISSIONS.view }, async ({ client, session }) => {
    const file = await readAdjustmentFile(client, inventoryContext(session), id, fileId);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Length": String(file.body.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

// Only while the adjustment is a draft: a posted one keeps its evidence.
export async function DELETE(request: Request, { params }: Params) {
  const { id, fileId } = await params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context) => ({ result: await removeAdjustmentFile(client, context, id, fileId) }), 200,
    STOCK_ADJUSTMENT_PERMISSIONS.view);
}
