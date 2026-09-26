import { getPosDayEndReport } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { posContext } from "@/features/pos/shared/pos-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "point-of-sale", permission: "pos.report.view" }, async ({ client, session }) => {
    const { id } = await context.params;
    const result = await getPosDayEndReport(client, posContext(session), id);
    return ok({ report: result });
  });
}
