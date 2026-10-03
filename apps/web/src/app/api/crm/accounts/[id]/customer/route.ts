import { createCustomerFromAccount, customerReadiness, linkCustomer, searchLinkableCustomers } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody, type AccountRouteParams } from "@/features/crm/accounts/server/account-http";

// Whether the account can become a customer, and (with ?search=) the
// existing customers it could be linked to instead.
export async function GET(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsCreateCustomer }, async ({ client, session }) => {
    const context = crmContext(session);
    const { id } = await route.params;
    const search = new URL(request.url).searchParams.get("search");
    if (search !== null) return ok({ customers: await searchLinkableCustomers(client, context, id, search) });
    return ok({ readiness: await customerReadiness(client, context, id) });
  });
}

// Body: { gstin?, pan?, paymentTermId?, creditLimit?, currencyCode? } creates
// the customer; { linkCustomerId, choices? } links an existing one instead.
export async function POST(request: Request, route: AccountRouteParams) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsCreateCustomer, billingWrite: true }, async ({ client, session }) => {
    const context = crmContext(session);
    const { id } = await route.params;
    const { linkCustomerId, choices, ...terms } = await readBody(request);
    if (typeof linkCustomerId === "string")
      return ok({ link: await linkCustomer(client, context, id, { customerId: linkCustomerId, choices: (choices ?? {}) as Record<string, "keep" | "duplicate"> }) });
    return ok({ record: await createCustomerFromAccount(client, context, id, terms) });
  });
}
