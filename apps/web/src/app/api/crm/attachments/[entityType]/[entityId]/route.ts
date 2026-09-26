import { createCrmAttachment, listCrmAttachments, prepareFileUpload } from "@vercentlabs/api";

import { HttpError, ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F017 Attachments. attachments-operations.js (the ONE canonical CRM
// attachment domain service, covering parent-record authorization,
// versioning and audit) does not check a permission internally, matching
// Notes' own documented model — the parent-record access check IS the
// real authorization (resolveCrmEntityAccess, the same function Notes/
// Timeline already use), not a blanket "manage" permission, so this
// route stays module-access-only, same as the Notes routes.
//
// Uploads go through the Shared Platform file pipeline: prepareFileUpload
// (validateAttachment + scanAttachmentForUpload + SHA-256) runs OUTSIDE the
// transaction; createCrmAttachment then stores the bytes in object storage
// and records metadata. Size is capped by validateAttachment (10MB), never
// trusted from the browser's declared Content-Length.
export async function GET(request: Request, context: { params: Promise<{ entityType: string; entityId: string }> }) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { entityType, entityId } = await context.params;
    const rows = await listCrmAttachments(client, crmContext(session), entityType as never, entityId);
    return ok({ rows });
  });
}

export async function POST(request: Request, context: { params: Promise<{ entityType: string; entityId: string }> }) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const { entityType, entityId } = await context.params;

    const form = await request.formData().catch(() => {
      throw new HttpError(400, "A multipart file upload is required.");
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new HttpError(400, "A file is required.");
    const replacesLogicalId = form.get("replacesLogicalId");

    const prepared = await prepareFileUpload({ fileName: file.name, mimeType: file.type, bytes: Buffer.from(await file.arrayBuffer()) }, process.env);

    const record = await createCrmAttachment(client, crmContext(session), entityType as never, entityId, {
      prepared,
      replacesLogicalId: typeof replacesLogicalId === "string" && replacesLogicalId ? replacesLogicalId : undefined,
    });
    return ok({ record }, 201);
  });
}
