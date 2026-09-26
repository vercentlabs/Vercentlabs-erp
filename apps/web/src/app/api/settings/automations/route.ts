import { CONDITION_OPERATORS, createWorkflow, DOMAIN_EVENTS, listWorkflowRecipients, listWorkflows, WORKFLOW_ACTIONS, WORKFLOW_LIMITS } from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { workflowSchema } from "@/features/settings/automations/workflow-schema";

// Settings > Automations: "When <registered event>, if <safe conditions>,
// then <registered action>". Administration only; runs never use the
// administrator's permissions.
export async function GET(request: Request) {
  return workspaceRoute(request, { permission: CORE_PERMISSIONS.platformWorkflowsManage, action: "workflows.list", transaction: "none" }, async ({ client, session }) =>
    ok({
      workflows: await listWorkflows(client, session.organizationId),
      triggers: DOMAIN_EVENTS.map((event) => ({ key: event.key, label: event.label, moduleKey: event.moduleKey, conditionFields: event.conditionFields })),
      operators: CONDITION_OPERATORS,
      actions: WORKFLOW_ACTIONS,
      limits: WORKFLOW_LIMITS,
      members: await listWorkflowRecipients(client, session.organizationId),
    }),
  );
}

export async function POST(request: Request) {
  return workspaceRoute(
    request,
    { permission: CORE_PERMISSIONS.platformWorkflowsManage, action: "workflows.create", transaction: "platform", auditDenial: true },
    async ({ client, session }) => ok({ workflow: await createWorkflow(client, session, workflowSchema.parse(await readJson(request))) }, 201),
  );
}
