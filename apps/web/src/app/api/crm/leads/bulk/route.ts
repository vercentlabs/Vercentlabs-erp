import { bulkUpdateLeads, enqueueLeadBulkUpdateJob, LEAD_BULK_SYNC_LIMIT } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Bulk Lead update: up to LEAD_BULK_SYNC_LIMIT synchronously (with an
// optional preview), larger selections as an idempotent background job.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsManage, billingWrite: true, action: "crm.leads.bulk_update" }, async ({ client, session }) => {
    const input = (await readJson(request)) as { ids?: string[]; changes?: Record<string, unknown>; expectedVersions?: Record<string, string>; idempotencyKey?: string; preview?: boolean };
    const ids = Array.isArray(input.ids) ? input.ids : [];
    if (!ids.length) throw new HttpError(400, "Select at least one Lead.");
    if (ids.length <= LEAD_BULK_SYNC_LIMIT) {
      return ok(await bulkUpdateLeads(client, crmContext(session), { ids, changes: input.changes, expectedVersions: input.expectedVersions, preview: input.preview === true }));
    }
    if (input.preview) throw new HttpError(400, `Preview is available for up to ${LEAD_BULK_SYNC_LIMIT} Leads at a time.`);
    if (!input.idempotencyKey) throw new HttpError(400, "A large Lead selection requires an idempotency key.");
    const job = await enqueueLeadBulkUpdateJob(client, crmContext(session), { selection: { type: "explicit", ids }, changes: input.changes, idempotencyKey: input.idempotencyKey });
    return ok(job, 202);
  });
}
