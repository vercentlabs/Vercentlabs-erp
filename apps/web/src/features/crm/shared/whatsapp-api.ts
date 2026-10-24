"use client";

// Browser client for WhatsApp from records and its setup (CRM plan 4.2).
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class WhatsAppApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(WhatsAppApiError, "body");

export type WhatsAppEntity = "leads" | "opportunities" | "accounts" | "contacts";
export type WhatsAppDraft = { phone: string | null; name: string | null; mode: "click_to_chat" | "cloud_api"; refused: string | null; consented: boolean; windowOpen: boolean; needsTemplate: boolean };
export type WhatsAppMessage = {
  id: string; direction: "inbound" | "outbound"; channel: "click_to_chat" | "cloud_api"; phone: string; body: string | null; templateName: string | null;
  status: string; error: string | null; sentByName: string | null; createdAt: string;
};
export type WhatsAppSettings = {
  mode: "click_to_chat" | "cloud_api"; displayNumber: string | null; phoneNumberId: string | null; credentialsSet: string[];
  webhookKeyPrefix: string | null; lastReceivedAt: string | null; lastError: string | null;
  verifiedName: string | null; qualityRating: string | null; last30Days: { sent: number; received: number; failed: number };
};

export const prepareWhatsApp = (entity: WhatsAppEntity, id: string) => request<{ draft: WhatsAppDraft }>(`/api/crm/whatsapp/${entity}/${id}`).then((result) => result.draft);
export const logClickToChat = (entity: WhatsAppEntity, id: string, body: string) =>
  request<{ result: { messageId: string; link: string } }>(`/api/crm/whatsapp/${entity}/${id}`, { method: "POST", json: { via: "click_to_chat", body } }).then((result) => result.result);
export const sendWhatsApp = (entity: WhatsAppEntity, id: string, input: { body?: string; templateName?: string; templateLanguage?: string; parameters?: string[] }) =>
  request<{ result: { messageId: string; status: string } }>(`/api/crm/whatsapp/${entity}/${id}`, { method: "POST", json: { via: "cloud_api", ...input } }).then((result) => result.result);
export const listWhatsAppMessages = (entity: WhatsAppEntity, id: string) =>
  request<{ messages: WhatsAppMessage[] }>(`/api/crm/whatsapp/${entity}/${id}/messages`).then((result) => result.messages);
export const getWhatsAppSettings = () => request<{ settings: WhatsAppSettings }>("/api/crm/whatsapp-settings").then((result) => result.settings);
export const checkWhatsAppConnection = () => request<{ settings: WhatsAppSettings }>("/api/crm/whatsapp-settings/check", { method: "POST", json: {} }).then((result) => result.settings);
export const saveWhatsAppSettings = (input: Record<string, unknown>) =>
  request<{ settings: WhatsAppSettings; webhookKey: string | null; verifyToken: string | null }>("/api/crm/whatsapp-settings", { method: "PUT", json: input });

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
