import { claimCrmTask } from "@vercentlabs/api";
import { requireBillingWriteAccess, incrementBillingUsage } from "@/core/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { assertCrmIdentifier } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";

// Mobile/API parity (F015) — the SAME claimCrmTask atomic-claim function
// web's queue UI uses (UPDATE ... WHERE assigned_to IS NULL — Postgres's
// row-lock re-check is the real concurrency guarantee); a losing race
// returns the same typed CRM_TASK_CLAIM_CONFLICT a mobile client can
// render as an understandable message, not a generic error.
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
      const result = await claimCrmTask(client, context, id, input);
      await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: "crm.task.claimed", entityType: "task", entityId: id, metadata: { teamId: result.teamId, assignedTo: result.assignedTo }, request, client });
      return result;
    });
    return mobileOk(request, { message: "Task claimed.", record });
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
