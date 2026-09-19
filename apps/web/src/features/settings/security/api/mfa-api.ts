"use client";

export class MfaApiError extends Error {
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
    throw new MfaApiError(payload.message || "The request could not be completed.", response.status);
  }
  return payload;
}

export async function startMfaEnrollment(): Promise<{ secretBase32: string; otpauthUri: string }> {
  const response = await fetch("/api/auth/mfa/enroll/start", { method: "POST" });
  return parseResponse(response);
}

export async function confirmMfaEnrollment(code: string): Promise<{ recoveryCodes: string[] }> {
  const response = await fetch("/api/auth/mfa/enroll/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return parseResponse(response);
}

export async function disableMfa(code: string): Promise<{ disabled: true }> {
  const response = await fetch("/api/auth/mfa/disable", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return parseResponse(response);
}

export async function regenerateRecoveryCodes(code: string): Promise<{ recoveryCodes: string[] }> {
  const response = await fetch("/api/auth/mfa/recovery-codes/regenerate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  return parseResponse(response);
}
