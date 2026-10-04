import { createLeadStage, listLeadStages } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/leads/server/lead-http";

// The organization's lead stages in process order. ?includeInactive=true for setup.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView }, async ({ client, session }) =>
    ok({ stages: await listLeadStages(client, crmContext(session), { includeInactive: new URL(request.url).searchParams.get("includeInactive") === "true" }) }),
  );
}

// Managing stages needs crm.leads.manage_stages, which the operations check. Body: { name }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.leadsView, billingWrite: true }, async ({ client, session }) =>
    ok({ stage: await createLeadStage(client, crmContext(session), (await readBody(request)) as { name: string }) }, 201),
  );
}
