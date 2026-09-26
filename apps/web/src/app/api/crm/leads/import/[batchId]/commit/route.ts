import { commitLeadImport } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

export async function POST(request: Request, context: { params: Promise<{ batchId: string }> }) {
  return workspaceRoute(request, { module: "crm", permissions: [CRM_PERMISSIONS.import, CRM_PERMISSIONS.leadsManage], billingWrite: true, action: "crm.leads.import.commit" }, async ({ client, session }) => {
    const { batchId } = await context.params;
    return ok({ batch: await commitLeadImport(client, crmContext(session), batchId) });
  });
}
