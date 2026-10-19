import {
  CONDITION_OPERATORS,
  createWorkflow,
  DOMAIN_EVENTS,
  listWorkflowRecipients,
  listWorkflows,
  TIME_TRIGGER_OFFSET,
  TIME_TRIGGERS,
  WORKFLOW_ACTIONS,
  WORKFLOW_ACTIVITY_RECORDS,
  WORKFLOW_ASSIGNABLE,
  WORKFLOW_LIMITS,
} from "@vercentlabs/api";
import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

import { ok, readJson } from "@/core/http";
import { workspaceRoute } from "@/core/workspace-route";
import { workflowSchema } from "@/features/settings/automations/workflow-schema";

// Settings > Automations: "When <registered event>, if <safe conditions>,
// then <registered action>". Administration only; runs never use the
// administrator's permissions.
export async function GET(request: Request) {
  return workspaceRoute(
    request,
    {
      permission: CORE_PERMISSIONS.platformWorkflowsManage,
      action: "workflows.list",
    },
    async ({ client, session }) =>
      ok({
        workflows: await listWorkflows(client, session.organizationId),
        triggers: [
          ...DOMAIN_EVENTS.map((event) => ({
            key: event.key,
            label: event.label,
            moduleKey: event.moduleKey,
            entityType: event.entityType,
            conditionFields: event.conditionFields,
            timed: false,
          })),
          // Time-based triggers: N days before or after a date on a record.
          ...TIME_TRIGGERS.map((trigger) => ({
            key: trigger.key,
            label: trigger.label,
            moduleKey: trigger.moduleKey,
            entityType: trigger.entityType,
            conditionFields: trigger.conditionFields,
            timed: true,
          })),
        ],
        offsetRange: TIME_TRIGGER_OFFSET,
        activityRecords: Object.keys(WORKFLOW_ACTIVITY_RECORDS),
        assignableRecords: Object.keys(WORKFLOW_ASSIGNABLE),
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
    {
      permission: CORE_PERMISSIONS.platformWorkflowsManage,
      action: "workflows.create",
      auditDenial: true,
    },
    async ({ client, session }) =>
      ok(
        {
          workflow: await createWorkflow(
            client,
            session,
            workflowSchema.parse(await readJson(request)),
          ),
        },
        201,
      ),
  );
}
