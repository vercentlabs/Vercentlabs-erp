import { createPipeline, listPipelines } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/opportunities/server/opportunity-http";

// The pipelines (CRM plan 5.1), the default first; ?all=1 includes switched-off ones (for those who manage stages).
export async function GET(request: Request) {
  const includeInactive = new URL(request.url).searchParams.get("all") === "1";
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session, snapshot }) =>
    ok({ pipelines: await listPipelines(client, crmContext(session, snapshot), { includeInactive }) }));
}

// Body: { name, description?, teamId?, copyStagesFrom? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok({ pipeline: await createPipeline(client, crmContext(session, snapshot), await readBody(request)) }, 201));
}
