import { listCrmAttachmentVersions } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// `id` here is a logical_id (a version's own row id is also a valid
// logical_id lookup target only for its own version — listCrmAttachmentVersions
// takes the logical file's stable identifier, not a specific version row).
export async function GET(request: Request, context: { params: Promise<{ entityType: string; entityId: string; id: string }> }) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session }) => {
    const { entityType, entityId, id } = await context.params;
    const rows = await listCrmAttachmentVersions(client, crmContext(session), entityType as never, entityId, id);
    return ok({ rows });
  });
}
