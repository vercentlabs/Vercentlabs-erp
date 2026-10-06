import { readReturnFile, removeReturnFile } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { emptySchema } from "@/features/sales/shared/schemas";
import { salesMutation } from "@/features/sales/shared/route-helpers";
import { salesContext } from "@/features/sales/shared/sales-context";

type Params = { params: Promise<{ id: string; fileId: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "sales", permission: "sales.return.view" }, async ({ client, session }) => {
    const file = await readReturnFile(client, salesContext(session), id, fileId);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Length": String(file.body.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

export async function DELETE(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return salesMutation(request, "sales.return.view", emptySchema, async (client, context) => ({ result: await removeReturnFile(client, context, id, fileId) }));
}
