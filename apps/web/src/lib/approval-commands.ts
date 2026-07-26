import {
  approveQuotation,
  completeCrmActivity,
  moveOpportunityStage,
  rejectQuotationApproval,
} from "@vercentlabs/api";
import { createCommandRegistry } from "@vercentlabs/workflows";
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
  reject?(
    context: CommandContext,
    payload: Record<string, unknown>,
  ): Promise<unknown>;
};

const uuid = z.string().uuid();

const salesContext = (session: WorkspaceSessionContext) => ({
  organizationId: session.organizationId,
  userId: session.userId,
  activeCompanyId: session.activeCompanyId,
  activeBranchId: session.activeBranchId,
  allowAllCompanies: session.roleSlugs.some((role) =>
    [
      "organization_owner",
      "system_administrator",
      "company_administrator",
    ].includes(role),
  ),
  permissions: session.permissions,
  roleSlugs: session.roleSlugs,
});

const definitions: ApprovalCommand[] = [
  {
    key: "sales.quotation.approve",
    permission: PERMISSIONS.salesQuotationApprove,
    entityType: "sales_quotation",
    entityId: (payload) => String(payload.quotationId),
    title: (payload) =>
      `Approve Sales quotation ${String(payload.quotationId)}`,
    validate: (payload) =>
      z
        .object({ quotationId: uuid, quotationVersionId: uuid })
        .strict()
        .parse(payload),
    execute: ({ client, session }, payload) =>
      approveQuotation(
        client,
        salesContext(session),
        String(payload.quotationId),
        String(payload.quotationVersionId),
      ),
    reject: ({ client, session }, payload) =>
      rejectQuotationApproval(
        client,
        salesContext(session),
        String(payload.quotationId),
      ),
  },
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
