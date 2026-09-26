import { createCrmNote, listCrmNotes } from "@vercentlabs/api";

import { HttpError, ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F017 Notes — composed into Lead/Account/Contact/Opportunity 360s, never
// a standalone global screen. notes-operations.js is the ONE domain
// authority: parent-record authorization is entirely resolveCrmEntityAccess
// (the same gate Timeline uses), and author-or-view-all governs edit/
// archive — no additional crm.<x>.manage permission is layered on top,
// since access here is inherited from "can you see the parent record,"
// not a separate resource-level grant.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const url = new URL(request.url);
    const entityType = url.searchParams.get("entityType");
    const entityId = url.searchParams.get("entityId");
    if (!entityType || !entityId) throw new HttpError(400, "entityType and entityId are required.");
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const notes = await listCrmNotes(client, crmContext(session), entityType, entityId, { includeArchived });
    return ok({ notes });
  });
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const body = (await readJson(request)) as { entityType: string; entityId: string; body: string; visibility?: string; isPinned?: boolean };
    const note = await createCrmNote(client, crmContext(session), body.entityType, body.entityId, body);
    return ok({ note }, 201);
  });
}
