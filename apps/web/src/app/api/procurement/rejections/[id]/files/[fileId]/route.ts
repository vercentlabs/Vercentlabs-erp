import { readRejectionFile, removeRejectionFile } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { procurementContext } from "@/features/procurement/shared/procurement-context";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// One evidence file: download it, or remove it while the case is open.
type Params = { params: Promise<{ id: string; fileId: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "procurement", permission: "procurement.rejections.view" }, async ({ client, session }) => {
    const file = await readRejectionFile(client, procurementContext(session), id, fileId);
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
  return procurementMutation(request, bodySchema, async (client, context) => ({ result: await removeRejectionFile(client, context, id, fileId) }), 200, "procurement.rejections.edit");
}
