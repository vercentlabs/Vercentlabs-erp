import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Runtime = { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch };
export type WhatsAppRecordType = "lead" | "opportunity" | "party" | "contact";
export type WhatsAppSettings = {
  mode: "click_to_chat" | "cloud_api"; displayNumber: string | null; phoneNumberId: string | null; credentialsSet: string[];
  webhookKeyPrefix: string | null; lastReceivedAt: string | null; lastError: string | null;
};
export type WhatsAppMessage = {
  id: string; direction: "inbound" | "outbound"; channel: "click_to_chat" | "cloud_api"; phone: string; body: string | null; templateName: string | null;
  status: string; error: string | null; sentByName: string | null; createdAt: string;
};

export function getWhatsAppSettings(client: QueryClient, context: CrmContext, runtime?: Runtime): Promise<WhatsAppSettings>;
export function saveWhatsAppSettings(client: QueryClient, context: CrmContext, input: Record<string, unknown>, runtime?: Runtime): Promise<{ settings: WhatsAppSettings; webhookKey: string | null; verifyToken: string | null }>;
export function prepareWhatsApp(client: QueryClient, context: CrmContext, type: WhatsAppRecordType, id: string): Promise<{
  phone: string | null; name: string | null; mode: "click_to_chat" | "cloud_api"; refused: string | null; consented: boolean; windowOpen: boolean; needsTemplate: boolean;
}>;
export function logClickToChat(client: QueryClient, context: CrmContext, type: WhatsAppRecordType, id: string, input: Record<string, unknown>): Promise<{ messageId: string; link: string }>;
export function sendWhatsApp(client: QueryClient, context: CrmContext, type: WhatsAppRecordType, id: string, input: Record<string, unknown>, runtime?: Runtime): Promise<{ messageId: string; waMessageId: string | null; status: string }>;
export function listWhatsAppMessages(client: QueryClient, context: CrmContext, type: WhatsAppRecordType, id: string): Promise<WhatsAppMessage[]>;
export function resolveWhatsAppWebhook(client: QueryClient, webhookKey: string): Promise<Record<string, any>>;
export function verifyWhatsAppSubscription(row: Record<string, any>, params: URLSearchParams, runtime?: Runtime): Promise<string | null>;
export function receiveWhatsAppWebhook(runtime: { runTenant: <T>(work: (client: QueryClient) => Promise<T>) => Promise<T> }, row: Record<string, any>,
  request: { rawBody: string; headers: Headers; body: unknown }, options?: Runtime): Promise<{ received: number; duplicate: number; statuses: number; newLeads: number }>;
