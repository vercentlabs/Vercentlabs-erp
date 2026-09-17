import { assertSameOriginOrMobile, bulkUpdateOpportunities, enqueueOpportunityBulkUpdateJob } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F029 governed Opportunity bulk edit. Only the fields opportunity-
// operations.js's OPPORTUNITY_BULK_FIELDS allowlists (ownerUserId/
// forecastCategory/expectedCloseDate/nextStep) can go through here —
// stage/status/probability/outcome remain single-record governed actions
// (moveOpportunityStage etc.) on purpose. bulkUpdateOpportunities' own
// synchronous cap is 200 (hardcoded in that function, no exported
// constant to import, unlike Lead's LEAD_BULK_SYNC_LIMIT); larger
// selections are queued as a background job. Note a real, disclosed
// difference from Lead's bulk: bulkUpdateOpportunities is a single mass
// UPDATE with only an aggregate updated count, not Lead's per-record
// applied/conflict/skipped/failed manifest — a row outside scope or
// already non-open simply isn't included in the count, with no per-ID
// reason surfaced.
const OPPORTUNITY_BULK_SYNC_LIMIT = 200;

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request)) as {
      ids?: string[];
      changes?: Record<string, unknown>;
      idempotencyKey?: string;
    };
    const ids = Array.isArray(input.ids) ? input.ids : [];
    if (!ids.length) throw new HttpError(400, "Select at least one Opportunity.");

    if (ids.length <= OPPORTUNITY_BULK_SYNC_LIMIT) {
      const result = await tenantTransaction(session.organizationId, async (client) => {
        await requireCrmAccess(client, session, CRM_PERMISSIONS.opportunitiesManage);
        return bulkUpdateOpportunities(client, crmContext(session), { ids, changes: input.changes });
      });
      return ok({ mode: "synchronous", ...result });
    }

    if (!input.idempotencyKey) throw new HttpError(400, "A large Opportunity selection requires an idempotency key.");
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.opportunitiesManage);
      return enqueueOpportunityBulkUpdateJob(client, crmContext(session), {
        selection: { type: "explicit", ids },
        changes: input.changes,
        idempotencyKey: input.idempotencyKey,
      });
    });
    return ok(result, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
