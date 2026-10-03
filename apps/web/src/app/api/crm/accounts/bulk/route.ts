import { bulkAssignAccounts, bulkSetAccountStatus } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { HttpError, ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/accounts/server/account-http";

// Bulk operations on selected accounts. Body: { action, partyIds, ... }
//   assign  { ownerUserId?, teamId? }
//   status  { status: active | inactive | archived }
// Each account succeeds or fails on its own; the response lists every outcome.
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsView, billingWrite: true }, async ({ client, session }) => {
    const context = crmContext(session);
    const { action, ...input } = await readBody(request);
    const payload = input as { partyIds: string[] } & Record<string, unknown>;
    if (action === "assign") return ok(await bulkAssignAccounts(client, context, payload));
    if (action === "status") return ok(await bulkSetAccountStatus(client, context, payload as { partyIds: string[]; status: "active" | "inactive" | "archived" }));
    throw new HttpError(400, "Unknown bulk action.");
  });
}
