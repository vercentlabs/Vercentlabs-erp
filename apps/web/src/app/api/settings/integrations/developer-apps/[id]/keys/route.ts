import { z } from "zod";

import { createApiKey } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Issues a key for an existing app. The response carries the full key ONCE;
// only its hash is stored. Scopes must be registered (no "*").
const schema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.string().trim().min(1).max(120)).min(1).max(32),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.integrationsManage, action: "integrations.api_key.create", auditDenial: true },
    async ({ client, session }) => {
      const issued = await createApiKey(client, session, id, schema.parse(await readJson(request)));
      return ok({ key: issued.key, token: issued.token }, 201);
    },
  );
}
