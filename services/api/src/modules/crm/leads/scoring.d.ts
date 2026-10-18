import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
export type LeadScoringRule = { id: string; field: string; operator: "equals" | "contains" | "is_set" | "at_least"; value: string | null; points: number; label: string; isActive: boolean };
export type LeadScoringSettings = { useHistory: boolean; minimumHistory: number; hotThreshold: number };
export type LeadScoring = {
  settings: LeadScoringSettings; rules: LeadScoringRule[]; fields: Array<{ key: string; label: string; operators: string[] }>;
  history: { closedLeads: number; conversionRate: number };
};
export const SCORING_FIELDS: ReadonlyArray<{ key: string; label: string; column: string; operators: string[] }>;
export function rescoreLead(client: QueryClient, organizationId: string, leadId: string): Promise<{ score: number | null; details: Record<string, unknown> } | null>;
export function rescoreOpenLeads(client: QueryClient, organizationId: string, options?: { limit?: number }): Promise<number>;
export function getLeadScoring(client: QueryClient, context: CrmContext): Promise<LeadScoring>;
export function createLeadScoringRule(client: QueryClient, context: CrmContext, input: Record<string, unknown>): Promise<{ rule: LeadScoringRule; rescored: number }>;
export function updateLeadScoringRule(client: QueryClient, context: CrmContext, ruleId: string, input: Record<string, unknown>): Promise<{ rule: LeadScoringRule; rescored: number }>;
export function deleteLeadScoringRule(client: QueryClient, context: CrmContext, ruleId: string): Promise<{ deleted: true; rescored: number }>;
export function saveLeadScoringSettings(client: QueryClient, context: CrmContext, input: Record<string, unknown>): Promise<{ settings: LeadScoringSettings; rescored: number }>;
