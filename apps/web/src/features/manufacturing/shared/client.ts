"use client";

// The error a Manufacturing API call fails with: the server's message, HTTP status and error code.
export class MfgApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}
