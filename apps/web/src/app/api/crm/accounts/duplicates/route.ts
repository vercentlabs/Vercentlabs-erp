import { findDuplicateAccounts } from "@vercentlabs/api/crm";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { crmContext } from "@/features/crm/shared/crm-context";
import { readBody } from "@/features/crm/accounts/server/account-http";

// Checks the account being typed against existing accounts.
// Body: { displayName, legalName?, website?, email?, phone?, city?, excludeId? }
export async function POST(request: Request) {
  return workspaceRoute(request, { module: "crm", permission: CRM_PERMISSIONS.accountsView }, async ({ client, session }) => {
    const { excludeId, ...input } = await readBody(request);
    return ok(await findDuplicateAccounts(client, crmContext(session), input, { excludeId: typeof excludeId === "string" ? excludeId : null }));
  });
}
