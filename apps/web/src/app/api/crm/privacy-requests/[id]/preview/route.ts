import { previewPrivacyRequest } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// Read-only: computes whether a DSR is ready to execute (identity
// verified, not already terminal, subject not under legal hold) and the
// record counts it would touch, without changing anything. Backed by
// account-intelligence.js's previewPrivacyRequest, which already existed
// but had no caller.
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.privacyManage }, async ({ client, session }) => {
    const { id } = await context.params;
    const preview = await previewPrivacyRequest(client, crmContext(session), id);
    return ok({ preview });
  });
}
