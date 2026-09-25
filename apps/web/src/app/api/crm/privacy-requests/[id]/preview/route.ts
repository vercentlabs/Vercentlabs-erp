import { previewPrivacyRequest } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// Read-only: computes whether a DSR is ready to execute (identity
// verified, not already terminal, subject not under legal hold) and the
// record counts it would touch, without changing anything. Backed by
// account-intelligence.js's previewPrivacyRequest, which already existed
// but had no caller.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { id } = await context.params;
    const preview = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.privacyManage);
      return previewPrivacyRequest(client, crmContext(session), id);
    });
    return ok({ preview });
  } catch (error) {
    return errorResponse(error);
  }
}
