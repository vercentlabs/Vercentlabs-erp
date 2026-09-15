import { assertSameOriginOrMobile, createCrmNote, listCrmNotes } from "@vercentlabs/api";

import { tenantTransaction, withClient } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F017 Notes — composed into Lead/Account/Contact/Opportunity 360s, never
// a standalone global screen. notes-operations.js is the ONE domain
// authority: parent-record authorization is entirely resolveCrmEntityAccess
// (the same gate Timeline uses), and author-or-view-all governs edit/
// archive — no additional crm.<x>.manage permission is layered on top,
// since access here is inherited from "can you see the parent record,"
// not a separate resource-level grant.
export async function GET(request: Request) {
  try {
    const session = await requireWorkspace();
    const url = new URL(request.url);
    const entityType = url.searchParams.get("entityType");
    const entityId = url.searchParams.get("entityId");
    if (!entityType || !entityId) throw new HttpError(400, "entityType and entityId are required.");
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const notes = await withClient(async (client) => {
      await requireCrmAccess(client, session);
      return listCrmNotes(client, crmContext(session), entityType, entityId, { includeArchived });
    });
    return ok({ notes });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const body = (await readJson(request)) as { entityType: string; entityId: string; body: string; visibility?: string; isPinned?: boolean };
    const note = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return createCrmNote(client, crmContext(session), body.entityType, body.entityId, body);
    });
    return ok({ note }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
