import { setCloseReasonActive } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/opportunities/server/opportunity-http";

// Body: { active: boolean }
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.opportunitiesManageCloseReasons, billingWrite: true }, async ({ client, session }) =>
    ok(await setCloseReasonActive(client, crmContext(session), (await params).id, (await readBody(request)).active === true)),
  );
}
