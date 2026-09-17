"use client";

export type SessionRow = {
  id: string;
  deviceName: string;
  ipAddress: string | null;
  userAgent: string | null;
  sessionType: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  isCurrent: boolean;
};

export class SessionApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

async function parseResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new SessionApiError(payload.message || "The request could not be completed.", response.status);
  }
  return payload;
}

export async function listSessions(): Promise<{ sessions: SessionRow[] }> {
  const response = await fetch("/api/settings/sessions");
  return parseResponse<{ sessions: SessionRow[] }>(response);
}

export async function revokeSession(id: string): Promise<{ ok: true }> {
  const response = await fetch(`/api/settings/sessions/${id}`, { method: "DELETE" });
  return parseResponse<{ ok: true }>(response);
}

export async function revokeOtherSessions(): Promise<{ revokedCount: number }> {
  const response = await fetch("/api/settings/sessions", { method: "DELETE" });
  return parseResponse<{ revokedCount: number }>(response);
}
