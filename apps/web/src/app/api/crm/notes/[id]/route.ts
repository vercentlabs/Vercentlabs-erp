import { deleteNote, getNote, updateNote } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { optionalNumber, readBody, type ContentRouteParams } from "@/features/crm/notes/server/content-http";

export async function GET(request: Request, { params }: ContentRouteParams) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ note: await getNote(client, crmContext(session, snapshot), (await params).id) }));
}

// Body: { title?, body?, visibility?, expectedVersion }
export async function PATCH(request: Request, { params }: ContentRouteParams) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ note: await updateNote(client, crmContext(session, snapshot), (await params).id, await readBody(request)) }),
  );
}

// Soft delete: ?expectedVersion
export async function DELETE(request: Request, { params }: ContentRouteParams) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session, snapshot }) => {
    const expectedVersion = optionalNumber(new URL(request.url).searchParams.get("expectedVersion"));
    return ok(await deleteNote(client, crmContext(session, snapshot), (await params).id, { expectedVersion }));
  });
}
