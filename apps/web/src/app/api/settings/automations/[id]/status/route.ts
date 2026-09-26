import { z } from "zod";

import { setWorkflowStatus } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

const schema = z.object({ status: z.enum(["active", "inactive"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.platformWorkflowsManage, action: "workflows.status", transaction: "platform", auditDenial: true },
    async ({ client, session }) => ok({ workflow: await setWorkflowStatus(client, session, id, schema.parse(await readJson(request)).status) }),
  );
}
