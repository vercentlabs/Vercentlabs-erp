import { getCustomFieldValueHistory } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F028 — custom field change history for one record. Authorization is the
// same parent-record access as reading the values (resolveCrmEntityAccess).
export async function GET(request: Request, context: { params: Promise<{ entityType: string; entityId: string }> }) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { entityType, entityId } = await context.params;
    const rows = await getCustomFieldValueHistory(client, crmContext(session), entityType as never, entityId);
    return ok({ rows });
  });
}
