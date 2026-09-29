import { reassignCoverage } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F020 governed reassignment: each record moves through its own domain
// command (assignment rules, versions, history); per-record outcomes are
// returned, never a silent partial.
export async function POST(request: Request) {
  return workspaceRoute(
    request,
    {
      module: "crm",
      permission: CRM_PERMISSIONS.coverageAssign,
      billingWrite: true,
      action: "crm.coverage.reassign",
    },
    async ({ client, session }) => {
      const input = (await readJson(request)) as Record<string, unknown>;
      return ok({
        reassignment: await reassignCoverage(
          client,
          crmContext(session),
          input as never,
        ),
      });
    },
  );
}
