import { releaseCrmTask } from "@vercentlabs/api";
import { requireBillingWriteAccess, incrementBillingUsage } from "@/core/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { assertCrmIdentifier } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";

// Mobile/API parity (F015) — same releaseCrmTask domain function web uses
// (self-release, or Team-manager/view-all override).
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId!);
    const { id } = await params; assertCrmIdentifier(id);
    const input = (await readJson(request).catch(() => ({}))) as Record<string, unknown>;
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const result = await releaseCrmTask(client, context, id, input);
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.task.released", entityType: "task", entityId: id, metadata: { teamId: result.teamId }, request, client });
      return result;
    });
    return mobileOk(request, { message: "Task released back to the queue.", record });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
