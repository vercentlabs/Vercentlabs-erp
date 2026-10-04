import { setNotePinned } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { optionalNumber, readBody, type ContentRouteParams } from "@/features/crm/notes/server/content-http";

// Body: { pinned: boolean, expectedVersion? }
export async function POST(request: Request, { params }: ContentRouteParams) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const body = await readBody(request);
    const note = await setNotePinned(client, crmContext(session), (await params).id, body.pinned !== false, { expectedVersion: optionalNumber(body.expectedVersion) });
    return ok({ note });
  });
}
