import { getLeadImportBatch } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F021 progress and result of one import batch (its creator, or someone who
// sees every lead).
export async function GET(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  return workspaceRoute(
    request,
    { module: "crm", permission: CRM_PERMISSIONS.import },
    async ({ client, session }) => {
      const { batchId } = await context.params;
      return ok(await getLeadImportBatch(client, crmContext(session), batchId));
    },
  );
}
