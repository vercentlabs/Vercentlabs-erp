import { addAccountAddress, createAccount, getAccount, listAccounts, setAccountParent } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { accountFiltersFromUrl, readBody } from "@/features/crm/accounts/server/account-http";

export async function GET(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsView }, async ({ client, session }) => {
    const { accounts, ...page } = await listAccounts(client, crmContext(session), accountFiltersFromUrl(new URL(request.url)));
    return ok({ rows: accounts, ...page });
  });
}

// Body: the account fields, plus
//   allowDuplicate: true   save despite a strong duplicate (otherwise 409 with the matches)
//   address?               the first address, saved as default billing and shipping
//   parentPartyId?         the parent account
// Everything is saved in one transaction: a bad address saves nothing.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsCreate, billingWrite: true }, async ({ client, session }) => {
    const context = crmContext(session);
    const { allowDuplicate, address, parentPartyId, ...input } = await readBody(request);
    const created = await createAccount(client, context, input, { allowDuplicate: allowDuplicate === true });
    if (address && typeof address === "object") await addAccountAddress(client, context, created.id, address as Record<string, unknown>);
    if (typeof parentPartyId === "string" && parentPartyId) await setAccountParent(client, context, created.id, { parentPartyId });
    return ok({ record: address || parentPartyId ? await getAccount(client, context, created.id) : created }, 201);
  });
}
