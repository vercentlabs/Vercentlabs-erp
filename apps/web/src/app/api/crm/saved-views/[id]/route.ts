import { deleteSavedView, setDefaultView } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

type Params = { params: Promise<{ id: string }> };

// Body: { isDefault }
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ view: await setDefaultView(client, crmContext(session, snapshot), id, (await readBody(request)).isDefault === true) }));
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok(await deleteSavedView(client, crmContext(session, snapshot), id)));
}
