import { exportTasks } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { csvResponse, taskFiltersFromUrl } from "@/features/crm/tasks/server/task-http";

// The tasks the list shows for the same view and filters, as CSV.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.export }, async ({ client, session }) => {
    const file = await exportTasks(client, crmContext(session), taskFiltersFromUrl(new URL(request.url)));
    return csvResponse(file.csv, file.fileName);
  });
}
