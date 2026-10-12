import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};

export type CrmHome = {
  sees: { leads: boolean; opportunities: boolean; tasks: boolean; followUps: boolean };
  baseCurrency: string;
  totals: { openLeads: number | null; openOpportunities: number | null; pipelineValue: number | null; weightedPipelineValue: number | null; overdueFollowUps: number | null };
  myWork: { tasksDueToday: number | null; overdueTasks: number | null; followUpsToday: number | null; overdueFollowUps: number | null };
  leadFlow: { newThisMonth: number; qualifiedThisMonth: number; convertedThisMonth: number } | null;
  outcomes: { wonThisMonth: number; wonValueThisMonth: number; winRate: number | null; winRateDays: number } | null;
  closingSoon: Array<{
    id: string; code: string; name: string; amount: number | null; probability: number | null; expectedCloseDate: string; overdue: boolean;
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
export type WorkDefaults = { taskPriority: string; taskReminderMinutes: number | null; followUpType: string; followUpReminderMinutes: number | null };

export function getCrmHome(client: QueryClient, context: CrmContext): Promise<CrmHome>;
export function getWorkDefaults(client: QueryClient, context: CrmContext): Promise<WorkDefaults>;
export function saveWorkDefaults(client: QueryClient, context: CrmContext, input: Partial<WorkDefaults>): Promise<WorkDefaults>;
export function workDefaultChoices(): {
  taskPriorities: ReadonlyArray<{ code: string; label: string }>; taskReminderOptions: ReadonlyArray<{ minutes: number; label: string }>;
  followUpTypes: ReadonlyArray<{ code: string; label: string }>; followUpReminderOptions: ReadonlyArray<{ minutes: number; label: string }>;
};
