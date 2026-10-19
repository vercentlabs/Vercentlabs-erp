import { z } from "zod";

import { completeSetup, getSetupProgress, markSetupStep } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

export async function GET(request: Request) {
  return workspaceRoute(request, { action: "organization.setup.view" }, async ({ client, session }) => ok({ setup: await getSetupProgress(client, session.organizationId) }));
}

const schema = z.object({ action: z.enum(["mark", "complete"]), step: z.string().max(40).optional() });

// Body: { action: "mark", step } — a step the person says is done; { action: "complete" } — finish the wizard.
export async function POST(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.organizationManage, action: "organization.setup.update" }, async ({ client, session }) => {
    const body = schema.parse(await readJson(request));
    return ok({ setup: body.action === "complete" ? await completeSetup(client, session) : await markSetupStep(client, session, body.step ?? "") });
  });
}
