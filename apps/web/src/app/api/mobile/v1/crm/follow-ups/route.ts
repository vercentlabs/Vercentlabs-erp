import { createCrmFollowUp, listCrmFollowUps } from "@vercentlabs/api";
import { requireBillingWriteAccess, incrementBillingUsage } from "@/core/billing";
import { requirePermissionFromSession, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { requireMobileSession } from "@/core/mobile-session";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { assertSameOriginOrMobile, audit } from "@/core/security";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { crmFollowUpAuditSnapshot } from "@/modules/crm/audit";
import { createFollowUpSchema } from "@/modules/crm/validation";

// Mobile/API parity (F016) — same createCrmFollowUp/listCrmFollowUps and
// the SAME createFollowUpSchema web uses, not a mobile-only re-derived
// shape. Reminder scheduling stays entirely server-side (F016's real
// worker), so there is nothing mobile-specific to duplicate.
export async function GET(request: Request) {
  try {
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmView);
    const context = await crmApiContext(session);
    const params = new URL(request.url).searchParams;
    const result = await tenantTransaction(context.organizationId, (client) =>
      listCrmFollowUps(client, context, {
        search: params.get("search") || "",
        status: params.get("status") || "all",
        due: params.get("due") || "all",
        limit: params.get("limit") || 25,
        offset: params.get("offset") || 0,
      }),
    );
    return mobileOk(request, result);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request);
    const session = await requireMobileSession(request);
    requirePermissionFromSession(session, PERMISSIONS.crmActivitiesManage);
    await requireBillingWriteAccess(session.organizationId!);
    const input = createFollowUpSchema.parse(await readJson(request));
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) =>
      withMobileIdempotency(client, session, request, input, async () => {
        const created = await createCrmFollowUp(client, context, input);
        await audit({
          organizationId: context.organizationId,
          actorUserId: session.userId,
          eventType: "crm.follow_up.created",
          entityType: "follow_up",
          entityId: String(created.id),
          afterData: crmFollowUpAuditSnapshot(created),
          request,
          client,
        });
        return { message: "Follow-up scheduled.", record: created };
      }),
    );
    return mobileOk(request, response, 201);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
