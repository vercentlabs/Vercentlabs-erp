import { getCrmRecord } from "@vercentlabs/api";

import { getSessionContext } from "@/lib/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/lib/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/lib/billing";
import { assertCrmIdentifier } from "@/lib/crm-api";
import { crmApiContext, rethrowCrmError } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";
import { errorResponse, HttpError, ok, readJson } from "@/lib/http";
import { assertSameOriginOrMobile, audit } from "@/lib/security";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id } = await params;
    assertCrmIdentifier(id);
    const input = (await readJson(request)) as Record<string, unknown>;
    const body = String(input.body || "").trim().slice(0, 20_000);
    if (!body) throw new HttpError(400, "Note text is required.");
    const context = await crmApiContext(session);
    const note = await tenantTransaction(context.organizationId, async (client) => {
      await getCrmRecord(client, context, "leads", id);
      const result = await client.query(
        `INSERT INTO tenant.crm_notes(
           organization_id,entity_type,entity_id,body,is_pinned,created_by,updated_by
         ) VALUES($1,'lead',$2,$3,$4,$5,$5) RETURNING *`,
        [context.organizationId, id, body, Boolean(input.isPinned), session.userId],
      );
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.lead.note_created",
        entityType: "lead",
        entityId: id,
        afterData: result.rows[0],
        request,
        client,
      });
      return result.rows[0];
    });
    return ok({ note }, 201);
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
