import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Env = Record<string, string | undefined>;
export type CrmMailing = {
  id: string; name: string; audience: "leads" | "contacts"; filters: Record<string, string>; subject: string; body: string; campaignId: string | null;
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled"; scheduledAt: string | null; startedAt: string | null; finishedAt: string | null; createdAt: string; createdByName: string | null;
  counts: { recipients: number; sent: number; skipped: number; failed: number; opened: number; clicked: number; unsubscribed: number };
};
export function previewMailingAudience(client: QueryClient, context: CrmContext, input: { audience: string; filters?: Record<string, unknown> }): Promise<{ total: number; eligible: number; skipped: Record<string, number>; tooMany: boolean }>;
export function listMailings(client: QueryClient, context: CrmContext): Promise<CrmMailing[]>;
export function getMailing(client: QueryClient, context: CrmContext, mailingId: string): Promise<CrmMailing>;
export function createMailing(client: QueryClient, context: CrmContext, input: Record<string, unknown>): Promise<CrmMailing>;
export function updateMailing(client: QueryClient, context: CrmContext, mailingId: string, input: Record<string, unknown>): Promise<CrmMailing>;
export function scheduleMailing(client: QueryClient, context: CrmContext, mailingId: string, input?: { scheduledAt?: string | null }): Promise<CrmMailing>;
export function cancelMailing(client: QueryClient, context: CrmContext, mailingId: string): Promise<CrmMailing>;
export function renderMailingEmail(body: string, person: Record<string, unknown>, token: string, env?: Env): { text: string; html: string; unsubscribe: string };
export function runMailings(client: QueryClient, organizationId: string, options?: { batch?: number; env?: Env }): Promise<{ sent: number; failed: number; skipped: number; finished: number }>;
export function hasDueMailings(client: QueryClient, organizationId: string): Promise<boolean>;
export function unsubscribeFromMailing(client: QueryClient, token: string): Promise<{ done: boolean; email?: string }>;
export function recordMailingOpen(client: QueryClient, token: string): Promise<{ done: boolean }>;
export function recordMailingClick(client: QueryClient, token: string, url: string): Promise<{ target: string | null }>;
