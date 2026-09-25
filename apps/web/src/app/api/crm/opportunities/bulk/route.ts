import { assertSameOriginOrMobile, bulkUpdateOpportunities, enqueueOpportunityBulkUpdateJob } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F029 governed Opportunity bulk edit. Only the fields opportunity-
// operations.js's OPPORTUNITY_BULK_FIELDS allowlists (ownerUserId/
// expectedCloseDate/nextStep) can go through here — stage/status/
// probability/forecast/outcome remain single-record governed actions.
// Up to 200 records run synchronously, each through the single-record
// command with a per-record result (applied/conflict/skipped/failed);
// `preview: true` runs the same rules and rolls back. Larger selections are
// queued as a background job with the same per-record manifest.
const OPPORTUNITY_BULK_SYNC_LIMIT = 200;

export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request)) as {
      ids?: string[];
      changes?: Record<string, unknown>;
      idempotencyKey?: string;
      preview?: boolean;
      expectedVersions?: Record<string, string>;
    };
    const ids = Array.isArray(input.ids) ? input.ids : [];
    if (!ids.length) throw new HttpError(400, "Select at least one Opportunity.");

    if (ids.length <= OPPORTUNITY_BULK_SYNC_LIMIT) {
      const result = await tenantTransaction(session.organizationId, async (client) => {
        await requireCrmAccess(client, session, CRM_PERMISSIONS.opportunitiesManage, { mutation: true });
        return bulkUpdateOpportunities(client, crmContext(session), { ids, changes: input.changes, preview: input.preview === true, expectedVersions: input.expectedVersions });
      });
      return ok({ mode: "synchronous", ...result });
    }

    if (input.preview) throw new HttpError(400, "Preview is available for up to 200 Opportunities at a time.");
    if (!input.idempotencyKey) throw new HttpError(400, "A large Opportunity selection requires an idempotency key.");
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.opportunitiesManage, { mutation: true });
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
