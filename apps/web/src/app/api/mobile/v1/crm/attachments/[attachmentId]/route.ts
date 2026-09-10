import { deleteCrmAttachment, getCrmAttachmentContent } from "@vercentlabs/api";
import { requireBillingWriteAccess, incrementBillingUsage } from "@/core/billing";
import { tenantTransaction } from "@/core/db";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { assertCrmIdentifier, requireCrmView } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";

const ENTITY_TYPES = new Set(["lead", "opportunity", "party", "contact", "campaign"]);

function dispositionFileName(value: unknown) {
  return String(value || "attachment").replace(/[\r\n"\\]/g, "-").slice(0, 180);
}

type Params = { params: Promise<{ attachmentId: string }> };

// Mobile/API parity (F017) — same governed download gate (parent scope →
// quarantine/scan status, all before content) as every web attachment
// route; bytes are streamed by this one authenticated route or not at
// all — no permanent public storage URL handed to the mobile client.
export async function GET(request: Request, { params }: Params) {
  try {
    const session = await requireMobileSession(request);
    requireCrmView(session);
    const searchParams = new URL(request.url).searchParams;
    const entityType = String(searchParams.get("entityType") || "");
    const entityId = String(searchParams.get("entityId") || "");
    if (!ENTITY_TYPES.has(entityType)) throw new Error("Unsupported entityType.");
    assertCrmIdentifier(entityId);
    const { attachmentId } = await params; assertCrmIdentifier(attachmentId);
    const context = await crmApiContext(session);
    const row = await tenantTransaction(context.organizationId, (client) => getCrmAttachmentContent(client, context, entityType, entityId, attachmentId));
    return new Response(row.content, {
      status: 200,
      headers: {
        "Content-Type": String(row.mime_type || "application/octet-stream"),
        "Content-Length": String(row.size_bytes || row.content.length),
        "Content-Disposition": `attachment; filename="${dispositionFileName(row.file_name)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Vercentlabs-API-Version": "mobile-v1",
      },
    });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}

export async function DELETE(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requireMobileSession(request);
    requireCrmView(session);
    await requireBillingWriteAccess(session.organizationId!);
    const searchParams = new URL(request.url).searchParams;
    const entityType = String(searchParams.get("entityType") || "");
    const entityId = String(searchParams.get("entityId") || "");
    if (!ENTITY_TYPES.has(entityType)) throw new Error("Unsupported entityType.");
    assertCrmIdentifier(entityId);
    const { attachmentId } = await params; assertCrmIdentifier(attachmentId);
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    await tenantTransaction(context.organizationId, async (client) => {
      const deleted = await deleteCrmAttachment(client, context, entityType, entityId, attachmentId);
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.attachment_deleted", entityType, entityId, beforeData: deleted, request, client });
    });
    return mobileOk(request, { message: "Attachment removed." });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
