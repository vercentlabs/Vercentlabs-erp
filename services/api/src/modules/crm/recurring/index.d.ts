import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
export type CrmRecurringPlan = { id: string; name: string; months: number; isActive: boolean; dealCount?: number; openDeals?: number; wonDeals?: number; wonMonthly?: number; openMonthly?: number };
export function listRecurringPlans(client: QueryClient, context: CrmContext, options?: { includeInactive?: boolean }): Promise<CrmRecurringPlan[]>;
export function listRecurringPlansWithResults(client: QueryClient, context: CrmContext): Promise<{ plans: CrmRecurringPlan[]; currency: string | null }>;
export function createRecurringPlan(client: QueryClient, context: CrmContext, input: Record<string, unknown>): Promise<CrmRecurringPlan>;
export function updateRecurringPlan(client: QueryClient, context: CrmContext, planId: string, input: Record<string, unknown>): Promise<CrmRecurringPlan>;
