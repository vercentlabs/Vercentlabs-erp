import { getApiPlatformContext } from "@vercentlabs/api";

import { apiKeyRoute, apiOk } from "@/core/api-key-route";

// GET /api/v1/platform/context (scope platform.context.read): the calling
// key's own organisation, app, scopes and available modules. Never users,
// roles, billing details, secrets or provider tokens.
export async function GET(request: Request) {
  return apiKeyRoute(request, { scope: "platform.context.read", action: "api.v1.platform.context" }, async ({ client, principal, requestId }) =>
    apiOk(requestId, await getApiPlatformContext(client, principal)),
  );
}
