import { scheduleAccountFollowUp } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type AccountRouteParams } from "@/features/crm/accounts/server/account-http";

// Body: { type: call | email | meeting | task | other, dueAt, assignedTo?, notes?, subject?, contactId? }
export async function POST(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsEdit, billingWrite: true }, async ({ client, session }) =>
    ok({ followUp: await scheduleAccountFollowUp(client, crmContext(session), (await route.params).id, await readBody(request)) }, 201),
  );
}
