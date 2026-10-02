import { enqueueCrmLeadExportJob } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { crmContext } from "@/features/crm/shared/crm-context";
import { workspaceRoute } from "@/core/workspace-route";

// F021. Enqueues a real async export job (tenant.background_jobs,
// job_type='crm.leads.export') rather than building the CSV in the
// browser. Same crm.leads.manage
// gate the rest of this import/export screen already uses — plus the
// dedicated crm.export permission (checked again in enqueue and worker).
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm", permission: CRM_PERMISSIONS.export },
    async ({ client, session }) => {
      const input = (await readJson(request)) as {
        filters?: Record<string, string>;
      };
      const job = await enqueueCrmLeadExportJob(client, crmContext(session), {
        filters: input.filters || {},
      });
      return ok({ job }, 202);
    },
  );
}
