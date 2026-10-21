import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Env = Record<string, string | undefined>;
export type CrmWhatsAppBroadcast = {
  id: string; name: string; audience: "leads" | "contacts"; filters: Record<string, string>; templateName: string; templateLanguage: string; parameters: string[]; campaignId: string | null;
  status: "draft" | "scheduled" | "sending" | "sent" | "cancelled"; scheduledAt: string | null; startedAt: string | null; finishedAt: string | null; createdAt: string; createdByName: string | null;
  counts: { recipients: number; sent: number; skipped: number; failed: number; delivered: number; read: number; replied: number };
};
export function whatsAppNumber(value: unknown): string | null;
export function previewBroadcastAudience(client: QueryClient, context: CrmContext, input: { audience: string; filters?: Record<string, unknown> }): Promise<{ total: number; eligible: number; skipped: Record<string, number>; tooMany: boolean }>;
export function listBroadcasts(client: QueryClient, context: CrmContext): Promise<CrmWhatsAppBroadcast[]>;
export function getBroadcast(client: QueryClient, context: CrmContext, broadcastId: string): Promise<CrmWhatsAppBroadcast>;
export function createBroadcast(client: QueryClient, context: CrmContext, input: Record<string, unknown>): Promise<CrmWhatsAppBroadcast>;
export function updateBroadcast(client: QueryClient, context: CrmContext, broadcastId: string, input: Record<string, unknown>): Promise<CrmWhatsAppBroadcast>;
export function scheduleBroadcast(client: QueryClient, context: CrmContext, broadcastId: string, input?: { scheduledAt?: string | null }): Promise<CrmWhatsAppBroadcast>;
export function cancelBroadcast(client: QueryClient, context: CrmContext, broadcastId: string): Promise<CrmWhatsAppBroadcast>;
export function runBroadcasts(client: QueryClient, organizationId: string, options?: { batch?: number; env?: Env; fetchImpl?: typeof fetch }): Promise<{ sent: number; failed: number; skipped: number; finished: number }>;
export function hasDueBroadcasts(client: QueryClient, organizationId: string): Promise<boolean>;
