import { addAccountActivity, listAccountActivities } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type AccountRouteParams } from "@/features/crm/accounts/server/account-http";

// Everything logged or scheduled on the account, its contacts and its opportunities.
export async function GET(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsView }, async ({ client, session, snapshot }) =>
    ok({ activities: await listAccountActivities(client, crmContext(session, snapshot), (await route.params).id) }),
  );
}

// Body: { type, subject?, notes?, outcome?, occurredAt?, contactId?, nextAction? }
export async function POST(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsEdit, billingWrite: true }, async ({ client, session, snapshot }) =>
    ok(await addAccountActivity(client, crmContext(session, snapshot), (await route.params).id, await readBody(request)), 201),
  );
}
