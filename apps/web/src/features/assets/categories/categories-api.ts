"use client";

import { AssetApiError, qs } from "../register/register-api";

// Assets — the client of /api/assets/categories.
export const CATEGORIES_BASE = "/assets/categories";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/assets/categories${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
const send = <T = Record<string, unknown>>(path: string, body: unknown = {}, method = "POST") => call<T>(path, { method, body: JSON.stringify(body) });

export type Finance = Record<string, string | null>;
export type Category = {
  id: string; code: string; name: string; description: string | null; assetType: string; assetTypeLabel: string; capitalizationGuidance: string; capitalizationGuidanceLabel: string;
  serialNumberPolicy: string; serialNumberPolicyLabel: string; assetTagPolicy: string; assetTagPolicyLabel: string; locationRequired: boolean; custodianPolicy: string; custodianPolicyLabel: string;
  warrantyApplicable: boolean; maintenanceApplicable: boolean; verificationApplicable: boolean; suggestedCondition: string | null; defaultDepartmentId: string | null; ownershipApplicability: string;
  ownershipApplicabilityLabel: string; active: boolean; policyVersion: number; version: number; template: string | null; createdAt: string; updatedAt: string | null;
  counts?: { total: number; active: number; ended: number; tracked: number; capitalized: number }; finance?: Finance; financePolicyComplete: boolean;
};
export type CategoryCan = { create?: boolean; edit: boolean; deactivate: boolean; finance: boolean; seeFinance: boolean; export?: boolean; history: boolean; delete?: boolean };
export type CategoryDetail = Category & { defaultDepartment: string | null; can: CategoryCan; accountOptions?: Array<{ id: string; code: string; name: string }> };
export type Template = { key: string; name: string; description: string; assetType: string; assetTypeLabel: string; guidance: string; serial: string; existing: string | null };
export type History = {
  events: Array<{ id: string; action: string; changes: Record<string, unknown>; version: number | null; reason: string | null; by: string | null; at: string }>;
  versions: Array<{ version: number; effectiveFrom: string; operational: Record<string, unknown>; finance: Record<string, unknown> | null; reason: string | null; by: string | null; at: string }>;
};
export type Impact = { from: { id: string; code: string; name: string }; to: { id: string; code: string; name: string }; operational: string[]; missing: string[];
  finance: { capitalized: boolean; differences: string[]; reviewRequired: boolean; note: string }; documentsToReview: number };
export type Reclassification = { id: string; number: string; assetId: string; asset: string; from: string; to: string; status: string; reason: string; impact: Impact | null; requestedBy: string | null;
  requestedAt: string; decidedBy: string | null; decidedAt: string | null; decisionNote: string | null; financeAdjustmentReference: string | null; href: string };

export const listCategories = (filters: Record<string, string | undefined>) => call<{ rows: Category[]; can: CategoryCan }>(qs(filters));
export const getCategory = (id: string) => call<{ category: CategoryDetail }>(`/${id}`).then((r) => r.category);
export const getHistory = (id: string) => call<History>(`/${id}/history`);
export const getCategoryAssets = (id: string) => call<{ rows: Array<{ id: string; code: string; name: string; lifecycleLabel: string; lifecycle: string; location: string | null; custodian: string | null; capitalizationLabel: string; href: string }>; total: number }>(`/${id}/assets`);
export const getTemplates = () => call<{ rows: Template[] }>("/actions/templates").then((r) => r.rows);
export const getSelectable = () => call<{ rows: Category[] }>("/actions/selectable").then((r) => r.rows);
export const getCategoryReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/actions/report${qs({ kind })}`).then((r) => r.rows);
export const getReclassifications = (filters: Record<string, string | undefined>) => call<{ rows: Reclassification[]; can: { decide: boolean } }>(`/actions/reclassifications${qs(filters)}`);
export const createCategory = (input: Record<string, unknown>) => send<{ categoryId: string; code: string }>("", input);
export const updateCategory = (id: string, input: Record<string, unknown>) => send<{ version: number; policyVersion: number; changed: string[] }>(`/${id}`, input, "PATCH");
export const categoryAction = <T = Record<string, unknown>>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/${id}/${action}`, input);
export const addStarters = (templates: string[]) => send<{ added: Array<{ name: string; code: string }>; skipped: Array<{ name: string; code: string }> }>("/actions/starter-templates", { templates });
export const decideReclassification = (input: Record<string, unknown>) => send<{ status: string }>("/actions/decide-reclassification", input);
export const categoriesExportHref = "/api/assets/categories/export";

export const LABELS = {
  assetType: { TANGIBLE: "Physical (tangible)", INTANGIBLE: "Non-physical (intangible)" },
  guidance: { CAPITALIZE: "Normally a fixed asset", TRACK_ONLY: "Normally tracked only", REVIEW: "Finance decides for each asset" },
  serial: { REQUIRED: "Required", OPTIONAL: "Optional", NOT_APPLICABLE: "Not applicable" },
  tag: { REQUIRED: "Required", OPTIONAL: "Optional" },
  custodian: { ALLOWED: "Can be assigned to a person", REQUIRED: "Must be assigned to a person when in use", NOT_APPLICABLE: "Not assigned to people" },
  ownership: { ANY: "Owned or external", OWNED_ONLY: "Company-owned only", EXTERNAL_ONLY: "Leased or third-party only" },
  condition: { NEW: "New", GOOD: "Good", FAIR: "Fair", DAMAGED: "Damaged", UNSERVICEABLE: "Unserviceable" },
  depreciationMethod: { straight_line: "Straight line", declining_balance: "Declining balance", units_of_production: "Units of production", none: "None" },
  convention: { full_month: "Full month", mid_month: "Mid-month", next_month: "From the next month" },
} as const;
export const optionsOf = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));
export const RECLASS_STATUS: Record<string, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  APPLIED: { label: "Applied", tone: "success" }, PENDING_FINANCE: { label: "Waiting for Finance", tone: "warning" }, REJECTED: { label: "Rejected", tone: "danger" }, WITHDRAWN: { label: "Withdrawn", tone: "neutral" },
};
