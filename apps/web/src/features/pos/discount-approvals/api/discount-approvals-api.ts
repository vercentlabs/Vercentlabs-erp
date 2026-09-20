"use client";

import type { PosDiscountApproval } from "@vercentlabs/api";

import { PosApiError, request } from "@/features/pos/shared/http";

export type { PosDiscountApproval };

// F279-APP-001
export const listPosDiscountApprovals = (status: "pending" | "approved" | "rejected" | "all" = "pending") =>
  request<{ rows: PosDiscountApproval[] }>(`/discount-approvals?status=${status}`);

// Deciding goes through the platform's own maker-checker endpoint, not a
// POS-specific one: that is where self-approval is blocked
// (SELF_APPROVAL_DENIED) and where pos.discount.approve is enforced again
// inside the dispatched domain function. This screen never decides anything
// itself -- it only calls the same endpoint the generic /approvals inbox uses.
export async function decidePosDiscountApproval(approvalRequestId: string, decision: "approved" | "rejected", note?: string) {
  const response = await fetch(`/api/approvals/${approvalRequestId}/decide`, {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ decision, note: note?.trim() || null }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new PosApiError(payload.message || "The decision could not be recorded.", response.status, payload.code, payload.details);
  }
  return payload;
}
