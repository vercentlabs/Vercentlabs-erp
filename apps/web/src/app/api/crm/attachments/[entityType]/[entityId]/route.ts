import { randomUUID } from "node:crypto";

import { assertSameOriginOrMobile, createCrmAttachment, listCrmAttachments, scanAttachmentForUpload } from "@vercentlabs/api";
import { attachmentStorageKey, sha256, validateAttachment } from "@vercentlabs/document-engine";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F017 Attachments. attachments-operations.js (the ONE canonical CRM
// attachment domain service, covering parent-record authorization,
// versioning and audit) does not check a permission internally, matching
// Notes' own documented model — the parent-record access check IS the
// real authorization (resolveCrmEntityAccess, the same function Notes/
// Timeline already use), not a blanket "manage" permission, so this
// route stays module-access-only, same as the Notes routes.
//
// Upload validation is layered exactly as the platform's own attachment-
// security/document-engine primitives are designed to be used, never
// re-implemented: document-engine's validateAttachment (size/MIME
// allow-list, filename sanitization) runs first, then attachment-
// security's scanAttachmentForUpload (content-signature-vs-MIME check,
// EICAR/malware rejection, external scanner in production) — only a
// file that survives both ever reaches createCrmAttachment. Content
// bytes are read once, size-capped by validateAttachment's own default
// (10MB), never trusted from the browser's declared Content-Length.
export async function GET(_request: Request, context: { params: Promise<{ entityType: string; entityId: string }> }) {
  try {
    const session = await requireWorkspace();
    const { entityType, entityId } = await context.params;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return listCrmAttachments(client, crmContext(session), entityType as never, entityId);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request, context: { params: Promise<{ entityType: string; entityId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { entityType, entityId } = await context.params;

    const form = await request.formData().catch(() => {
      throw new HttpError(400, "A multipart file upload is required.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "A file is required.");
    const replacesLogicalId = form.get("replacesLogicalId");

    const bytes = Buffer.from(await file.arrayBuffer());
    let validated;
    try {
      validated = validateAttachment({ fileName: file.name, mimeType: file.type, sizeBytes: bytes.length });
    } catch (validationError) {
      throw new HttpError(400, validationError instanceof Error ? validationError.message : "The attachment could not be validated.", "CRM_ATTACHMENT_INVALID");
    }
    const { scanStatus } = await scanAttachmentForUpload(bytes, validated.mimeType, process.env);

    const id = randomUUID();
    const storageKey = attachmentStorageKey({ organizationId: session.organizationId, attachmentId: id, fileName: validated.fileName });
    const contentSha256 = sha256(bytes);

    const record = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return createCrmAttachment(client, crmContext(session), entityType as never, entityId, {
        id,
        fileName: validated.fileName,
        storageKey,
        mimeType: validated.mimeType,
        sizeBytes: validated.sizeBytes,
        content: bytes,
        contentSha256,
        scanStatus,
        replacesLogicalId: typeof replacesLogicalId === "string" && replacesLogicalId ? replacesLogicalId : undefined,
      });
    });
    return ok({ record }, 201);
  } catch (error) {
    return errorResponse(error);
  }
}
