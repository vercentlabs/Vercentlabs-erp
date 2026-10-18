import { disconnectCalendar } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Disconnect the signed-in person's calendar; events already in it stay there.
export async function DELETE(request: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok(await disconnectCalendar(client, crmContext(session, snapshot), provider)));
}
