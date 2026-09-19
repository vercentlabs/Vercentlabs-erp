import { assertSameOriginOrMobile, commitLeadImport } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F021 Lead import — stage 2 of 2. Only a batch still in "previewed"
// status can be committed (commitLeadImport's own guard). Each valid row
// goes through the real governed createLead, one row at a time, with the
// batch's own duplicateStrategy applied per row — not a bulk INSERT that
// bypasses Lead creation's normal duplicate/validation rules.
export async function POST(request: Request, context: { params: Promise<{ batchId: string }> }) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const { batchId } = await context.params;
    const batch = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.leadsManage, { mutation: true });
      return commitLeadImport(client, crmContext(session), batchId);
    });
    return ok({ batch });
  } catch (error) {
    return errorResponse(error);
  }
}
