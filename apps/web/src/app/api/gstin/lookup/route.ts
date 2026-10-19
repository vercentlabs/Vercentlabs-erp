import { lookupCompanyByGstin } from "@vercentlabs/api/crm";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// GSTIN lookup for customer and supplier forms (Shared Platform plan 7): the register's legal and trade name, status and state, through
// the operator's GST lookup service (GST_LOOKUP_URL). Without one, only the GSTIN's own check digit, state and PAN are read.
export async function GET(request: Request) {
  return workspaceRoute(request, { action: "gstin.lookup" }, async ({ client, session }) => {
    if (!["sales.customers.create", "procurement.suppliers.create", "crm.accounts.create"].some((permission) => session.permissions.includes(permission))
      && !session.roleSlugs.includes("organization_owner"))
      throw new HttpError(403, "You do not have permission to look up GSTINs.", "PERMISSION_DENIED");
    const gstin = new URL(request.url).searchParams.get("gstin") ?? "";
    return ok({ result: await lookupCompanyByGstin(client, { organizationId: session.organizationId, userId: session.userId, permissions: session.permissions, roleSlugs: session.roleSlugs }, gstin) });
  });
}
