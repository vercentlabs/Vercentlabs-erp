import { z } from "zod";

import { readGoodsIssueFile, removeGoodsIssueFile } from "@vercentlabs/api";
import { GOODS_ISSUE_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { inventoryContext } from "@/features/inventory/shared/inventory-context";
import { inventoryMutation } from "@/features/inventory/shared/route-helpers";

type Params = { params: Promise<{ id: string; fileId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, fileId } = await params;
  return workspaceRoute(request, { module: "stock", permission: GOODS_ISSUE_PERMISSIONS.view }, async ({ client, session }) => {
    const file = await readGoodsIssueFile(client, inventoryContext(session), id, fileId);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Length": String(file.body.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

// Only while the goods issue is a draft: a posted one keeps its evidence.
export async function DELETE(request: Request, { params }: Params) {
  const { id, fileId } = await params;
  return inventoryMutation(request, z.record(z.string(), z.unknown()), async (client, context) => ({ result: await removeGoodsIssueFile(client, context, id, fileId) }), 200, GOODS_ISSUE_PERMISSIONS.view);
}
