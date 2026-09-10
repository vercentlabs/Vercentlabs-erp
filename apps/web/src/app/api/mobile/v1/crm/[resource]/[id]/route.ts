import { archiveCrmRecord, getCrmRecord, updateCrmRecord } from "@vercentlabs/api";
import type { CrmResourceKey } from "@vercentlabs/shared-types";
import { incrementBillingUsage, requireBillingWriteAccess } from "@/core/billing";
import { assertCrmIdentifier, requireCrmManage, requireCrmResourceView } from "@/modules/crm/api";
import { crmApiContext, isCrmDefinition, rethrowCrmError } from "@/modules/crm";
import { crmPatchSchemas } from "@/modules/crm/validation";
import { getLeadDetailData } from "@/modules/crm/server/lead-detail-data";
import { getOpportunityDetailData } from "@/modules/crm/server/opportunity-detail-data";
import { tenantTransaction } from "@/core/db";
import { HttpError, readJson } from "@/core/http";
import { mobileError, mobileOk } from "@/core/mobile-http";
import { withMobileIdempotency } from "@/core/mobile-idempotency";
import { requireMobileSession } from "@/core/mobile-session";
import { audit } from "@/core/security";
import { crmAuditSnapshot } from "@/modules/crm/audit";

function valid(resource: string): asserts resource is CrmResourceKey {
  if (!isCrmDefinition(resource)) throw new HttpError(404, "Unknown CRM resource.");
  if (resource === "sources")
    throw new HttpError(410, "Use the responsive CRM Setup Lead Sources workspace.", "CRM_LEAD_SOURCE_API_MOVED");
}

export async function GET(request: Request, route: { params: Promise<{ resource: string; id: string }> }) {
  try {
    const session = await requireMobileSession(request);
    const { resource, id } = await route.params;
    valid(resource); assertCrmIdentifier(id); requireCrmResourceView(session, resource);
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, async (client) => {
      if (resource === "leads") {
        // Route through the same canonical, permission-gated projection the
        // web Lead detail page uses (getLeadDetailData) instead of querying
        // sensitive related tables (activities/communications/notes/score
        // history/duplicates) directly. That keeps ordinary
        // crm.leads.view (record-level) access from ever implying
        // crm.leads.view_sensitive (related-content) access on this surface,
        // matching web's behavior exactly rather than re-deriving it here.
        const detail = await getLeadDetailData(client, context, id);
        return {
          record: detail.lead,
          related: {
            activities: detail.activities,
            communications: detail.communications,
            notes: detail.notes,
            scoreHistory: detail.scoreHistory,
            opportunities: detail.opportunities,
            duplicates: detail.duplicates,
          },
        };
      }
      if (resource === "opportunities") {
        // Prompts 1-5 integrity closeout (blocker B): routes through the
        // same canonical, permission-gated projection the web Opportunity
        // 360 page uses (getOpportunityDetailData) instead of re-deriving
        // the sensitive-content gate and related-collection limits here —
        // this is exactly how mobile and web previously drifted (mobile
        // only ever fetched 5 of the ~14 related collections web shows, and
        // maintained its own separate copy of the same permission check).
        const detail = await getOpportunityDetailData(client, context, id);
        return {
          record: detail.opportunity,
          related: {
            history: detail.history,
            probabilityHistory: detail.probabilityHistory,
            activities: detail.activities,
            communications: detail.communications,
            items: detail.items,
            team: detail.team,
            competitors: detail.competitors,
            risks: detail.risks,
            committees: detail.committees,
            committeeMembers: detail.committeeMembers,
            actionPlan: detail.actionPlan,
            actionPlanEvaluation: detail.actionPlanEvaluation,
            winLossReview: detail.winLossReview,
            quotations: detail.quotations,
            stageAge: detail.stageAge,
          },
        };
      }
      const record = await getCrmRecord(client, context, resource, id);
      return { record, related: {} };
    });
    return mobileOk(request, result);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}

export async function PATCH(request: Request, route: { params: Promise<{ resource: string; id: string }> }) {
  try {
    const session = await requireMobileSession(request);
    const { resource, id } = await route.params;
    valid(resource);
    if (resource === "stages") throw new HttpError(410, "Use the governed Sales Stages workspace on Web.", "CRM_SALES_STAGE_API_MOVED");
    assertCrmIdentifier(id); requireCrmManage(session, resource);
    await requireBillingWriteAccess(session.organizationId!);
    const rawInput = (await readJson(request)) as Record<string, unknown>;
    const expectedUpdatedAt =
      resource === "leads" ? String(rawInput.expectedUpdatedAt || "").trim() : "";
    if (resource === "leads") {
      if (!expectedUpdatedAt)
        throw new HttpError(
          400,
          "Refresh this Lead before changing it.",
          "CRM_LEAD_VERSION_REQUIRED",
        );
      delete rawInput.expectedUpdatedAt;
    }
    if (resource === "leads" && ["status", "stage", "stageId", "stageCode", "recordStatus"].some((field) => Object.prototype.hasOwnProperty.call(rawInput, field)))
      throw new HttpError(409, "Use the governed Lead lifecycle transition action.", "CRM_LEAD_STAGE_ACTION_REQUIRED");
    const input = await crmPatchSchemas[resource].parseAsync(rawInput);
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) =>
      withMobileIdempotency(
        client,
        session,
        request,
        resource === "leads" ? { ...input, expectedUpdatedAt } : input,
        async () => {
          const record = await updateCrmRecord(
            client,
            context,
            resource,
            id,
            input,
            resource === "leads"
              ? { expectedUpdatedAt, requireVersion: true }
              : undefined,
          );
          await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: `crm.${resource}.updated`, entityType: resource, entityId: id, afterData: crmAuditSnapshot(resource, record, Object.keys(input)), request, client });
          return { message: "CRM record updated.", record };
        },
      ),
    );
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}

export async function DELETE(request: Request, route: { params: Promise<{ resource: string; id: string }> }) {
  try {
    const session = await requireMobileSession(request);
    const { resource, id } = await route.params;
    valid(resource);
    if (resource === "stages") throw new HttpError(410, "Use the governed Sales Stages workspace on Web.", "CRM_SALES_STAGE_API_MOVED");
    assertCrmIdentifier(id); requireCrmManage(session, resource);
    const expectedUpdatedAt =
      resource === "leads"
        ? String(new URL(request.url).searchParams.get("expectedUpdatedAt") || "").trim()
        : "";
    if (resource === "leads" && !expectedUpdatedAt)
      throw new HttpError(
        400,
        "Refresh this Lead before archiving it.",
        "CRM_LEAD_VERSION_REQUIRED",
      );
    await requireBillingWriteAccess(session.organizationId!);
    await incrementBillingUsage(session.organizationId!, "api_requests_monthly");
    const context = await crmApiContext(session);
    const response = await tenantTransaction(context.organizationId, (client) =>
      withMobileIdempotency(client, session, request, { archive: true }, async () => {
        const record = await archiveCrmRecord(
          client,
          context,
          resource,
          id,
          resource === "leads"
            ? { expectedUpdatedAt, requireVersion: true }
            : undefined,
        );
        await audit({ organizationId: context.organizationId, actorUserId: session.userId, eventType: `crm.${resource}.archived`, entityType: resource, entityId: id, afterData: crmAuditSnapshot(resource, record), request, client });
        return { message: "CRM record archived.", record };
      }),
    );
    return mobileOk(request, response);
  } catch (error) { try { rethrowCrmError(error); } catch (mapped) { return mobileError(request, mapped); } }
}
