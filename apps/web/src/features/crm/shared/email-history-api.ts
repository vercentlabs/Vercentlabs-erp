"use client";

// F018 Email history — one shared client for every 360 embedding an
// EmailHistoryPanel (Lead/Opportunity/Account/Contact).
export type EmailEngagementEvent = { type: string; occurredAt: string; url?: string | null };

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

export class EmailHistoryApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new EmailHistoryApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  }
  return payload;
}

export async function listEmailHistory(entityType: string, entityId: string): Promise<{ rows: EmailHistoryRow[] }> {
  const response = await fetch(`/api/crm/email-history?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`);
  return parseResponse(response);
}

export async function getEmailThread(threadId: string): Promise<{ thread: EmailThread; messages: EmailThreadMessage[] }> {
  const response = await fetch(`/api/crm/email-threads/${threadId}`);
  return parseResponse(response);
}
