import { bulkUpdateOpportunities, enqueueOpportunityBulkUpdateJob } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

const OPPORTUNITY_BULK_SYNC_LIMIT = 200;

// Bulk Opportunity update: up to 200 synchronously (with an optional
// preview), larger selections as an idempotent background job.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManage, billingWrite: true, action: "crm.opportunities.bulk_update" }, async ({ client, session }) => {
    const input = (await readJson(request)) as { ids?: string[]; changes?: Record<string, unknown>; idempotencyKey?: string; preview?: boolean; expectedVersions?: Record<string, string> };
    const ids = Array.isArray(input.ids) ? input.ids : [];
    if (!ids.length) throw new HttpError(400, "Select at least one Opportunity.");
    if (ids.length <= OPPORTUNITY_BULK_SYNC_LIMIT) {
      const result = await bulkUpdateOpportunities(client, crmContext(session), { ids, changes: input.changes, preview: input.preview === true, expectedVersions: input.expectedVersions });
      return ok({ mode: "synchronous", ...result });
    }
    if (input.preview) throw new HttpError(400, "Preview is available for up to 200 Opportunities at a time.");
    if (!input.idempotencyKey) throw new HttpError(400, "A large Opportunity selection requires an idempotency key.");
    const job = await enqueueOpportunityBulkUpdateJob(client, crmContext(session), { selection: { type: "explicit", ids }, changes: input.changes, idempotencyKey: input.idempotencyKey });
    return ok(job, 202);
  });
}
