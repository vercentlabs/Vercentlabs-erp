import { randomUUID } from "node:crypto";
import { attachmentStorageKey, sha256, validateAttachment } from "@vercentlabs/document-engine";
import { getCrmRecord } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { scanAttachmentForUpload } from "@/core/attachment-security";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier } from "@/modules/crm/api";

type Params = { params: Promise<{ id: string }> };
const MAX_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive);
    await requireBillingWriteAccess(session.organizationId);

    const { id } = await params;
    assertCrmIdentifier(id);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "Choose a file to attach.", "CRM_ATTACHMENT_REQUIRED");
    const governed = validateAttachment(
      { fileName: file.name, mimeType: file.type, sizeBytes: file.size },
      { maximumBytes: MAX_BYTES },
    );
    const bytes = Buffer.from(await file.arrayBuffer());
    const scan = await scanAttachmentForUpload(bytes, governed.mimeType);
    const attachmentId = randomUUID();
    const context = await crmApiContext(session);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");

    const attachment = await tenantTransaction(context.organizationId, async (client) => {
      await getCrmRecord(client, context, "leads", id);
      const result = await client.query(
        `INSERT INTO public.attachments(
           id,organization_id,entity_type,entity_id,file_name,storage_key,mime_type,size_bytes,uploaded_by,content,content_sha256,lifecycle_status,scan_status
         ) VALUES($1,$2,'crm.lead',$3,$4,$5,$6,$7,$8,$9,$10,'clean',$11)
         RETURNING id,file_name,mime_type,size_bytes,created_at`,
        [
          attachmentId,
          context.organizationId,
          id,
          governed.fileName,
          attachmentStorageKey({ organizationId: context.organizationId, attachmentId, fileName: governed.fileName }),
          governed.mimeType,
          governed.sizeBytes,
          session.userId,
          bytes,
          sha256(bytes),
          scan.scanStatus,
        ],
      );
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.lead.attachment_uploaded",
        entityType: "lead",
        entityId: id,
        afterData: result.rows[0],
        request,
        client,
      });
      return result.rows[0];
    });
    return ok({ message: "Attachment uploaded.", attachment }, 201);
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) {
      return crmErrorResponse(new HttpError(400, error.message, "CRM_ATTACHMENT_INVALID"));
    }
    return crmErrorResponse(error);
  }
}
