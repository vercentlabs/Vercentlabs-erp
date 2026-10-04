"use client";

import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class CrmHomeApiError extends CrmApiErrorWithBody {}

const { request } = crmApiClient(CrmHomeApiError, "body");

// CRM Home: what needs the signed-in user's attention today. null = the user cannot see that kind of record.
export type CrmHome = {
  sees: { leads: boolean; opportunities: boolean; tasks: boolean; followUps: boolean };
  baseCurrency: string;
  totals: { openLeads: number | null; openOpportunities: number | null; pipelineValue: number | null; weightedPipelineValue: number | null; overdueFollowUps: number | null };
  myWork: { tasksDueToday: number | null; overdueTasks: number | null; followUpsToday: number | null; overdueFollowUps: number | null };
  pipeline: Array<{ stageId: string; name: string; total: number; value: number }>;
  needsAttention: {
    unassignedLeads: number | null; leadsWithNoActivity: number | null; staleOpportunities: number | null; opportunitiesClosingSoon: number | null;
    overdueOpportunities: number | null; leadStaleDays: number; opportunityStaleDays: number; closingSoonDays: number;
  };
  recentActivity: Array<{ id: string; recordType: "lead" | "opportunity"; recordId: string; recordName: string; summary: string; at: string; actorName: string | null }>;
};

export const getCrmHome = () => request<{ home: CrmHome }>("/api/crm/home").then((result) => result.home);
