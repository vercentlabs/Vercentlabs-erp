import { listAllDealQuotes } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// Every CRM quote on the deals the caller may see. ?status=&limit=&offset=
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session, snapshot }) => {
    const params = new URL(request.url).searchParams;
    return ok(await listAllDealQuotes(client, crmContext(session, snapshot), {
      status: params.get("status") ?? undefined, limit: Number(params.get("limit")) || undefined, offset: Number(params.get("offset")) || undefined,
    }));
  });
}
