import { getLeadImportErrorsCsv } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F021 rejected and failed rows as CSV (formula-neutralised cells).
export async function GET(
  request: Request,
  context: { params: Promise<{ batchId: string }> },
) {
  return workspaceRoute(
    request,
    { module: "crm", permission: CRM_PERMISSIONS.import },
    async ({ client, session }) => {
      const { batchId } = await context.params;
      const file = await getLeadImportErrorsCsv(
        client,
        crmContext(session),
        batchId,
      );
      return new Response(file.csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${file.fileName}"`,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
  );
}
