"use client";

export const SUBMISSION_TONE = {
  submitted: "info",
  approved: "success",
  rejected: "danger",
  draft: "neutral",
  superseded: "neutral",
} as const;

export const SUBMISSION_LABEL: Record<string, string> = {
  submitted: "Waiting for review",
  approved: "Approved",
  rejected: "Sent back",
  draft: "Draft",
};

export const num = (value: string | number | null | undefined) =>
  Number(value ?? 0);
