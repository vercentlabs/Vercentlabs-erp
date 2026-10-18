import { getCrmDataJob } from "@vercentlabs/api/crm";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";

// One of the caller's background imports or exports.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return workspaceRoute(request, { module: "crm" }, async ({ client, session, snapshot }) => ok({ job: await getCrmDataJob(client, crmContext(session, snapshot), id) }));
}
