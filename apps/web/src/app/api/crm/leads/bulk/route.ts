import { assertSameOriginOrMobile, bulkUpdateLeads, enqueueLeadBulkUpdateJob, LEAD_BULK_SYNC_LIMIT } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, HttpError, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F029 governed Lead bulk edit. Only the fields lead-operations.js's
// normalizeLeadBulkChanges allowlists (sourceId/nextFollowUpAt/priority/
// rating) can go through here — ownership, stage/lifecycle and
// qualification remain single-record governed actions on purpose (see
// that function's own explicit rejections), so this route never offers a
// bulk "archive" or "assign" that the domain itself refuses to support.
// Selections at or under LEAD_BULK_SYNC_LIMIT run synchronously with a
// real per-record success/failure manifest; larger selections are queued
// as a background job (see /api/crm/leads/bulk/jobs/[jobId] for status).
// Neither bulkUpdateLeads nor enqueueLeadBulkUpdateJob checks a permission
// internally, so this route enforces crm.leads.manage itself.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request)) as {
      ids?: string[];
      changes?: Record<string, unknown>;
      expectedVersions?: Record<string, string>;
      idempotencyKey?: string;
    };
    const ids = Array.isArray(input.ids) ? input.ids : [];
    if (!ids.length) throw new HttpError(400, "Select at least one Lead.");

    if (ids.length <= LEAD_BULK_SYNC_LIMIT) {
      const result = await tenantTransaction(session.organizationId, async (client) => {
        await requireCrmAccess(client, session, CRM_PERMISSIONS.leadsManage);
        return bulkUpdateLeads(client, crmContext(session), {
          ids,
          changes: input.changes,
          expectedVersions: input.expectedVersions,
        });
      });
      return ok(result);
    }

    if (!input.idempotencyKey) throw new HttpError(400, "A large Lead selection requires an idempotency key.");
    const result = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.leadsManage);
      return enqueueLeadBulkUpdateJob(client, crmContext(session), {
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
