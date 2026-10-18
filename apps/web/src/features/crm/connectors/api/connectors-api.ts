"use client";

// Browser client for CRM › Setup › Lead connectors (/api/crm/connectors).
import { CrmApiErrorWithBody } from "@/features/crm/shared/http/crm-api-error";
import { crmApiClient } from "@/features/crm/shared/http/crm-request";

export class ConnectorApiError extends CrmApiErrorWithBody {}
const { request } = crmApiClient(ConnectorApiError, "body");
const BASE = "/api/crm/connectors";

export type LeadProviderKey = "indiamart" | "justdial" | "tradeindia" | "meta" | "google";
export type LeadProvider = { key: LeadProviderKey; label: string; pull: boolean; push: boolean; credentials: Array<{ key: string; label: string; help: string | null; generated: boolean }> };
export type LeadConnector = {
  id: string; provider: LeadProviderKey; providerLabel: string; name: string; status: "active" | "paused"; pull: boolean; push: boolean;
  sourceId: string | null; sourceName: string | null; ownerUserId: string | null; ownerName: string | null; credentialsSet: string[];
  webhookKeyPrefix: string | null; pollIntervalMinutes: number; lastPolledAt: string | null; polledUntil: string | null; lastReceivedAt: string | null;
  receivedCount: number; leadCount: number; lastError: string | null; lastErrorAt: string | null; createdAt: string; updatedAt: string;
};
export type LeadConnectorEvent = {
  id: string; externalId: string; receivedAt: string; enquiryAt: string | null; status: "created" | "logged" | "ignored" | "failed";
  leadId: string | null; leadCode: string | null; recordType: string | null; recordId: string | null; summary: string | null; error: string | null;
};
// Shown once, after creating a connector or a new webhook address.
export type ConnectorSecrets = { connector: LeadConnector; webhookKey: string | null; generated?: Record<string, string> };

export const listLeadConnectors = () => request<{ connectors: LeadConnector[]; providers: LeadProvider[] }>(BASE);
export const createLeadConnector = (input: Record<string, unknown>) => request<ConnectorSecrets>(BASE, { method: "POST", json: input });
export const updateLeadConnector = (id: string, input: Record<string, unknown>) =>
  request<{ connector: LeadConnector }>(`${BASE}/${id}`, { method: "PATCH", json: input }).then((result) => result.connector);
export const setLeadConnectorStatus = (id: string, status: "active" | "paused") => request<{ connector: LeadConnector }>(`${BASE}/${id}/status`, { method: "POST", json: { status } });
export const rotateLeadConnectorWebhook = (id: string) => request<ConnectorSecrets>(`${BASE}/${id}/rotate`, { method: "POST", json: {} });
export const pullLeadConnectorNow = (id: string) =>
  request<{ result: { read: number; created: number; logged: number; failed: number; skipped?: boolean; error?: string } }>(`${BASE}/${id}/pull`, { method: "POST", json: {} }).then((result) => result.result);
export const listLeadConnectorEvents = (id: string) => request<{ events: LeadConnectorEvent[] }>(`${BASE}/${id}/events`).then((result) => result.events);
export const webhookUrl = (key: string) => `${typeof window === "undefined" ? "" : window.location.origin}${BASE}/hooks/${key}`;

export function errorMessage(error: unknown, fallback = "Something went wrong. Try again.") {
  return error instanceof Error && error.message ? error.message : fallback;
}
export function fieldErrors(error: unknown): Record<string, string> {
  const issues = (error as { details?: { issues?: Array<{ field: string; message: string }> } })?.details?.issues ?? [];
  return Object.fromEntries(issues.map((issue) => [issue.field, issue.message]));
}
