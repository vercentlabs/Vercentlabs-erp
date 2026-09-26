import { z } from "zod";

import { beginOAuthConnection } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Starts Authorization Code + PKCE for a registered profile. The callback URI
// is the server's own; the browser may only name an internal return path.
const schema = z.object({ profile: z.string().trim().min(1).max(80), returnPath: z.string().max(300).optional() });

export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.integrationsManage, action: "integrations.oauth.connect", transaction: "platform", auditDenial: true },
    async ({ client, session }) => ok(await beginOAuthConnection(client, session, schema.parse(await readJson(request)))),
  );
}
