import { listCrmLeadImportBatches } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permissions: [CRM_PERMISSIONS.import, CRM_PERMISSIONS.leadsManage], action: "crm.leads.import.batches" }, async ({ client, session }) =>
    ok({ batches: await listCrmLeadImportBatches(client, crmContext(session)) }),
  );
}
