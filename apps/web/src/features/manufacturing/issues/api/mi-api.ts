"use client";

// Material Issue: the client of /api/manufacturing/material-issues, /material-issue-reports and the order's issuable materials.
import { call, qs, send } from "@/features/manufacturing/orders/api/mo-api";

export type IssueStatus = "DRAFT" | "PENDING_APPROVAL" | "READY_TO_POST" | "POSTING" | "POSTED" | "CANCELLED" | "RECOVERY_REQUIRED";
export type Place = { warehouse: { id: string; code: string; name: string } | null; location: { id: string; code: string; name: string } | null };
export type IssueLine = {
  id: string; lineNumber: number; materialId: string; itemId: string; code: string; name: string; trackingType: string; quantity: string; uomId: string; uom: string; baseQuantity: string;
  baseUom: string; factor: string; required: string; netIssued: string; remainingToIssue: string; consumed: string; scrapped: string; inCustody: string; reservedForOrder: string;
  freeEligible: string | null; excess: string; excessApproved: string; batch: { id: string; number: string | null; expiresOn: string | null } | null;
  serials: Array<{ id: string; number: string | null }>; sourceLocation: { id: string; code: string } | null; notes: string | null;
  posted: { movementNumber: string | null; fromReservation: string; unitCost: string | null; totalCost: string | null } | null; reversed: string;
  allocations: Array<{ stockMovementId: string; batch: string | null; expiresOn: string | null; serial: string | null; location: string | null; quantity: string; fromReservation: boolean }>;
};
export type MaterialIssue = {
  id: string; number: string; status: IssueStatus; statusLabel: string; rowVersion: number; issueReason: string; issueDate: string; notes: string | null; receivedBy: string | null;
  createdBy: string | null; createdAt: string; postedBy: string | null; postedAt: string | null; cancelledBy: string | null; cancelledAt: string | null; cancelReason: string | null;
  order: { id: string; number: string; status: string; statusLabel: string; version: number; finishedItem: { code: string; name: string }; revisionNumber: number | null; snapshotId: string | null };
  source: Place; production: Place;
  approval: { required: boolean; valid: boolean; status: string; excess: Array<{ code: string; excess: string; approved?: string; withinTolerance: boolean }>; message?: string | null;
    reason: string | null; varianceType: string | null; requestedBy: string | null; requestedAt: string | null; decidedBy: string | null; decidedAt: string | null; note: string | null };
  lines: IssueLine[]; totals: { lines: number; cost: string | null; costStatus: string | null };
  posting: { key: string; documentVersion: number; inventoryStatus: string; stockMovementIds: string[]; financeStatus: string; journalEntryId: string | null; at: string } | null;
  reversals: Array<{ id: string; number: string; lineNumber: number; quantity: string; reason: string; evidence: string | null; cost: string | null; by: string | null; at: string }>;
  print: { count: number; lastPrintedAt: string | null; watermark: string | null };
  history: Array<{ action: string; label: string; fromStatus: string | null; toStatus: string | null; summary: string | null; actor: string | null; at: string }>;
  can: Record<"edit" | "cancel" | "validate" | "requestApproval" | "decideApproval" | "post" | "reverse" | "print" | "viewCost" | "recover", boolean>;
};
export type IssueListRow = {
  id: string; number: string; status: IssueStatus; statusLabel: string; orderId: string; orderNumber: string; orderStatusLabel: string; finishedItem: string; warehouse: string; lines: number;
  summary: string | null; issueReason: string; approvalStatus: string; createdBy: string | null; issuedBy: string | null; createdAt: string; postedAt: string | null; totalCost: string | null;
  costStatus: string | null; printed: number;
};
export type IssuePreview = {
  issueId: string; issueNumber: string; ok: boolean; readiness: string; checkedAt: string; problems: Array<{ code: string; message: string }>;
  approval: MaterialIssue["approval"];
  lines: Array<{ lineId: string; code: string; quantity: string; baseQuantity: string; uom: string; remainingBefore: string; excess: string; fromReservation: string; fromFree: string; short: string;
    plan: Array<{ source: "RESERVATION" | "FREE"; batch: string | null; serial: string | null; expiresOn: string | null; quantity: string }> }>;
};
export type Issuable = {
  orderId: string; orderNumber: string; orderStatus: string; orderStatusLabel: string; orderVersion: number; eligible: boolean; reason: string | null; unreservedAllowed: boolean; tolerancePct: string;
  materials: Array<{
    materialId: string; lineNumber: number; itemId: string; code: string; name: string; uomId: string; uom: string; kind: string; origin: string; trackingType: string; required: string;
    netIssued: string; consumed: string; scrapped: string; inCustody: string; remainingToIssue: string; reservedForOrder: string; freeEligible: string;
    stock: Array<{ locationId: string | null; location: string | null; batchId: string | null; batch: string | null; expiresOn: string | null; onHand: string; reservedForOrder: string; free: string }>;
    serials: Array<{ id: string; number: string; location: string | null; reservedForOrder: boolean }> | null;
  }>;
};
export type PostingCheck = { issueId: string; issueNumber: string; status: string; consistent: boolean; problems: string[]; checkedAt: string;
  inventory: { status: string; movements: number; quantity: string }; finance: { status: string; journalEntryId: string | null; amount: string | null } };
export type DraftInput = { manufacturingOrderId?: string; notes?: string; receivedBy?: string; issueReason?: string; idempotencyKey?: string; expectedVersion?: number;
  lines: Array<{ materialId: string; quantity: string; uomId?: string; batchId?: string | null; serialIds?: string[] }> };

export const ISSUE_TONE: Record<IssueStatus, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "info", PENDING_APPROVAL: "warning", READY_TO_POST: "info", POSTING: "warning", POSTED: "success", CANCELLED: "neutral", RECOVERY_REQUIRED: "danger",
};
export const VARIANCE_TYPES = [{ value: "EXCESS_USAGE", label: "Excess usage" }, { value: "DAMAGED_DURING_PRODUCTION", label: "Damaged during production" },
  { value: "QUALITY_REPLACEMENT", label: "Quality replacement" }, { value: "PLANNING_CORRECTION", label: "Planning correction" }, { value: "OTHER", label: "Other" }];
export const MI_BASE = "/manufacturing/material-issues";

export const listIssues = (filters: Record<string, string | undefined>) => call<{ issues: IssueListRow[] }>(`/material-issues${qs(filters)}`).then((r) => r.issues);
export const getIssue = (id: string) => call<{ issue: MaterialIssue }>(`/material-issues/${id}`).then((r) => r.issue);
export const createIssue = (input: DraftInput) => send<{ issue: MaterialIssue }>(`/material-issues`, input).then((r) => r.issue);
export const updateIssue = (id: string, input: DraftInput) => send<{ issue: MaterialIssue }>(`/material-issues/${id}`, input, "PATCH").then((r) => r.issue);
export const previewIssue = (id: string) => call<{ preview: IssuePreview }>(`/material-issues/${id}/preview`).then((r) => r.preview);
export const postingStatus = (id: string) => call<{ posting: PostingCheck }>(`/material-issues/${id}/posting-status`).then((r) => r.posting);
export const issueAction = <T = { issue: MaterialIssue }>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/material-issues/${id}/${action}`, input);
export const issuable = (orderId: string) => call<{ issuable: Issuable }>(`/orders/${orderId}/issuable-materials`).then((r) => r.issuable);
export const issueReport = <T = Record<string, unknown>>(kind: string, filters: Record<string, string | undefined> = {}) =>
  call<{ rows: T[] }>(`/material-issue-reports${qs({ kind, ...filters })}`).then((r) => r.rows);
