import { deleteCrmAttachment, getCrmAttachmentContent } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";

type Params = { params: Promise<{ id: string; attachmentId: string }> };

function dispositionFileName(value: unknown) {
  return String(value || "attachment").replace(/[\r\n"\\]/g, "-").slice(0, 180);
}

export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    requirePermissionFromSession(session, PERMISSIONS.crmAccountsViewSensitive);
    const { id, attachmentId } = await params;
    assertCrmIdentifier(id);
    assertCrmIdentifier(attachmentId);
    const context = await crmApiContext(session);
    const row = await tenantTransaction(context.organizationId, (client) => getCrmAttachmentContent(client, context, "party", id, attachmentId));
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
    requirePermissionFromSession(session, PERMISSIONS.partiesManage);
    requirePermissionFromSession(session, PERMISSIONS.crmAccountsViewSensitive);
    await requireBillingWriteAccess(session.organizationId);
    const { id, attachmentId } = await params;
    assertCrmIdentifier(id);
    assertCrmIdentifier(attachmentId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const context = await crmApiContext(session);
    await tenantTransaction(context.organizationId, async (client) => {
      const deleted = await deleteCrmAttachment(client, context, "party", id, attachmentId);
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.account.attachment_deleted",
        entityType: "party",
        entityId: id,
        beforeData: deleted,
        request,
        client,
      });
    });
    return ok({ message: "Attachment removed." });
  } catch (error) {
    return crmErrorResponse(error);
  }
}
