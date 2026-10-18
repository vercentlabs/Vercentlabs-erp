"use client";

import type { CurrencyDisclosure } from "../../shared/ui/UnconvertedNotice";
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class CrmHomeApiError extends CrmApiErrorWithBody {}

const { request } = crmApiClient(CrmHomeApiError, "body");

// CRM Home: what needs the signed-in user's attention today. null = the user cannot see that kind of record.
export type CrmHome = {
  sees: { leads: boolean; opportunities: boolean; tasks: boolean; followUps: boolean };
  baseCurrency: string;
  currency: CurrencyDisclosure | null;
  totals: { openLeads: number | null; openOpportunities: number | null; pipelineValue: number | null; weightedPipelineValue: number | null; overdueFollowUps: number | null };
  myWork: { tasksDueToday: number | null; overdueTasks: number | null; followUpsToday: number | null; overdueFollowUps: number | null };
  leadFlow: { newThisMonth: number; qualifiedThisMonth: number; convertedThisMonth: number } | null;
  outcomes: { wonThisMonth: number; wonValueThisMonth: number; winRate: number | null; winRateDays: number } | null;
  closingSoon: Array<{
    id: string; code: string; name: string; amount: number | null; currencyCode: string | null; probability: number | null; expectedCloseDate: string; overdue: boolean;
    stageName: string | null; accountName: string | null; ownerName: string | null;
  }>;
  agenda: Array<{
    kind: "task" | "follow_up"; id: string; title: string; relatedName: string | null; relatedHref: string | null; dueAt: string; dueTime: string | null;
    isOverdue: boolean; priority: string | null; type: string | null;
  }>;
  agendaTotal: number;
  pipeline: Array<{ stageId: string; name: string; total: number; value: number }>;
  needsAttention: {
    unassignedLeads: number | null; leadsWithNoActivity: number | null; staleOpportunities: number | null; opportunitiesClosingSoon: number | null;
    overdueOpportunities: number | null; leadStaleDays: number; opportunityStaleDays: number; closingSoonDays: number;
  };
  recentActivity: Array<{ id: string; recordType: "lead" | "opportunity"; recordId: string; recordName: string; summary: string; at: string; actorName: string | null }>;
};

// Fields added after the first release default to empty, so a server still running older code shows less rather than failing.
export const getCrmHome = () => request<{ home: CrmHome }>("/api/crm/home").then(({ home }): CrmHome => ({
  ...home,
  leadFlow: home.leadFlow ?? null,
  outcomes: home.outcomes ?? null,
  closingSoon: home.closingSoon ?? [],
  agenda: home.agenda ?? [],
  agendaTotal: home.agendaTotal ?? 0,
}));
