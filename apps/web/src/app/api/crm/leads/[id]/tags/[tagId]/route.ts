import { removeRecordTag } from "@vercentlabs/api";

import { ok } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

export async function DELETE(request: Request, context: { params: Promise<{ id: string; tagId: string }> }) {
  return workspaceRoute(request, { module: "crm", billingWrite: true }, async ({ client, session }) => {
    const { id, tagId } = await context.params;
    const rows = await removeRecordTag(client, crmContext(session), "lead", id, tagId);
    return ok({ rows });
  });
}
