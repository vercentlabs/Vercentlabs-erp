"use client";

export class InvitationsApiError extends Error {
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
    throw new InvitationsApiError(payload.message || "The request could not be completed.", response.status);
  }
  return payload;
}

export type InvitationRow = {
  id: string;
  email: string;
  role_id: string | null;
  role_name: string | null;
  company_ids: string[];
  branch_ids: string[];
  status: "pending" | "accepted" | "revoked" | "expired";
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  last_sent_at: string;
  send_count: number;
  created_at: string;
  invited_by_name: string;
};

export type SeatSummary = { used: number; capacity: number | null; available: number | null };

export async function listInvitations(): Promise<{ invitations: InvitationRow[]; seats?: SeatSummary }> {
  const response = await fetch("/api/auth/invitations");
  return parseResponse(response);
}

export async function createInvitation(input: { email: string; roleId: string; companyIds: string[]; branchIds: string[] }): Promise<{ invitationId: string; delivered: boolean }> {
  const response = await fetch("/api/auth/invitations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return parseResponse(response);
}

export async function revokeInvitation(id: string): Promise<{ revoked: true }> {
  const response = await fetch(`/api/auth/invitations/manage/${id}/revoke`, { method: "POST" });
  return parseResponse(response);
}

export async function resendInvitation(id: string): Promise<{ delivered: boolean }> {
  const response = await fetch(`/api/auth/invitations/manage/${id}/resend`, { method: "POST" });
  return parseResponse(response);
}
