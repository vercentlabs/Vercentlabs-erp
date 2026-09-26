import { listOAuthConnections, oauthProfilesStatus } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Connected accounts: registered profiles (and whether the operator has
// configured them) plus the organisation's connection inventory. Credentials
// are never part of any response.
export async function GET(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.integrationsView, action: "integrations.oauth.list", transaction: "none" }, async ({ client, session }) =>
    ok({ profiles: oauthProfilesStatus(), connections: await listOAuthConnections(client, session.organizationId) }),
  );
}
