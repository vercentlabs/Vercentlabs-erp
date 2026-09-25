import { listCrmLeadImportBatches } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F021 gap-closure — listCrmLeadImportBatches had no route: a completed
// import batch was only reachable through the results screen's own local
// state, with no way back to it (and no rollback) once that state was
// gone. This is the requester's own recent batches (or every batch for an
// org-wide view-all holder), same authorization rule the export job read
// already applies.
export async function GET() {
  try {
    const session = await requireWorkspace();
    const batches = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.leadsManage);
      return listCrmLeadImportBatches(client, crmContext(session));
    });
    return ok({ batches });
  } catch (error) {
    return errorResponse(error);
  }
}
