"use client";

// Assets — the client of /api/assets/register.
export const ASSETS_BASE = "/assets";
export const REGISTER_BASE = "/assets/register";
export class AssetApiError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string, public readonly details: Record<string, unknown> = {}) {
    super(message);
  }
}
export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/assets/register${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
export const send = <T = Record<string, unknown>>(path: string, body: unknown = {}, method = "POST") => call<T>(path, { method, body: JSON.stringify(body) });
export const qs = (params: Record<string, string | number | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  const text = search.toString();
  return text ? `?${text}` : "";
};
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorStatus = (error: unknown) => (error instanceof AssetApiError ? error.status : 0);
export const errorDetails = (error: unknown) => (error instanceof AssetApiError ? error.details : {});
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export type AssetRow = {
  id: string; code: string; name: string; description: string | null; categoryId: string; category: string | null; categoryCode: string | null; assetType: string; assetTypeLabel: string;
  ownership: string; ownershipLabel: string; capitalizationClass: string; capitalizationLabel: string; acquisitionMethod: string | null; acquisitionMethodLabel: string | null;
  manufacturer: string | null; model: string | null; serialNumber: string | null; tagCode: string | null; lifecycle: string; lifecycleLabel: string; availability: string; availabilityLabel: string;
  condition: string | null; conditionLabel: string; criticality: string; locationId: string | null; location: string | null; departmentId: string | null; department: string | null;
  custodianId: string | null; custodian: string | null; supplierId: string | null; supplier: string | null; purchaseDate: string | null; receivedDate: string | null; availableForUseDate: string | null;
  warrantyProvider: string | null; warrantyReference: string | null; warrantyStartDate: string | null; warrantyEndDate: string | null; warranty: "NONE" | "ACTIVE" | "EXPIRING" | "EXPIRED";
  statusChangedAt: string | null; holdReason: string | null; holdReasonLabel: string | null; missingReported: boolean; legacyCode: string | null; labelPrintedAt: string | null;
  supportContact: string | null; notes: string | null; lastVerifiedAt: string | null; verificationDue: boolean; lastVerification: string | null; hasSource: boolean; archived: boolean; version: number;
  createdAt: string; carryingAmount?: string | null; href: string;
};
export type AssetDetail = AssetRow & { qrPayload: string; parentAssetId: string | null; can: { actions: string[]; editDraft: boolean; editDetails: boolean; editCustody: boolean; acquisition: boolean; verify: boolean;
  financials: boolean; audit: boolean; archive: boolean; documents: boolean; confirmCost: boolean; reclassify: boolean; decideReclassification: boolean; printLabel: boolean } };
export type RegisterPage = { rows: AssetRow[]; total: number; page: number; pageSize: number; pages: number;
  can: { create: boolean; registerBulk: boolean; import: boolean; export: boolean; financials: boolean; categories: boolean; printLabels: boolean; exportIdentifiers: boolean; bulkStatus: boolean } };
export type OptionCategory = { id: string; code: string; name: string; asset_type: string; capitalization_guidance: string; serial_number_policy: string; asset_tag_policy: string; location_required: boolean;
  custodian_policy: string; suggested_condition: string | null; default_department_id: string | null };
export type Options = { categories: OptionCategory[];
  locations: Array<{ id: string; code: string; name: string }>; departments: Array<{ id: string; code: string; name: string }>; users: Array<{ id: string; email: string; name: string }>;
  suppliers: Array<{ id: string; code: string; name: string }>; labels: Record<string, Record<string, string>> };
export type Source = { sourceType: string; sourceLabel: string; sourceLineId: string; document: string; date: string | null; description: string | null; supplier: string | null; quantity: number;
  registered: number; available: number; proposedUnitCost?: string | null };

export const listAssets = (filters: Record<string, string | number | undefined>) => call<RegisterPage>(qs(filters));
export const getAsset = (id: string) => call<{ asset: AssetDetail }>(`/${id}`).then((r) => r.asset);
export const getAssetView = <T,>(id: string, view: string) => call<T>(`/${id}/${view}`);
export const getOptions = () => call<Options>("/actions/options");
export const getOverview = () => call<{ counts: Record<string, number>; byStatus: Array<{ status: string; label: string; count: number }>; byCategory: Array<{ name: string; n: number }>; exceptions: number; statusExceptions: number;
  can: { create: boolean; registerBulk: boolean; import: boolean } }>("/actions/overview");
export type Candidate = { assetId: string; code: string; name: string; serialNumber: string | null; tagCode: string | null; legacyCode: string | null; location: string | null; lifecycle: string;
  lifecycleLabel: string; matchedOn: string; matchedOnLabel: string; href: string };
export type LookupResult = { assetId?: string; href?: string; method: string; matchedOn?: string; matchedOnLabel?: string; ambiguous?: boolean; message?: string; matches: Candidate[] };
export const lookup = (value: string) => call<LookupResult>(`/actions/lookup${qs({ value })}`);
export const searchAssets = (q: string) => call<{ rows: Candidate[] }>(`/actions/search${qs({ q })}`).then((r) => r.rows);

export type Label = { assetId: string; code: string; name: string; tagCode: string | null; serialNumber: string | null; payload: string; qrSvg: string; barcodeSvg: string; labelPrintedAt: string | null; labelPrintCount: number };
export type Identification = Label & { version: number; manufacturer: string | null; model: string | null; legacyCode: string | null; category: string | null; serialPolicy: string; tagPolicy: string;
  serialMissing: boolean; tagMissing: boolean; duplicateAccepted: { reason: string; at: string } | null; note: string;
  aliases: Array<{ type: string; typeLabel: string; value: string; active: boolean; ambiguous: boolean; from: string; to: string | null }>;
  can: { editSerial: boolean; editTag: boolean; legacy: boolean; print: boolean; history: boolean; resolveDuplicate: boolean } };
export type IdentifierChange = { id: string; type: string; typeLabel: string; kind: string; kindLabel: string; from: string | null; to: string | null; reason: string | null; by: string | null; at: string };
export const getLabels = (filters: Record<string, string | undefined>) => call<{ rows: Label[]; more: boolean }>(`/actions/labels${qs(filters)}`);
export const markLabelsPrinted = (assetIds: string[]) => send<{ printed: number }>("/actions/labels-printed", { assetIds });
export const identifiersExportHref = "/api/assets/register/identifiers-export";
// One printable sheet of labels in a new window: QR, barcode, code, name and tag on each.
export function printLabelSheet(labels: Label[], title: string) {
  const win = window.open("", "_blank", "width=820,height=900");
  if (!win) return false;
  const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const cards = labels.map((l) => `<div class="l">${l.qrSvg}<div class="t"><strong>${esc(l.code)}</strong><span>${esc(l.name)}</span>${l.tagCode ? `<span>Tag ${esc(l.tagCode)}</span>` : ""}${l.barcodeSvg}</div></div>`).join("");
  win.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>body{font-family:sans-serif;margin:12px}.g{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.l{border:1px solid #000;padding:8px;display:flex;gap:8px;align-items:center;break-inside:avoid}.l svg{max-width:100%}.t{display:flex;flex-direction:column;gap:2px;font-size:12px;min-width:0}.t strong{font-size:16px}small{color:#555}</style></head><body><small>VERCENTLABS</small><div class="g">${cards}</div><script>window.onload=()=>{window.print()}</script></body></html>`);
  win.document.close();
  return true;
}
export const exportHref = (filters: Record<string, string | undefined>) => `/api/assets/register/export${qs(filters)}`;
export const createAsset = (input: Record<string, unknown>) => send<{ assetId: string; assetNumber: string }>("", input);
export const updateAsset = (id: string, input: Record<string, unknown>) => send<{ version: number; changed: string[] }>(`/${id}`, input, "PATCH");
export const assetAction = (id: string, action: string, input: Record<string, unknown> = {}) => send(`/${id}/${action}`, input);
export const registerAction = <T = Record<string, unknown>>(action: string, input: Record<string, unknown>) => send<T>(`/actions/${action}`, input);
export const getReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/actions/report${qs({ kind })}`).then((r) => r.rows);

export const LIFECYCLE_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { DRAFT: "neutral", REGISTERED: "info", ACTIVE: "success", ON_HOLD: "warning", RETIRED: "neutral", DISPOSED: "neutral", LOST: "danger" };
export const AVAILABILITY_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { AVAILABLE: "success", ASSIGNED: "info", IN_TRANSFER: "info", UNDER_MAINTENANCE: "warning", NOT_AVAILABLE: "neutral" };
export const CONDITION_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { NEW: "success", GOOD: "success", FAIR: "neutral", DAMAGED: "warning", UNSERVICEABLE: "danger", UNKNOWN: "neutral" };
export const WARRANTY_LABEL: Record<string, string> = { NONE: "No warranty recorded", ACTIVE: "Under warranty", EXPIRING: "Warranty ending soon", EXPIRED: "Warranty expired" };
export const ACTION_LABEL: Record<string, string> = { register: "Register", activate: "Commission", hold: "Place on hold", release: "Release hold", retire: "Retire", "confirm-lost": "Confirm lost",
  recover: "Record recovery", reinstate: "Reinstate", "report-missing": "Report missing", "close-missing": "Close missing report (found)", "record-condition": "Record condition" };

export type AssetStatus = { assetId: string; code: string; version: number; lifecycle: string; lifecycleLabel: string; statusChangedAt: string | null; availability: string; availabilityLabel: string;
  availabilityReason: string | null; condition: string; conditionLabel: string; conditionObservedAt: string | null; proposedCondition: { condition: string; label: string; reason: string | null; by: string | null; at: string } | null;
  finance: { classification: string; label: string; depreciating: boolean; fullyDepreciated?: boolean; note: string | null }; commissionedAt: string | null; availableForUseDate: string | null; retiredAt: string | null;
  hold: { id: string; number: string; reasonCode: string; reason: string; description: string; from: string; fromLabel: string; owner: string | null; reportedBy: string | null; since: string } | null;
  missing: { id: string; number: string; description: string; reportedBy: string | null; reportedAt: string; source: string; missingSince: string | null } | null;
  openWork: { transfer: string | null; maintenance: string | null }; actions: string[]; can: { history: boolean; bulk: boolean; recoverWithFinance: boolean } };
export type StatusHistory = {
  lifecycle: Array<{ id: string; fromLabel: string | null; toLabel: string; actionLabel: string; reason: string | null; by: string | null; at: string; effectiveDate: string | null }>;
  availability: Array<{ id: string; from: string; to: string; action: string; by: string | null; at: string }>;
  conditions: Array<{ id: string; from: string; to: string; observedOn: string; source: string; status: string; reason: string | null; by: string | null; at: string }>;
  holds: Array<{ id: string; number: string; reason: string; description: string; from: string; status: string; owner: string | null; since: string; releasedAt: string | null; releasedBy: string | null; releaseReason: string | null }>;
  incidents: Array<{ id: string; number: string; status: string; statusLabel: string; description: string; reportedBy: string | null; reportedAt: string; decidedBy: string | null; note: string | null }>;
};
export type BulkResult = { action: string; succeeded: number; failed: number; results: Array<{ assetId: string; assetNumber: string | null; ok: boolean; errorCode?: string; message?: string }> };
export const dateLabel = (value: string | null | undefined) => (value ? new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "—");
export const money = (value: string | null | undefined, currency = "INR") => (value === null || value === undefined ? "—" : `${currency === "INR" ? "₹" : `${currency} `}${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
