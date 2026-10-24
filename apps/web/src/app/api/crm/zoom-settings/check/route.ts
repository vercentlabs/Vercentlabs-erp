import { checkZoomConnection } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Checks the saved Zoom connection with Zoom now (a token and the host user).
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ settings: await checkZoomConnection(client, crmContext(session, snapshot)) }));
}
