import {
  completeCrmActivity,
  moveOpportunityStage,
} from "@vercent/api";
import { createCommandRegistry } from "@vercent/workflows";
import type { PoolClient } from "pg";
import { z } from "zod";

import type { WorkspaceSessionContext } from "@/lib/auth";
import { PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";

type CommandContext = {
  client: PoolClient;
  session: WorkspaceSessionContext;
};

export type ApprovalCommand = {
  key: string;
  permission: string;
  entityType: string;
  entityId(payload: Record<string, unknown>): string;
  title(payload: Record<string, unknown>): string;
  validate(payload: unknown): Record<string, unknown>;
  execute(
    context: CommandContext,
    payload: Record<string, unknown>,
  ): Promise<unknown>;
};

const uuid = z.string().uuid();
const definitions: ApprovalCommand[] = [
  {
    key: "crm.opportunity.stage_change",
    permission: PERMISSIONS.crmOpportunitiesManage,
    entityType: "opportunity",
    entityId: (payload) => String(payload.opportunityId),
    title: (payload) =>
      `Move opportunity ${String(payload.opportunityId)} to the requested stage`,
    validate: (payload) =>
      z
        .object({
          opportunityId: uuid,
          stageId: uuid,
          note: z.string().trim().max(1000).optional().nullable(),
        })
        .strict()
        .parse(payload),
    execute: ({ client, session }, payload) =>
      moveOpportunityStage(
        client,
        crmContext(session),
        String(payload.opportunityId),
        String(payload.stageId),
        payload.note ? String(payload.note) : null,
      ),
  },
  {
    key: "crm.activity.complete",
    permission: PERMISSIONS.crmActivitiesManage,
    entityType: "activity",
    entityId: (payload) => String(payload.activityId),
    title: (payload) =>
      `Complete CRM activity ${String(payload.activityId)}`,
    validate: (payload) =>
      z
        .object({
          activityId: uuid,
          outcome: z.string().trim().max(2000).optional().nullable(),
        })
        .strict()
        .parse(payload),
    execute: ({ client, session }, payload) =>
      completeCrmActivity(
        client,
        crmContext(session),
        String(payload.activityId),
        payload.outcome ? String(payload.outcome) : null,
      ),
  },
];

const registry = createCommandRegistry(definitions);

export function getApprovalCommand(key: string) {
  return registry.get(key) as ApprovalCommand | null;
}

export function approvalCommandKeys() {
  return registry.keys();
}
