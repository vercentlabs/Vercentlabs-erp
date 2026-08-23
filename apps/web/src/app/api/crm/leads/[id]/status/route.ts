import { evaluateLeadReadiness, getCrmRecord, updateCrmRecord } from "@vercentlabs/api";

import { getSessionContext } from "@/core/auth";
import { PERMISSIONS, requirePermissionFromSession } from "@/core/authorization";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { assertCrmIdentifier } from "@/modules/crm/api";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOriginOrMobile, audit } from "@/core/security";

type Params = { params: Promise<{ id: string }> };
const allowed = new Set(["new", "contacted", "working", "qualified", "unqualified"]);

export async function POST(request: Request, { params }: Params) {
  try {
    assertSameOriginOrMobile(request);
    const session = await getSessionContext();
    if (!session?.organizationId) throw new HttpError(401, "Sign in first.");
    requirePermissionFromSession(session, PERMISSIONS.crmLeadsManage);
    await requireBillingWriteAccess(session.organizationId);
    await incrementBillingUsage(session.organizationId, "api_requests_monthly");
    const { id } = await params;
    assertCrmIdentifier(id);
    const input = (await readJson(request)) as Record<string, unknown>;
    const status = String(input.status || "");
    if (!allowed.has(status)) throw new HttpError(400, "Unsupported lead lifecycle status.");
    const reason = String(input.unqualifiedReason || "").trim().slice(0, 2_000);
    if (status === "unqualified" && !reason)
      throw new HttpError(400, "A disqualification reason is required.");
    const context = await crmApiContext(session);
    const record = await tenantTransaction(context.organizationId, async (client) => {
      const before = await getCrmRecord(client, context, "leads", id);
      if (status === "qualified") {
        const readiness = evaluateLeadReadiness({
          full_name: before.fullName,
          first_name: before.firstName,
          last_name: before.lastName,
          email: before.email,
          mobile: before.mobile,
          phone: before.phone,
          company_name: before.companyName,
          product_interest: before.productInterest,
          score: before.score,
          next_follow_up_at: before.nextFollowUpAt,
        });
        if (!readiness.ready) {
          const reasons = Array.isArray(readiness.reasons) ? readiness.reasons.map(String).join("; ") : "Lead is incomplete.";
          throw new HttpError(409, `Lead is not qualification-ready: ${reasons}`);
        }
      }
      const after = await updateCrmRecord(client, context, "leads", id, {
        status,
        unqualifiedReason: status === "unqualified" ? reason : null,
      });
      await audit({
        organizationId: context.organizationId,
        actorUserId: session.userId,
        eventType: "crm.lead.status_changed",
        entityType: "lead",
        entityId: id,
        beforeData: before,
        afterData: after,
        request,
        client,
      });
      return after;
    });
    return ok({ message: `Lead moved to ${status.replaceAll("_", " ")}.`, record });
  } catch (error) {
    try { rethrowCrmError(error); } catch (mapped) { return errorResponse(mapped); }
  }
}
