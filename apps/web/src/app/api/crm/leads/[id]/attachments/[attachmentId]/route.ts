import { getCrmRecord } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";

type Params = { params: Promise<{ id: string; attachmentId: string }> };

function dispositionFileName(value: unknown) {
  return String(value || "attachment").replace(/[\r\n"\\]/g, "-").slice(0, 180);
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const { id, attachmentId } = await params;
    assertCrmIdentifier(id);
    assertCrmIdentifier(attachmentId);
    const context = await crmApiContext(session);
    const row = await tenantTransaction(context.organizationId, async (client) => {
      await getCrmRecord(client, context, "leads", id);
      const result = await client.query(
        `SELECT file_name,mime_type,size_bytes,content
           FROM public.attachments
          WHERE organization_id=$1 AND id=$2 AND entity_type='crm.lead' AND entity_id=$3
          LIMIT 1`,
        [context.organizationId, attachmentId, id],
      );
      if (!result.rows[0]?.content) throw new HttpError(404, "Attachment not found.");
      return result.rows[0];
    });
    return new Response(row.content, {
      status: 200,
      headers: {
        "Content-Type": String(row.mime_type || "application/octet-stream"),
        "Content-Length": String(row.size_bytes || row.content.length),
        "Content-Disposition": `attachment; filename="${dispositionFileName(row.file_name)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    await requireBillingWriteAccess(session.organizationId);
    const { id, attachmentId } = await params;
    assertCrmIdentifier(id);
    assertCrmIdentifier(attachmentId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    await tenantTransaction(context.organizationId, async (client) => {
      await getCrmRecord(client, context, "leads", id);
      const result = await client.query(
        `DELETE FROM public.attachments
          WHERE organization_id=$1 AND id=$2 AND entity_type='crm.lead' AND entity_id=$3
          RETURNING id,file_name,mime_type,size_bytes`,
        [context.organizationId, attachmentId, id],
      );
      if (!result.rows[0]) throw new HttpError(404, "Attachment not found.");
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.lead.attachment_deleted",
        entityType: "lead",
        entityId: id,
        beforeData: result.rows[0],
        request,
        client,
      });
    });
    return ok({ message: "Attachment removed." });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
