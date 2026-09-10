import { randomUUID } from "node:crypto";
import { attachmentStorageKey, sha256, validateAttachment } from "@vercentlabs/document-engine";
import { createCrmAttachment, listCrmAttachments } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { scanAttachmentForUpload } from "@/core/attachment-security";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { HttpError, ok } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { crmApiContext, crmErrorResponse } from "@/modules/crm";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/api";

type Params = { params: Promise<{ id: string }> };
const MAX_BYTES = 5 * 1024 * 1024;

// F017 closeout — Account previously had no governed attachment support at
// all. Same canonical attachment domain module Lead already uses
// (attachments-operations.js), entityType 'party'.
export async function GET(_request: Request, { params }: Params) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requireCrmView(session);
    const { id } = await params;
    assertCrmIdentifier(id);
    const context = await crmApiContext(session);
    const attachments = await tenantTransaction(context.organizationId, (client) => listCrmAttachments(client, context, "party", id));
    return ok({ attachments });
  } catch (error) {
    return crmErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.partiesManage);
    requirePermissionFromSession(session, PERMISSIONS.crmAccountsViewSensitive);
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
    const replacesLogicalId = form.get("replacesLogicalId");

    const attachment = await tenantTransaction(context.organizationId, async (client) => {
      const created = await createCrmAttachment(client, context, "party", id, {
        id: attachmentId,
        fileName: governed.fileName,
        storageKey: attachmentStorageKey({ organizationId: context.organizationId, attachmentId, fileName: governed.fileName }),
        mimeType: governed.mimeType,
        sizeBytes: governed.sizeBytes,
        content: bytes,
        contentSha256: sha256(bytes),
        scanStatus: scan.scanStatus,
        ...(typeof replacesLogicalId === "string" && replacesLogicalId ? { replacesLogicalId } : {}),
      });
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.account.attachment_uploaded",
        entityType: "party",
        entityId: id,
        afterData: created,
        request,
        client,
      });
      return created;
    });
    return ok({ message: "Attachment uploaded.", attachment }, 201);
  } catch (error) {
    if (error instanceof RangeError || error instanceof TypeError) {
      return crmErrorResponse(new HttpError(400, error.message, "CRM_ATTACHMENT_INVALID"));
    }
    return crmErrorResponse(error);
  }
}
