"use client";

import { CrmApiError } from "../shared/http/crm-api-error.ts";
import { crmApiClient } from "../shared/http/crm-request.ts";

// F018 Email history — one shared client for every 360 embedding an
// EmailHistoryPanel (Lead/Opportunity/Account/Contact).
type EmailEngagementEvent = {
  type: string;
  occurredAt: string;
  url?: string | null;
};

export type EmailHistoryRow = {
  id: string;
  channel: string;
  direction: "inbound" | "outbound" | null;
  status: string;
  occurredAt: string;
  contentVisibility?: "full" | "metadata";
  redacted?: boolean;
  subject?: string | null;
  body?: string | null;
  fromAddress?: string | null;
  toAddresses?: string[] | null;
  emailStatus?: string | null;
  threadId?: string | null;
  assignedUserId?: string | null;
  firstResponseDueAt?: string | null;
  firstRespondedAt?: string | null;
  engagementEvents?: EmailEngagementEvent[] | null;
};

export type EmailThreadMessage = {
  id: string;
  direction: "inbound" | "outbound" | null;
  status: string;
  redacted?: boolean;
  subject?: string | null;
  fromAddress?: string | null;
  toAddresses?: string[] | null;
  ccAddresses?: string[] | null;
  bodyText?: string | null;
  sentAt?: string | null;
  receivedAt?: string | null;
  createdAt: string;
};

export type EmailThread = {
  id: string;
  subject?: string | null;
  status: string;
  assignedUserId?: string | null;
  firstResponseDueAt?: string | null;
  firstRespondedAt?: string | null;
  lastMessageAt?: string | null;
};

class EmailHistoryApiError extends CrmApiError {}

const { request } = crmApiClient(EmailHistoryApiError);

export async function listEmailHistory(
  entityType: string,
  entityId: string,
): Promise<{ rows: EmailHistoryRow[] }> {
  return request(
    `/api/crm/email-history?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`,
  );
}

export async function getEmailThread(
  threadId: string,
): Promise<{ thread: EmailThread; messages: EmailThreadMessage[] }> {
  return request(`/api/crm/email-threads/${threadId}`);
}
