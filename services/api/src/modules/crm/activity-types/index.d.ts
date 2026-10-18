import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Input = Record<string, unknown>;
export type ActivityKind = "call" | "email" | "meeting" | "demo" | "visit" | "whatsapp" | "other";
export type CrmActivityType = {
  id: string; code: string; name: string; label: string; kind: ActivityKind; icon: string | null; isStandard: boolean; isActive: boolean;
  defaultDelayHours: number | null; defaultAssignee: "record_owner" | "creator" | "user"; defaultUserId: string | null; defaultUserName: string | null;
  defaultReminderMinutes: number | null; emailTemplateId: string | null; emailTemplateName: string | null;
  chaining: "none" | "suggest" | "trigger"; nextTypeId: string | null; nextTypeName: string | null; nextDelayDays: number; sequence: number;
};
export type CrmActivityPlan = {
  id: string; name: string; description: string | null; appliesTo: "lead" | "opportunity" | "any"; isActive: boolean;
  steps: Array<{ id: string; sequence: number; activityTypeId: string; activityTypeName: string; kind: ActivityKind; subject: string | null; offsetDays: number;
    assignee: "record_owner" | "applier" | "user"; userId: string | null; userName: string | null }>;
};

export const ACTIVITY_KIND_LABELS: Readonly<Record<ActivityKind, string>>;
export function ensureStandardActivityTypes(client: QueryClient, organizationId: string): Promise<void>;
export function listActivityTypes(client: QueryClient, context: CrmContext, options?: { includeInactive?: boolean }): Promise<CrmActivityType[]>;
export function activityTypeChoices(client: QueryClient, context: CrmContext): Promise<Array<{ id: string; code: string; label: string; kind: ActivityKind }>>;
export function resolveActivityType(client: QueryClient, organizationId: string, input: { activityTypeId?: string | null; code?: string | null }): Promise<Record<string, any>>;
export function createActivityType(client: QueryClient, context: CrmContext, input?: Input): Promise<CrmActivityType>;
export function updateActivityType(client: QueryClient, context: CrmContext, typeId: string, input?: Input): Promise<CrmActivityType>;
export function reorderActivityTypes(client: QueryClient, context: CrmContext, orderedIds: string[]): Promise<CrmActivityType[]>;
export function listActivityPlans(client: QueryClient, context: CrmContext, options?: { includeInactive?: boolean; appliesTo?: string | null }): Promise<CrmActivityPlan[]>;
export function createActivityPlan(client: QueryClient, context: CrmContext, input?: Input): Promise<CrmActivityPlan>;
export function updateActivityPlan(client: QueryClient, context: CrmContext, planId: string, input?: Input): Promise<CrmActivityPlan>;
export function applyActivityPlan(client: QueryClient, context: CrmContext, planId: string,
  input: { relatedType: string; relatedId: string; startDate?: string | null }): Promise<{ planId: string; planned: Array<Record<string, any>> }>;
