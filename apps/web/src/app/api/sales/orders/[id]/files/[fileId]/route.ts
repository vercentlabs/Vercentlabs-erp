import { readSalesOrderFile, removeSalesOrderFile } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { emptySchema } from "@/features/sales/shared/schemas";
import { salesMutation } from "@/features/sales/shared/route-helpers";
import { salesContext } from "@/features/sales/shared/sales-context";

type Params = { params: Promise<{ id: string; fileId: string }> };

// The file itself, as a download.
export async function GET(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "sales", permission: "sales.order.view" }, async ({ client, session }) => {
    const file = await readSalesOrderFile(client, salesContext(session), id, fileId);
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
  return salesMutation(request, "sales.order.create", emptySchema, async (client, context) => ({ result: await removeSalesOrderFile(client, context, id, fileId) }));
}
