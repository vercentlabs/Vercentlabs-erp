import { archiveCrmNote, getCrmNote, updateCrmNote } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";

type Params = { params: Promise<{ noteId: string }> };

// F017 closeout — a single shared detail route for every Note regardless
// of its parent record type (Lead/Account/Contact/Opportunity/Campaign):
// the real authorization (parent-record access, private-visibility, and
// the author-or-view-all edit/archive rule) all lives inside notes-
// operations.js and is keyed off the Note's own id, so this route needs no
// per-entity-type duplication — requireCrmView() is only the outer "has
// some CRM access at all" gate.
export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const { noteId } = await params;
    assertCrmIdentifier(noteId);
    const context = await crmApiContext(session);
    const note = await tenantTransaction(context.organizationId, (client) => getCrmNote(client, context, noteId));
    return ok({ note });
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { noteId } = await params;
    assertCrmIdentifier(noteId);
    const input = (await readJson(request)) as Record<string, unknown>;
    const context = await crmApiContext(session);
    const note = await tenantTransaction(context.organizationId, async (client) => {
      const updated = await updateCrmNote(client, context, noteId, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.note.updated",
        entityType: "note",
        entityId: noteId,
        afterData: updated,
        request,
        client,
      });
      return updated;
    });
    return ok({ note });
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { noteId } = await params;
    assertCrmIdentifier(noteId);
    const input = (await readJson(request).catch(() => ({}))) as Record<string, unknown>;
    const context = await crmApiContext(session);
    const note = await tenantTransaction(context.organizationId, async (client) => {
      const archived = await archiveCrmNote(client, context, noteId, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.note.archived",
        entityType: "note",
        entityId: noteId,
        afterData: archived,
        request,
        client,
      });
      return archived;
    });
    return ok({ message: "Note archived.", note });
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
