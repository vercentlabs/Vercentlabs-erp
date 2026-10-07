import { readSupplierBillFile, removeSupplierBillFile } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { procurementMutation } from "@/features/procurement/shared/route-helpers";
import { procurementContext } from "@/features/procurement/shared/procurement-context";
import { bodySchema } from "@/features/procurement/suppliers/server/supplier-http";

// One file: view or download it; remove it while the bill is a draft.
type Params = { params: Promise<{ id: string; fileId: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  const inline = new URL(request.url).searchParams.get("disposition") === "inline";
  return workspaceRoute(request, { module: "procurement", permission: "procurement.bills.view" }, async ({ client, session }) => {
    const file = await readSupplierBillFile(client, procurementContext(session), id, fileId);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": inline && file.mimeType ? file.mimeType : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Length": String(file.body.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      },
    });
  });
}

export async function DELETE(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return procurementMutation(request, bodySchema, async (client, context) => ({ result: await removeSupplierBillFile(client, context, id, fileId) }), 200, "accounting.payables.manage");
}
