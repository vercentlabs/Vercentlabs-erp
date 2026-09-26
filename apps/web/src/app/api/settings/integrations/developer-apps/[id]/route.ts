import { z } from "zod";

import { updateDeveloperApp } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(1000).optional() });

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.integrationsManage, action: "integrations.developer_app.update", transaction: "platform", auditDenial: true },
    async ({ client, session }) => ok({ app: await updateDeveloperApp(client, session, id, schema.parse(await readJson(request))) }),
  );
}
