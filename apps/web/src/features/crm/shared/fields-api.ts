"use client";

// Browser client for custom fields, lead scoring and recurring plans (CRM plan 5.3).
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class FieldsApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(FieldsApiError, "body");

export type CustomFieldType = "text" | "number" | "date" | "select" | "checkbox";
export type CustomField = {
  id: string; entityType: "lead" | "opportunity"; key: string; label: string; type: CustomFieldType; options: string[]; isRequired: boolean;
  helpText: string | null; sequence: number; isActive: boolean;
};
export type CustomValues = Record<string, string | number | boolean | null>;
export const CUSTOM_FIELD_TYPES: Array<{ value: CustomFieldType; label: string }> = [
  { value: "text", label: "Text" }, { value: "number", label: "Number" }, { value: "date", label: "Date" }, { value: "select", label: "Choice from a list" },
  { value: "checkbox", label: "Yes / no" },
];

// The record types custom fields go on (companies and contacts: CRM audit M4).
export type CustomFieldEntity = "lead" | "opportunity" | "party" | "contact";
export const listCustomFields = (entity: CustomFieldEntity, all = false) =>
  request<{ fields: CustomField[] }>(`/api/crm/custom-fields?entity=${entity}${all ? "&all=1" : ""}`).then((result) => result.fields);
export const createCustomField = (input: { entityType: CustomFieldEntity; label: string; type: CustomFieldType; options?: string[]; isRequired?: boolean; helpText?: string }) =>
  request<{ field: CustomField }>("/api/crm/custom-fields", { method: "POST", json: input }).then((result) => result.field);
export const updateCustomField = (id: string, input: Partial<{ label: string; options: string[]; isRequired: boolean; helpText: string; sequence: number; isActive: boolean }>) =>
  request<{ field: CustomField }>(`/api/crm/custom-fields/${id}`, { method: "PATCH", json: input }).then((result) => result.field);

export type ScoringRule = { id: string; field: string; operator: "equals" | "contains" | "is_set" | "at_least"; value: string | null; points: number; label: string; isActive: boolean };
export type LeadScoring = {
  settings: { useHistory: boolean; minimumHistory: number; hotThreshold: number };
  rules: ScoringRule[]; fields: Array<{ key: string; label: string; operators: string[] }>; history: { closedLeads: number; conversionRate: number };
};
export type ScoreDetails = {
  score: number | null; rulesScore: number | null; rules: Array<{ label: string; points: number }>; hot: boolean;
  learned: { score: number; basedOn: number; overallRate: number; factors: Array<{ label: string; rate: number; count: number }> } | null;
};
export const getLeadScoring = () => request<LeadScoring>("/api/crm/lead-scoring");
export const saveLeadScoringSettings = (input: Partial<LeadScoring["settings"]>) => request<{ rescored: number }>("/api/crm/lead-scoring", { method: "PUT", json: input });
export const createScoringRule = (input: { field: string; operator: string; value?: string | null; points: number; label?: string }) =>
  request<{ rule: ScoringRule; rescored: number }>("/api/crm/lead-scoring/rules", { method: "POST", json: input });
export const updateScoringRule = (id: string, input: Partial<{ points: number; label: string; isActive: boolean; value: string }>) =>
  request<{ rule: ScoringRule; rescored: number }>(`/api/crm/lead-scoring/rules/${id}`, { method: "PATCH", json: input });
export const deleteScoringRule = (id: string) => request<{ deleted: true; rescored: number }>(`/api/crm/lead-scoring/rules/${id}`, { method: "DELETE" });

export type RecurringPlan = { id: string; name: string; months: number; isActive: boolean; dealCount?: number };
export const listRecurringPlans = (all = false) => request<{ plans: RecurringPlan[] }>(`/api/crm/recurring-plans${all ? "?all=1" : ""}`).then((result) => result.plans);
export const createRecurringPlan = (input: { name: string; months: number }) =>
  request<{ plan: RecurringPlan }>("/api/crm/recurring-plans", { method: "POST", json: input }).then((result) => result.plan);
export const updateRecurringPlan = (id: string, input: Partial<{ name: string; months: number; isActive: boolean }>) =>
  request<{ plan: RecurringPlan }>(`/api/crm/recurring-plans/${id}`, { method: "PATCH", json: input }).then((result) => result.plan);

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
