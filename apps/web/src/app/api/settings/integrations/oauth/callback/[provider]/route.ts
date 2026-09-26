import { consumeOAuthState, exchangeOAuthCode, saveOAuthConnection, safeReturnPath } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { transaction } from "@/core/db";
import { workspaceRoute } from "@/core/workspace-route";

// The server-owned OAuth redirect URI (APP_URL + this path, registered with
// the provider). Three short steps, never one transaction across the network:
//   1. consume the one-time state for this user (own transaction);
//   2. redeem the code with the PKCE verifier (provider call, no transaction);
//   3. store the encrypted credentials (own transaction).
// It always ends on an allow-listed internal page.
export async function GET(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider } = await context.params;
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.integrationsManage, action: "integrations.oauth.callback", transaction: "none" }, async ({ session }) => {
    const url = new URL(request.url);
    const land = (path: string, outcome: "connected" | "failed", reason?: string) => {
      const target = new URL(safeReturnPath(path), url.origin);
      target.searchParams.set("tab", "connected-accounts");
      target.searchParams.set("oauth", outcome);
      if (reason) target.searchParams.set("reason", reason);
      return Response.redirect(target.toString(), 303);
    };
    let attempt;
    try {
      attempt = await transaction((client) => consumeOAuthState(client, session, provider, url.searchParams.get("state") ?? ""));
    } catch {
      return land("/settings/integrations", "failed", "expired");
    }
    if (url.searchParams.get("error")) return land(attempt.returnPath, "failed", "declined");
    try {
      const exchanged = await exchangeOAuthCode(attempt.profileKey, { code: url.searchParams.get("code") ?? "", redirectUri: attempt.redirectUri, codeVerifier: attempt.codeVerifier });
      await transaction((client) => saveOAuthConnection(client, session, exchanged));
      return land(attempt.returnPath, "connected");
    } catch {
      return land(attempt.returnPath, "failed", "provider");
    }
  });
}
