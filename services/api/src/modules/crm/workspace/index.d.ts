import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};

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
export type WorkDefaults = { taskPriority: string; taskReminderMinutes: number | null; followUpType: string; followUpReminderMinutes: number | null };

export function getCrmHome(client: QueryClient, context: CrmContext): Promise<CrmHome>;
export function getWorkDefaults(client: QueryClient, context: CrmContext): Promise<WorkDefaults>;
export function saveWorkDefaults(client: QueryClient, context: CrmContext, input: Partial<WorkDefaults>): Promise<WorkDefaults>;
export function workDefaultChoices(): {
  taskPriorities: ReadonlyArray<{ code: string; label: string }>; taskReminderOptions: ReadonlyArray<{ minutes: number; label: string }>;
  followUpTypes: ReadonlyArray<{ code: string; label: string }>; followUpReminderOptions: ReadonlyArray<{ minutes: number; label: string }>;
};
