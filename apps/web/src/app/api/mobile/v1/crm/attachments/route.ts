import { randomUUID } from "node:crypto";
import { attachmentStorageKey, sha256, validateAttachment } from "@vercentlabs/document-engine";
import { createCrmAttachment, listCrmAttachments } from "@vercentlabs/api";
import { scanAttachmentForUpload } from "@/core/attachment-security";
import { requireBillingWriteAccess, incrementBillingUsage } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";

const ENTITY_TYPES = new Set(["lead", "opportunity", "party", "contact", "campaign"]);
const MAX_BYTES = 5 * 1024 * 1024;

// Mobile/API parity (F017) — ONE generic entity-scoped mobile route for
// attachments, going through the SAME canonical attachments-operations.js
// module (parent authorization, 'crm.<entityType>' storage convention,
// quarantine/scan state, current-version-only listing) every web
// entity-specific attachment route uses — same document-engine validation
// and malware-scan adapter, not a second unsafe upload path.
export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    requireCrmView(session);
    const params = new URL(request.url).searchParams;
    const entityType = String(params.get("entityType") || "");
    const entityId = String(params.get("entityId") || "");
    if (!ENTITY_TYPES.has(entityType)) throw new Error("Unsupported entityType.");
    assertCrmIdentifier(entityId);
    const context = await crmApiContext(session);
    const attachments = await tenantTransaction(context.organizationId, (client) => listCrmAttachments(client, context, entityType, entityId));
    return mobileOk(request, { attachments });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requireMobileSession(request);
    requirePermissionForUpload(session);
    await requireBillingWriteAccess(session.organizationId!);
    const form = await request.formData();
    const entityType = String(form.get("entityType") || "");
    const entityId = String(form.get("entityId") || "");
    if (!ENTITY_TYPES.has(entityType)) throw new Error("Unsupported entityType.");
    assertCrmIdentifier(entityId);
    const file = form.get("file");
    if (!(file instanceof File)) throw new Error("Choose a file to attach.");
    const governed = validateAttachment({ fileName: file.name, mimeType: file.type, sizeBytes: file.size }, { maximumBytes: MAX_BYTES });
    const bytes = Buffer.from(await file.arrayBuffer());
    const scan = await scanAttachmentForUpload(bytes, governed.mimeType);
    const attachmentId = randomUUID();
    const context = await crmApiContext(session);
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const replacesLogicalId = form.get("replacesLogicalId");
    const attachment = await tenantTransaction(context.organizationId, async (client) => {
      const created = await createCrmAttachment(client, context, entityType, entityId, {
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
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.attachment_uploaded", entityType, entityId, afterData: created, request, client });
      return created;
    });
    return mobileOk(request, { message: "Attachment uploaded.", attachment }, 201);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}

function requirePermissionForUpload(session: Awaited<ReturnType<typeof requireMobileSession>>) {
  requireCrmView(session);
}
