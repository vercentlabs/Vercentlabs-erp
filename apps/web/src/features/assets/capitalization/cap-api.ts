"use client";

import { AssetApiError, qs } from "../register/register-api";

// Assets — the client of /api/assets/capitalization: purchases to register, cost allocation, capitalization requests, CWIP, adjustments.
export const CAP_BASE = "/assets/capitalization";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/assets/capitalization${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
const send = <T = Record<string, unknown>>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export type Issue = { code: string; message: string };
export type Component = { id: string; component: string; label?: string; source: string | null; sourceLineId?: string | null; amount: string; currency: string; rate?: string; reporting: string; offsetAccountId?: string | null;
  account?: string | null; costStatus?: string; fromAllocation?: boolean };
export type Cap = { id: string; number: string; target: string; assetId: string | null; cwipId: string | null; targetHref: string; status: string; statusLabel: string; treatment: string; treatmentLabel: string;
  total?: string | null; currency: string; capitalizationDate: string | null; availableForUseDate: string | null; depreciationStartDate: string | null; taxReview: boolean; requestedBy: string | null; requestedAt: string;
  approvedBy: string | null; approvedAt: string | null; postedBy: string | null; postedAt: string | null; journalEntryId: string | null; outcome: string | null; version: number; href: string };
export type CapDetail = Cap & { note: string | null; reviewNote: string | null; rejectionReason: string | null; reversalReason: string | null; components: Component[];
  journal: Array<{ accountId: string; account: string; debit: string; credit: string }>; debitAccount: string | null; events: Array<{ id: string; action: string; reason: string | null; by: string | null; at: string }>;
  can: { approve: boolean; sendBack: boolean; reject: boolean; resubmit: boolean; post: boolean; recover: boolean; reverse: boolean } };
export type Overview = { counts: { toRegister: number; costPending: number; pendingReview: number; toPost: number; capitalizedThisMonth: number; cwipOpen: number; adjustmentsPending: number; exceptions: number };
  cwipBalance: string | null; can: { register: boolean; allocate: boolean; request: boolean; approve: boolean; post: boolean; cwip: boolean; adjust: boolean; cost: boolean; export: boolean; audit: boolean } };
export type Purchase = { sourceType: string; sourceLabel: string; sourceLineId: string; documentId?: string; document: string; date: string | null; description: string; supplier: string | null; quantity: number; registered: number; available: number; proposedUnitCost?: string | null };
export type CostPending = { assetId: string; asset: string; category: string; lifecycle: string; source: string | null; costStatus: string | null; total?: string | null; ready: boolean; issues: string[]; href: string };
export type CostSource = { sourceLineId: string; document: string; date: string | null; description: string; supplier: string | null; currency: string; posted: boolean; net: string; remaining: string; tax: string; taxRemaining: string };
export type Cwip = { id: string; number: string; name: string; category: string | null; status: string; statusLabel: string; readyAt: string | null; balance?: string | null; transferred?: string | null; capitalization: string | null; ageDays: number; href: string };
export type CwipDetail = { id: string; number: string; name: string; description: string | null; category: string | null; status: string; statusLabel: string; readyAt: string | null; readyEvidence: string | null; account: string | null;
  balance?: string | null; transferred?: string | null; remaining?: string | null; costs: Array<{ id: string; label: string; reporting: string; source: string | null; status: string; capitalized: boolean }>;
  transfers: Array<{ id: string; assetId: string; asset: string; amount?: string | null; status: string }>; capitalizations: Cap[]; can: { addCost: boolean; ready: boolean; request: boolean; transfer: boolean } };
export type Adjustment = { id: string; number: string; assetId: string; asset: string; kind: string; kindLabel: string; amount?: string | null; status: string; statusLabel: string; reason: string; evidence: string | null;
  requestedBy: string | null; at: string; mine: boolean; canDecide: boolean };
export type ReconLine = { sourceLineId: string; document: string; kind: string; description: string; quantity: number; registered: number; remainingUnits: number | null; value?: string | null; allocated?: string;
  remainingValue?: string | null; fullyRegistered: boolean; overAllocated: boolean };
export type Reconciliation = { lines: ReconLine[]; capitalizations: { approvedNotPosted: number; posted: number; postedWithoutJournal: number; capitalizedValue?: string | null };
  cwip: Array<{ number: string; name: string; status: string; balance?: string | null; transferred?: string | null; href: string }>; note: string };
export type CapException = { kind: string; label: string; subject: string; href: string };
export type AssetCap = { visible: false } | { visible: true; assetId: string; capitalizationClass: string; lifecycle: string; capitalizationDate: string | null; depreciationStartDate: string | null; availableForUseDate: string | null;
  capitalizedCost: string | null; proposal: { total: string; currency: string; issues: Issue[]; taxReview: boolean; components: Component[] } | null; requests: Cap[];
  components: Array<{ id: string; component: string; label: string; amount: string; reporting: string; currency: string; method: string; source: string | null; status: string; capitalized: boolean }>;
  adjustments: Array<{ id: string; number: string; kind: string; kindLabel: string; amount: string; status: string; statusLabel: string; reason: string; at: string }>;
  can: { request: boolean; allocate: boolean; adjust: boolean; startDepreciation: boolean; returnToSupplier: boolean }; note: string };

export const getOverview = () => call<Overview>("/actions/overview");
export const getPurchases = (search = "") => call<{ rows: Purchase[] }>(`/actions/purchases${qs({ search })}`).then((r) => r.rows);
export const getCostPending = () => call<{ rows: CostPending[] }>("/actions/cost-pending").then((r) => r.rows);
export const getCapitalizations = (status: string) => call<{ rows: Cap[] }>(`/actions/requests${qs({ status })}`).then((r) => r.rows);
export const getCapitalization = (id: string) => call<CapDetail>(`/requests/${id}`);
export const getCwipProjects = () => call<{ rows: Cwip[] }>("/actions/cwip").then((r) => r.rows);
export const getCwip = (id: string) => call<CwipDetail>(`/cwip/${id}`);
export const getAdjustments = () => call<{ rows: Adjustment[] }>("/actions/adjustments").then((r) => r.rows);
export const getReconciliation = () => call<Reconciliation>("/actions/reconciliation");
export const getExceptions = () => call<{ rows: CapException[] }>("/actions/exceptions").then((r) => r.rows);
export const getCostSources = (search = "") => call<{ rows: CostSource[] }>(`/actions/cost-sources${qs({ search })}`).then((r) => r.rows);
export const getCapReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/actions/report${qs({ kind })}`).then((r) => r.rows);
export const capAction = <T = Record<string, unknown>>(action: string, input: Record<string, unknown>) => send<T>(`/actions/${action}`, input);
export const requestAction = <T = Record<string, unknown>>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/requests/${id}/${action}`, input);
export const cwipAction = <T = Record<string, unknown>>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/cwip/${id}/${action}`, input);
export const capExportHref = "/api/assets/capitalization/export";
export const CAP_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { DRAFT: "neutral", PENDING_REVIEW: "warning", CHANGES_REQUESTED: "warning", APPROVED: "info", POSTING: "info", POSTED: "success",
  REJECTED: "neutral", REVERSED: "neutral", RECOVERY_REQUIRED: "danger" };
export const COMPONENT_OPTIONS = [{ value: "FREIGHT", label: "Freight" }, { value: "INSTALLATION", label: "Installation" }, { value: "TESTING", label: "Testing and commissioning" },
  { value: "OTHER_DIRECT", label: "Other directly attributable cost" }, { value: "NONRECOVERABLE_TAX", label: "Nonrecoverable tax (from the line's tax)" }];
export const CAP_REPORT_KINDS = [
  { id: "purchases-pending-registration", label: "Asset purchases pending registration" }, { id: "pending-capitalization", label: "Registered assets pending capitalization" },
  { id: "capitalized-by-period", label: "Capitalized assets by period", cost: true }, { id: "acquisitions-by-category", label: "Acquisitions by category", cost: true },
  { id: "acquisitions-by-supplier", label: "Acquisitions by supplier", cost: true }, { id: "cost-allocation-detail", label: "Asset cost allocation detail", cost: true },
  { id: "purchase-source-reconciliation", label: "Purchase source reconciliation" }, { id: "cwip-summary", label: "CWIP summary" }, { id: "cwip-aging", label: "CWIP aging" },
  { id: "capitalization-adjustments", label: "Capitalization adjustments", cost: true }, { id: "tracked-only-purchases", label: "Tracked-only purchases" },
  { id: "acquisition-tax-exceptions", label: "Acquisition tax exceptions" }, { id: "missing-depreciation-policies", label: "Missing depreciation start" }, { id: "purchase-to-asset-audit", label: "Purchase-to-asset audit" },
];
