import type { CrmContext } from "@vercentlabs/shared-types";

type QueryClient = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[]; rowCount?: number | null }> };
type Runtime = { env?: NodeJS.ProcessEnv; fetchImpl?: typeof fetch; now?: Date };

export type LeadProviderKey = "indiamart" | "justdial" | "tradeindia" | "meta" | "google" | "acres99" | "magicbricks" | "housing" | "sulekha" | "shiksha"
  | "collegedunia" | "exportersindia" | "missed_call";
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

export const CONNECTOR_PERMISSION: "crm.capture.manage";
export const LEAD_PROVIDERS: Record<LeadProviderKey, unknown>;
export function listLeadProviders(): LeadProvider[];
export function listLeadConnectors(client: QueryClient, context: CrmContext, runtime?: Runtime): Promise<LeadConnector[]>;
export function getLeadConnector(client: QueryClient, context: CrmContext, connectorId: string, runtime?: Runtime): Promise<LeadConnector>;
export function createLeadConnector(client: QueryClient, context: CrmContext, input: Record<string, unknown>, runtime?: Runtime): Promise<{ connector: LeadConnector; webhookKey: string | null; generated: Record<string, string> }>;
export function updateLeadConnector(client: QueryClient, context: CrmContext, connectorId: string, input: Record<string, unknown>, runtime?: Runtime): Promise<LeadConnector>;
export function setLeadConnectorStatus(client: QueryClient, context: CrmContext, connectorId: string, status: "active" | "paused"): Promise<LeadConnector>;
export function rotateLeadConnectorWebhook(client: QueryClient, context: CrmContext, connectorId: string): Promise<{ connector: LeadConnector; webhookKey: string }>;
export function listLeadConnectorEvents(client: QueryClient, context: CrmContext, connectorId: string, options?: { limit?: number }): Promise<LeadConnectorEvent[]>;
export function ingestProviderLead(client: QueryClient, row: Record<string, any>, item: { externalId: string; enquiryAt?: string | null; test?: boolean; input: Record<string, unknown> }): Promise<{ status: string; leadId?: string | null }>;
export function listDueLeadConnectors(client: QueryClient, organizationId: string, now?: Date): Promise<string[]>;
export function pullLeadConnector(runtime: { runTenant: <T>(work: (client: QueryClient) => Promise<T>) => Promise<T> }, organizationId: string, connectorId: string, options?: Runtime): Promise<any>;
export function pullLeadConnectorNow(client: QueryClient, context: CrmContext, connectorId: string, options?: Runtime): Promise<any>;
export function recordLeadConnectorError(client: QueryClient, organizationId: string, connectorId: string, error: unknown): Promise<void>;
export function resolveLeadConnectorWebhook(client: QueryClient, webhookKey: string): Promise<Record<string, any>>;
export function verifyLeadConnectorSubscription(row: Record<string, any>, params: URLSearchParams, runtime?: Runtime): Promise<string | null>;
export function receiveLeadConnectorWebhook(runtime: { runTenant: <T>(work: (client: QueryClient) => Promise<T>) => Promise<T> }, row: Record<string, any>,
  request: { rawBody: string; headers: Headers; body: unknown }, options?: Runtime): Promise<{ received: number; created: number; logged: number; failed: number; ignored: number; duplicate: number }>;
