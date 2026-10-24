import { listBillInbox } from "@vercentlabs/api";

import { workspaceRoute } from "@/core/workspace-route";
import { procurementContext } from "@/features/procurement/shared/procurement-context";

// Bills suppliers emailed (report Phase 3): ?view=new | billed | set_aside | all.
export async function GET(request: Request) {
  const view = new URL(request.url).searchParams.get("view") ?? "new";
  return workspaceRoute(request, { module: "procurement", permission: "procurement.bills.view" }, async ({ client, session }) =>
    Response.json(await listBillInbox(client, procurementContext(session), { view })));
}
