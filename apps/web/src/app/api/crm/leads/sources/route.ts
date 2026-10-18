import { createLeadSource, listLeadSources } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session, snapshot }) =>
    ok({ sources: await listLeadSources(client, crmContext(session, snapshot), { includeInactive: new URL(request.url).searchParams.get("includeInactive") === "true" }) }),
  );
}

export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.settingsManage, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ source: await createLeadSource(client, crmContext(session, snapshot), (await readBody(request)) as { name: string }) }, 201),
  );
}
