import { getLeadBulkJob } from "@vercentlabs/api";

import { withClient } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

export async function GET(_request: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const session = await requireWorkspace();
    const { jobId } = await context.params;
    const job = await withClient(async (client) => {
      await requireCrmAccess(client, session);
      return getLeadBulkJob(client, crmContext(session), jobId);
    });
    return ok({ job });
  } catch (error) {
    return errorResponse(error);
  }
}
