import { linkContactToAccount, listContactAccounts } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type ContactRouteParams } from "@/features/crm/contacts/server/contact-http";

// Every company the person is or was linked to.
export async function GET(request: Request, route: ContactRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsView }, async ({ client, session }) =>
    ok({ accounts: await listContactAccounts(client, crmContext(session), (await route.params).id) }),
  );
}

// Body: { accountId, jobTitle?, department?, role?, isDecisionMaker?, makePrimaryAccount? }
export async function POST(request: Request, route: ContactRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.contactsEdit, billingWrite: true }, async ({ client, session }) => {
    const body = await readBody(request);
    return ok(await linkContactToAccount(client, crmContext(session), (await route.params).id, { ...body, accountId: String(body.accountId ?? "") }));
  });
}
