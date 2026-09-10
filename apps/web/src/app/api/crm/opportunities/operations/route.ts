import {
  bulkUpdateOpportunities,
  cancelOpportunityBulkJob,
  captureForecastSnapshot,
  enqueueOpportunityBulkUpdateJob,
  getOpportunityBulkJob,
  getOpportunityDashboard,
  getOpportunityTimeline,
  retryFailedOpportunityBulkJobItems,
} from "@vercentlabs/api";
import { getSessionContext } from "@/core/auth";
import { requireCrmManage } from "@/modules/crm/crm-data-operations-and-customization/resource-access";
import { crmApiContext, rethrowCrmError } from "@/modules/crm";
import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { assertSameOrigin } from "@/core/security";
// F029 (Bulk actions) — LAST PROMPT 1/3 closeout: GET now also serves a
// bulk-job's status (?jobId=...), mirroring apps/web/src/app/api/crm/leads/
// operations/route.ts. POST gained enqueue-bulk-update/cancel-bulk-job/
// retry-bulk-job actions so a filter-snapshot selection larger than
// bulkUpdateOpportunities' synchronous 200-record cap has a real path
// instead of an outright 400 rejection.
export async function GET(request: Request) {
  try {
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requireCrmManage(session, "opportunities");
    const context = await crmApiContext(session);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    const jobId = url.searchParams.get("jobId");
    return ok(
      await tenantTransaction(context.organizationId, (client) =>
        jobId
          ? getOpportunityBulkJob(client, context, jobId)
          : id
            ? getOpportunityTimeline(client, context, id)
            : getOpportunityDashboard(client, context),
      ),
    );
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const session = await getSessionContext();
    if (!session?.organizationId)
      throw new HttpError(401, "Sign in to an organisation workspace.");
    requireCrmManage(session, "opportunities");
    const input = (await readJson(request)) as Record<string, unknown>;
    const context = await crmApiContext(session);
    const result = await tenantTransaction(context.organizationId, (client) =>
      input.action === "bulk-update"
        ? bulkUpdateOpportunities(client, context, input)
        : input.action === "enqueue-bulk-update"
          ? enqueueOpportunityBulkUpdateJob(client, context, input)
          : input.action === "cancel-bulk-job"
            ? cancelOpportunityBulkJob(client, context, String(input.jobId || ""))
            : input.action === "retry-bulk-job"
              ? retryFailedOpportunityBulkJobItems(client, context, String(input.jobId || ""))
              : input.action === "capture-forecast" && typeof input.id === "string"
                ? captureForecastSnapshot(client, context, input.id)
                : Promise.reject(
                    new HttpError(400, "Unsupported opportunity operation."),
                  ),
    );
    return ok(result);
  } catch (error) {
    try {
      rethrowCrmError(error);
    } catch (mapped) {
      return errorResponse(mapped);
    }
  }
}
