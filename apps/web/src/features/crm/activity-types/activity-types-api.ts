"use client";

// Browser client for activity types and activity plans (CRM plan 5.2).
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class ActivityTypeApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(ActivityTypeApiError, "body");

export type ActivityKind = "call" | "email" | "meeting" | "demo" | "visit" | "whatsapp" | "other";
export const ACTIVITY_KINDS: Array<{ value: ActivityKind; label: string }> = [
  { value: "call", label: "Call" }, { value: "email", label: "Email" }, { value: "meeting", label: "Meeting" }, { value: "demo", label: "Demo" },
  { value: "visit", label: "Visit" }, { value: "whatsapp", label: "WhatsApp" }, { value: "other", label: "Other" },
];
export type ActivityType = {
  id: string; code: string; name: string; kind: ActivityKind; icon: string | null; isStandard: boolean; isActive: boolean;
  defaultDelayHours: number | null; defaultAssignee: "record_owner" | "creator" | "user"; defaultUserId: string | null; defaultUserName: string | null;
  defaultReminderMinutes: number | null; emailTemplateId: string | null; emailTemplateName: string | null;
  chaining: "none" | "suggest" | "trigger"; nextTypeId: string | null; nextTypeName: string | null; nextDelayDays: number; sequence: number;
  // settings list only
  openFollowUps?: number; usedByPlans?: string[]; chainedFrom?: string[];
};
export type ActivityTypeInput = Partial<Omit<ActivityType, "id" | "code" | "isStandard" | "defaultUserName" | "emailTemplateName" | "nextTypeName" | "sequence" | "openFollowUps" | "usedByPlans" | "chainedFrom">>;
export type PlanStep = { activityTypeId: string; offsetDays: number; subject?: string | null; assignee: "record_owner" | "applier" | "user"; userId?: string | null };
export type ActivityPlan = {
  id: string; name: string; description: string | null; appliesTo: "lead" | "opportunity" | "any"; isActive: boolean; plannedCount: number; openCount: number;
  steps: Array<PlanStep & { id: string; sequence: number; activityTypeName: string; kind: ActivityKind; userName: string | null }>;
};

export const listActivityTypes = (all = false) => request<{ types: ActivityType[] }>(`/api/crm/activity-types${all ? "?all=1" : ""}`).then((result) => result.types);
export const createActivityType = (input: ActivityTypeInput) => request<{ type: ActivityType }>("/api/crm/activity-types", { method: "POST", json: input }).then((result) => result.type);
export const updateActivityType = (id: string, input: ActivityTypeInput) =>
  request<{ type: ActivityType }>(`/api/crm/activity-types/${id}`, { method: "PATCH", json: input }).then((result) => result.type);
export const reorderActivityTypes = (ids: string[]) => request<{ types: ActivityType[] }>("/api/crm/activity-types/reorder", { method: "POST", json: { ids } }).then((result) => result.types);

export const listActivityPlans = (options: { all?: boolean; appliesTo?: "lead" | "opportunity" } = {}) => {
  const search = new URLSearchParams();
  if (options.all) search.set("all", "1");
  if (options.appliesTo) search.set("appliesTo", options.appliesTo);
  return request<{ plans: ActivityPlan[] }>(`/api/crm/activity-plans${search.size ? `?${search}` : ""}`).then((result) => result.plans);
};
export const createActivityPlan = (input: { name: string; description?: string; appliesTo: ActivityPlan["appliesTo"]; steps: PlanStep[] }) =>
  request<{ plan: ActivityPlan }>("/api/crm/activity-plans", { method: "POST", json: input }).then((result) => result.plan);
export const updateActivityPlan = (id: string, input: Partial<{ name: string; description: string; appliesTo: ActivityPlan["appliesTo"]; steps: PlanStep[]; isActive: boolean }>) =>
  request<{ plan: ActivityPlan }>(`/api/crm/activity-plans/${id}`, { method: "PATCH", json: input }).then((result) => result.plan);
export const applyActivityPlan = (id: string, input: { relatedType: "lead" | "opportunity"; relatedId: string; startDate?: string }) =>
  request<{ planId: string; planned: Array<{ id: string }> }>(`/api/crm/activity-plans/${id}/apply`, { method: "POST", json: input });

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
