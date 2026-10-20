import { exportSupportReport, getSupportReport } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { supportContext } from "@/features/support/shared/support-context";
import { supportRead } from "@/features/support/shared/route-helpers";

// The Support reports (?kind=, &from, &to); &format=csv exports one.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const get = (name: string) => q.get(name) || undefined;
  const kind = get("kind") ?? "register";
  const filters = { from: get("from"), to: get("to") };
  if (get("format") === "csv") {
    return workspaceRoute(request, { module: "support", permission: "support.view" }, async ({ client, session }) => {
      const file = await exportSupportReport(client, supportContext(session), kind, filters);
      return new Response(file.body, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
    });
  }
  return supportRead(request, (client, context) => getSupportReport(client, context, kind, filters));
}
