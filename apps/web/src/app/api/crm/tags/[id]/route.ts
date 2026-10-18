import { deleteTag, updateTag } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

type Params = { params: Promise<{ id: string }> };

// Rename or recolour a tag ({ name?, color? }).
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session, snapshot }) => {
    const body = await readBody(request);
    return ok({ tag: await updateTag(client, crmContext(session, snapshot), id, { name: body.name as string | undefined, color: body.color as never }) });
  });
}

// Deleting a tag takes it off every lead and deal that has it.
export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await deleteTag(client, crmContext(session, snapshot), id)));
}
