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

// F017 closeout — this route previously had its own inline INSERT and no
// GET at all; it now calls the ONE canonical Notes domain module (see
// notes-operations.js) rather than duplicating parent-record authorization
// and private-visibility filtering a second time.
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
      listCrmNotes(client, context, "lead", id, { includeArchived }),
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
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id } = await params;
    assertCrmIdentifier(id);
    const input = (await readJson(request)) as Record<string, unknown>;
    const context = await crmApiContext(session);
    const note = await tenantTransaction(context.organizationId, async (client) => {
      const created = await createCrmNote(client, context, "lead", id, input);
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.lead.note_created",
        entityType: "lead",
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
