import { deleteUnusedAccount, getAccount, updateAccount } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type AccountRouteParams } from "@/features/crm/accounts/server/account-http";

export async function GET(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsView }, async ({ client, session }) =>
    ok({ record: await getAccount(client, crmContext(session), (await route.params).id) }),
  );
}

export async function PATCH(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsEdit, billingWrite: true }, async ({ client, session }) => {
    const { allowDuplicate, expectedUpdatedAt, ...input } = await readBody(request);
    const record = await updateAccount(client, crmContext(session), (await route.params).id, input, {
      allowDuplicate: allowDuplicate === true,
      expectedUpdatedAt: typeof expectedUpdatedAt === "string" ? expectedUpdatedAt : null,
    });
    return ok({ record });
  });
}

// Permanently deletes an account created by mistake. Refused when anything
// refers to the account; such an account is archived instead.
export async function DELETE(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsDelete, billingWrite: true }, async ({ client, session }) =>
    ok(await deleteUnusedAccount(client, crmContext(session), (await route.params).id)),
  );
}
