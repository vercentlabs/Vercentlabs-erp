import { createCrmNote, listCrmNotes } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";

type Params = { params: Promise<{ id: string }> };

// F017 closeout — Contact previously had no Notes support at all. Same
// canonical Notes domain module Lead/Account already use (notes-
// operations.js), entityType 'contact'. Write gate mirrors contacts/[id]/
// route.ts's own choice of partiesManage (there is no separate
// crm.contacts.manage permission key in this codebase).
export async function GET(request: Request, { params }: Params) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const { id } = await params;
    assertCrmIdentifier(id);
    const url = new URL(request.url);
    const includeArchived = url.searchParams.get("includeArchived") === "true";
    const context = await crmApiContext(session);
    const notes = await tenantTransaction(context.organizationId, (client) =>
      listCrmNotes(client, context, "contact", id, { includeArchived }),
    );
    return ok({ notes });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.partiesManage);
    requirePermissionFromSession(session, PERMISSIONS.crmContactsViewSensitive);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id } = await params;
    assertCrmIdentifier(id);
    const input = (await readJson(request)) as Record<string, unknown>;
    const context = await crmApiContext(session);
    const note = await tenantTransaction(context.organizationId, async (client) => {
      const created = await createCrmNote(client, context, "contact", id, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.contact.note_created",
        entityType: "contact",
        entityId: id,
        afterData: created,
        request,
        client,
      });
      return created;
    });
    return ok({ note }, 201);
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
