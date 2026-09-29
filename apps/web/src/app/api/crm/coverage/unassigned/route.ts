import { listUnassignedRecords } from "@vercentlabs/api";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// F020 unassigned leads/opportunities/accounts, keyset-paged, within the
// caller's record scope.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    { module: "crm", permission: CRM_PERMISSIONS.coverageView },
    async ({ client, session }) => {
      const params = new URL(request.url).searchParams;
      return ok(
        await listUnassignedRecords(client, crmContext(session), {
          type: params.get("type") ?? "",
          cursor: params.get("cursor"),
          limit: Number(params.get("limit") ?? 50),
        }),
      );
    },
  );
}
