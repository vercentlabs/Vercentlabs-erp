import { exportIncomingReport, getIncomingReport } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { qualityContext } from "@/features/quality/shared/quality-context";
import { qualityRead } from "@/features/quality/shared/route-helpers";

// The fifteen incoming inspection reports (?kind=, &from, &to); &format=csv exports one (the export permission).
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  const kind = get("kind") ?? "register";
  const filters = { from: get("from"), to: get("to") };
  if (get("format") === "csv") {
    return workspaceRoute(request, { module: "quality", permission: "quality.incoming.view" }, async ({ client, session }) => {
      const file = await exportIncomingReport(client, qualityContext(session), kind, filters);
      return new Response(file.body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
    });
  }
  return qualityRead(request, (client, context) => getIncomingReport(client, context, kind, filters), "quality.incoming.view");
}
