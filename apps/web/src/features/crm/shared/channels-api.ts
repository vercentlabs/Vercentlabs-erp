"use client";

// Browser client for calls and SMS from records and their setup (CRM plan 4.4).
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class ChannelApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(ChannelApiError, "body");

export type ChannelEntity = "leads" | "opportunities" | "accounts" | "contacts";
export type CallRow = { id: string; status: string; customerPhone: string; agentName: string | null; durationSeconds: number | null; recordingUrl: string | null; error: string | null; createdAt: string };
export type SmsRow = { id: string; phone: string; body: string; status: string; error: string | null; sentByName: string | null; createdAt: string };
export type SmsTemplate = { id: string; name: string; dltTemplateId: string; category: "transactional" | "service" | "promotional"; body: string; status: "active" | "inactive"; variables: number };
export type ChannelSettings = {
  telephony: { provider: "none" | "exotel"; accountSid: string | null; apiHost: string; callerId: string | null; recordCalls: boolean; credentialsSet: string[]; webhookKeyPrefix: string | null };
  sms: { provider: "none" | "exotel" | "msg91"; senderId: string | null; dltEntityId: string | null; accountSid: string | null; apiHost: string; credentialsSet: string[]; webhookKeyPrefix: string | null };
  myCallPhone: string | null;
};

export const getRecordChannels = (entity: ChannelEntity, id: string) =>
  request<{ calls: CallRow[]; sms: SmsRow[]; templates: SmsTemplate[] }>(`/api/crm/channels/${entity}/${id}`);
export const startCall = (entity: ChannelEntity, id: string) =>
  request<{ result: { callId: string; status: string; error?: string } }>(`/api/crm/channels/${entity}/${id}`, { method: "POST", json: { action: "call" } }).then((result) => result.result);
export const sendSms = (entity: ChannelEntity, id: string, templateId: string, values: string[]) =>
  request<{ result: { status: string; error?: string; body: string } }>(`/api/crm/channels/${entity}/${id}`, { method: "POST", json: { action: "sms", templateId, values } }).then((result) => result.result);
export const getChannelSettings = () => request<{ settings: ChannelSettings }>("/api/crm/channel-settings").then((result) => result.settings);
export const saveChannelSettings = (input: Record<string, unknown>) =>
  request<{ settings: ChannelSettings; callWebhookKey: string | null; smsWebhookKey: string | null }>("/api/crm/channel-settings", { method: "PUT", json: input });
export const setMyCallPhone = (myCallPhone: string | null) => request<{ phone: string | null }>("/api/crm/channel-settings", { method: "PATCH", json: { myCallPhone } });
export const listSmsTemplates = (all = false) => request<{ templates: SmsTemplate[] }>(`/api/crm/sms-templates${all ? "?all=1" : ""}`).then((result) => result.templates);
export const saveSmsTemplate = (id: string | null, input: Partial<SmsTemplate>) =>
  request<{ templates: SmsTemplate[] }>(id ? `/api/crm/sms-templates/${id}` : "/api/crm/sms-templates", { method: id ? "PATCH" : "POST", json: input }).then((result) => result.templates);

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
