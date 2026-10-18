import { listCrmDataJobs, type CrmDataJobEntity } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// The caller's own background imports and exports (?entity=leads|accounts|contacts|opportunities), newest first.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => {
    const entity = new URL(request.url).searchParams.get("entity") || undefined;
    return ok({ jobs: await listCrmDataJobs(client, crmContext(session, snapshot), { entity: entity as CrmDataJobEntity | undefined }) });
  });
}
