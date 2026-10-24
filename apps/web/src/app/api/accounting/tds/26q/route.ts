import { form26QCsv } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { accountingContext } from "@/features/accounting/shared/accounting-context";

// The quarter's 26Q data as a CSV (?fy=2026&quarter=3), for the return preparation utility.
export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  return workspaceRoute(request, { module: "accounting", permission: "accounting.view" }, async ({ client, session }) => {
    const file = await form26QCsv(client as never, accountingContext(session), { fy: q.get("fy") ?? "", quarter: q.get("quarter") ?? "" });
    return new Response(file.content, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${file.fileName}"`, "Cache-Control": "private, no-store" } });
  });
}
