import { z } from "zod";

import { readRefundFile, removeRefundFile } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { accountingContext } from "@/features/accounting/shared/accounting-context";
import { accountingMutation } from "@/features/accounting/shared/route-helpers";

type Params = { params: Promise<{ id: string; fileId: string }> };

// The file itself, as a download.
export async function GET(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return workspaceRoute(request, { module: "accounting", permission: "accounting.refund.view" }, async ({ client, session }) => {
    const file = await readRefundFile(client, accountingContext(session), id, fileId);
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

// The module checks who may remove files.
export async function DELETE(request: Request, ctx: Params) {
  const { id, fileId } = await ctx.params;
  return accountingMutation(request, z.object({}), async (client, context) => ({ result: await removeRefundFile(client, context, id, fileId) }), 200, "accounting.refund.view");
}
