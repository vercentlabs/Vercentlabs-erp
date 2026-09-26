import { z } from "zod";

import { createDeveloperApp, listApiKeys, listApiScopes, listDeveloperApps } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Settings > Integrations > Developer API. Account administration: never
// billing-gated. Keys are listed by prefix only; a full key is shown once, at
// creation, and never again.
export async function GET(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.integrationsView, action: "integrations.developer_apps.list" }, async ({ client, session }) =>
    ok({ apps: await listDeveloperApps(client, session.organizationId), keys: await listApiKeys(client, session.organizationId), scopes: listApiScopes() }),
  );
}

const schema = z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(1000).optional() });

export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.integrationsManage, action: "integrations.developer_app.create", auditDenial: true },
    async ({ client, session }) => ok({ app: await createDeveloperApp(client, session, schema.parse(await readJson(request))) }, 201),
  );
}
