import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Runtime = { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; appUrl?: string };
export type ChannelRecordType = "lead" | "opportunity" | "party" | "contact";
export type ChannelSettings = {
  telephony: { provider: "none" | "exotel"; accountSid: string | null; apiHost: string; callerId: string | null; recordCalls: boolean; credentialsSet: string[]; webhookKeyPrefix: string | null };
  sms: { provider: "none" | "exotel" | "msg91"; senderId: string | null; dltEntityId: string | null; accountSid: string | null; apiHost: string; credentialsSet: string[]; webhookKeyPrefix: string | null };
  myCallPhone: string | null;
};
export type SmsTemplate = { id: string; name: string; dltTemplateId: string; category: "transactional" | "service" | "promotional"; body: string; status: "active" | "inactive"; variables: number };

export function sendTeamSms(client: QueryClient, organizationId: string, input: { phone: string; templateId: string; values: string[] }, options?: Runtime): Promise<{ sent: boolean; error?: string }>;
export function getChannelSettings(client: QueryClient, context: CrmContext, runtime?: Runtime): Promise<ChannelSettings>;
export function saveChannelSettings(client: QueryClient, context: CrmContext, input: Record<string, any>, runtime?: Runtime): Promise<{ settings: ChannelSettings; callWebhookKey: string | null; smsWebhookKey: string | null }>;
export function setMyCallPhone(client: QueryClient, context: CrmContext, phone: string | null): Promise<{ phone: string | null }>;
export function startCall(client: QueryClient, context: CrmContext, type: ChannelRecordType, id: string, runtime?: Runtime): Promise<{ callId: string; status: string; error?: string }>;
export function receiveCallStatus(client: QueryClient, organizationId: string, fields: Record<string, string>): Promise<{ matched: boolean; status?: string }>;
export function listCalls(client: QueryClient, context: CrmContext, type: ChannelRecordType, id: string): Promise<Array<{ id: string; status: string; customerPhone: string; agentName: string | null; durationSeconds: number | null; recordingUrl: string | null; error: string | null; createdAt: string }>>;
export function listSmsTemplates(client: QueryClient, context: CrmContext, options?: { includeInactive?: boolean }): Promise<SmsTemplate[]>;
export function saveSmsTemplate(client: QueryClient, context: CrmContext, templateId: string | null, input: Record<string, unknown>): Promise<SmsTemplate[]>;
export function fillDltTemplate(body: string, values?: string[]): string;
export function sendSms(client: QueryClient, context: CrmContext, type: ChannelRecordType, id: string, input: { templateId: string; values?: string[] }, runtime?: Runtime): Promise<{ messageId: string; status: string; error?: string; body: string }>;
export function listSmsMessages(client: QueryClient, context: CrmContext, type: ChannelRecordType, id: string): Promise<Array<{ id: string; phone: string; body: string; status: string; error: string | null; sentByName: string | null; createdAt: string }>>;
export function receiveSmsStatus(client: QueryClient, organizationId: string, fields: Record<string, string>): Promise<{ matched: boolean; status?: string }>;
export function resolveChannelWebhook(client: QueryClient, webhookKey: string): Promise<{ organizationId: string; channel: "call" | "sms" }>;
