import { readSalesDataJobOutput } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { salesContext } from "@/features/sales/shared/sales-context";

// The rows a finished background import could not take, for the person who started it; 410 once it expired.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return workspaceRoute(request, { module: "sales" }, async ({ client, session }) => {
    const file = await readSalesDataJobOutput(client, salesContext(session), id);
    const name = String(file.fileName ?? "rows-to-fix.csv").replace(/["\r\n]/g, "");
    return new Response(new Uint8Array(file.body), {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Content-Length": String(file.body.length),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
