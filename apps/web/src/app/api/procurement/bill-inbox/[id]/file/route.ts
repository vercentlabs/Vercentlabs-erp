import { readBillInboxFile } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { procurementContext } from "@/features/procurement/shared/procurement-context";

// The emailed file itself: view (?disposition=inline) or download.
type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, ctx: Params) {
  const { id } = await ctx.params;
  const inline = new URL(request.url).searchParams.get("disposition") === "inline";
  return workspaceRoute(request, { module: "procurement", permission: "procurement.bills.view" }, async ({ client, session }) => {
    const file = await readBillInboxFile(client, procurementContext(session), id);
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": inline && file.mimeType ? file.mimeType : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
        "Content-Length": String(file.body.length), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
