import { assertSameOriginOrMobile, enqueueCrmLeadExportJob } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { tenantTransaction } from "@/core/db";
import { errorResponse, ok, readJson } from "@/core/http";
import { requireWorkspace } from "@/core/session";
import { crmContext, requireCrmAccess } from "@/features/crm/shared/crm-context";

// F021 Stage A2 §9. Enqueues a real async export job (tenant.background_jobs,
// job_type='crm.leads.export') instead of the prior client-side "fetch
// every page then build CSV in the browser" approach — see
// CrmImportExportScreen.tsx's own updated comment. Same crm.leads.manage
// gate the rest of this import/export screen already uses.
export async function POST(request: Request) {
  try {
    assertSameOriginOrMobile(request, process.env);
    const session = await requireWorkspace();
    const input = (await readJson(request)) as { filters?: Record<string, string> };
    const job = await tenantTransaction(session.organizationId, async (client) => {
      await requireCrmAccess(client, session, CRM_PERMISSIONS.leadsManage);
      return enqueueCrmLeadExportJob(client, crmContext(session), { filters: input.filters || {} });
    });
    return ok({ job }, 202);
  } catch (error) {
    return errorResponse(error);
  }
}
