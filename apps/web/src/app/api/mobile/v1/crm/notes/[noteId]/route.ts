import { archiveCrmNote, getCrmNote, updateCrmNote } from "@vercentlabs/api";
import { requireBillingWriteAccess, incrementBillingUsage } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";

type Params = { params: Promise<{ noteId: string }> };

// Mobile/API parity (F017) — same shared detail route shape as web's
// /api/crm/notes/[noteId]: the real authorization (parent-record access,
// private-visibility, author-or-view-all edit/archive rule) lives entirely
// inside notes-operations.js, keyed off the Note's own id.
export async function GET(request: Request, { params }: Params) {
  try {
    const session = await requireMobileSession(request);
    requireCrmView(session);
    const { noteId } = await params; assertCrmIdentifier(noteId);
    const context = await crmApiContext(session);
    const note = await tenantTransaction(context.organizationId, (client) => getCrmNote(client, context, noteId));
    return mobileOk(request, { note });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}

export async function PATCH(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requireMobileSession(request);
    requireCrmView(session);
    await requireBillingWriteAccess(session.organizationId!);
    const { noteId } = await params; assertCrmIdentifier(noteId);
    const input = (await readJson(request)) as Record<string, unknown>;
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) =>
      withMobileIdempotency(client, session, request, input, async () => {
        const updated = await updateCrmNote(client, context, noteId, input);
        await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.note_updated", entityType: "note", entityId: noteId, afterData: updated, request, client });
        return { note: updated };
      }),
    );
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requireMobileSession(request);
    requireCrmView(session);
    await requireBillingWriteAccess(session.organizationId!);
    const { noteId } = await params; assertCrmIdentifier(noteId);
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const note = await tenantTransaction(context.organizationId, async (client) => {
      const archived = await archiveCrmNote(client, context, noteId);
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.note_archived", entityType: "note", entityId: noteId, afterData: archived, request, client });
      return archived;
    });
    return mobileOk(request, { note });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
