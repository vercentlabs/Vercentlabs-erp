import { getSalesCoverage } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F020 sales organisation and coverage overview (teams, territories, gaps,
// unassigned work). The domain re-checks crm.coverage.view.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm", permission: CRM_PERMISSIONS.coverageView },
    async ({ client, session }) => {
      const asOf = new URL(request.url).searchParams.get("asOf") ?? undefined;
      return ok({
        coverage: await getSalesCoverage(client, crmContext(session), { asOf }),
      });
    },
  );
}
