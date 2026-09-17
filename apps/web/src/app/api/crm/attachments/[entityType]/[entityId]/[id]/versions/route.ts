import { listCrmAttachmentVersions } from "@vercentlabs/api";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// `id` here is a logical_id (a version's own row id is also a valid
// logical_id lookup target only for its own version — listCrmAttachmentVersions
// takes the logical file's stable identifier, not a specific version row).
export async function GET(_request: Request, context: { params: Promise<{ entityType: string; entityId: string; id: string }> }) {
  try {
    const session = await requireWorkspace();
    const { entityType, entityId, id } = await context.params;
    const rows = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session);
      return listCrmAttachmentVersions(client, crmContext(session), entityType as never, entityId, id);
    });
    return ok({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}
