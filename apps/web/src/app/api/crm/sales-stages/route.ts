import { createSalesStage, listSalesStages } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/opportunities/server/opportunity-http";

// The sales stages for the settings screen, inactive ones included. Needs the Configure pipeline stages permission.
export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView }, async ({ client, session }) => ok({ stages: await listSalesStages(client, crmContext(session)) }));
}

// Body: { name, probability, description?, guidance? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesView, billingWrite: true }, async ({ client, session }) =>
    ok({ stage: await createSalesStage(client, crmContext(session), await readBody(request)) }, 201),
  );
}
