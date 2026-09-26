import { z } from "zod";

import { getAiGovernanceOverview, setAiPolicy } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";

// Settings > AI governance. No policy = AI disabled (fail closed). Only
// registered tools and data classes; prompts are never stored or shown (only
// their hashes exist).
export async function GET(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.platformAiManage, action: "ai.governance.view", transaction: "none" }, async ({ client, session }) =>
    ok(await getAiGovernanceOverview(client, session.organizationId)),
  );
}

const schema = z.object({
  enabled: z.boolean(),
  allowRead: z.boolean(),
  allowPropose: z.boolean(),
  allowExecute: z.boolean(),
  requiresApproval: z.boolean(),
  allowedTools: z.array(z.string().max(160)).max(32),
  dataClasses: z.array(z.string().max(120)).max(32),
});

export async function PUT(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.platformAiManage, action: "ai.policy.write", transaction: "platform", auditDenial: true },
    async ({ client, session }) => ok({ policy: await setAiPolicy(client, session, { ...schema.parse(await readJson(request)), policyKey: "organization" }) }),
  );
}
