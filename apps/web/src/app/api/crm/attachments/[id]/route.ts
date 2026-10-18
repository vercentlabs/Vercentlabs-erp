import { deleteAttachment, getAttachment, updateAttachment } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type ContentRouteParams } from "@/features/crm/notes/server/content-http";

export async function GET(request: Request, { params }: ContentRouteParams) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) =>
    ok({ attachment: await getAttachment(client, crmContext(session, snapshot), (await params).id) }),
  );
}

// Body: { displayName?, description? }
export async function PATCH(request: Request, { params }: ContentRouteParams) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ attachment: await updateAttachment(client, crmContext(session, snapshot), (await params).id, await readBody(request)) }),
  );
}

export async function DELETE(request: Request, { params }: ContentRouteParams) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await deleteAttachment(client, crmContext(session, snapshot), (await params).id)),
  );
}
