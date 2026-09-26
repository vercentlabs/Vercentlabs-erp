import { deleteCrmAttachment } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function DELETE(request: Request, context: { params: Promise<{ entityType: string; entityId: string; id: string }> }) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const { entityType, entityId, id } = await context.params;
    const record = await deleteCrmAttachment(client, crmContext(session), entityType as never, entityId, id);
    return ok({ record });
  });
}
