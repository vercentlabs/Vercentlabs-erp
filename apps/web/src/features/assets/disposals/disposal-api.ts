"use client";

import { AssetApiError, qs } from "../register/register-api";

// Assets — the client of /api/assets/disposals: disposal cases (one asset or many), approval, the physical exit, the sale invoice, Finance's carrying
// value and derecognition, completion, cancellation and correction, the reconciliation queue and reports. Amounts arrive as decimal strings
// (null without the disposal-financials permission).
export const DISPOSAL_BASE = "/assets/disposals";
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/assets/disposals${path}`, {
    credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AssetApiError(payload.message || "The request could not be completed.", response.status, payload.code, payload);
  return payload as T;
}
const send = <T = Record<string, unknown>>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });

export type Option = { value: string; label: string };
export type Issue = { code: string; message: string };
export type CaseRow = { id: string; number: string; type: string; typeLabel: string; status: string; statusLabel: string; reasonCode: string; reason: string; explanation: string; requestedDate: string;
  effectiveDate: string; buyer: string | null; buyerPartyId: string | null; recipient: string | null; recycler: string | null; recyclerSupplierId: string | null; destination: string | null; relatedParty: boolean; bulk: boolean;
  assets: number; disposed: number; assetCodes: string; firstAsset: string | null; proposedProceeds: string | null; exceptions: number; requestedBy: string | null; createdAt: string; legacy: boolean; version: number; href: string };
export type Picture = { assetId: string; tracked: boolean; effective: string; cost: string | null; accumulated: string | null; impairment: string | null; carrying: string | null; proceeds: string; costs: string;
  gainLoss: string | null; pendingDepreciation: string[]; issues: Issue[]; ready: boolean; note?: string };
export type CaseLine = { id: string; lineNumber: number; assetId: string; asset: string; assetNumber: string; serialNumber: string | null; category: string | null; status: string; statusLabel: string;
  lifecycleThen: string; lifecycleNow: string; availability: string; tracked: boolean; custodianThen: string | null; custodianNow: string | null; custodianType: string | null; locationThen: string | null;
  locationNow: string | null; transferInProgress: string | null; condition: string | null; proposedProceeds: string | null; disposalCosts: string | null; custodyException: string | null;
  handover: { kind: string; kindLabel: string; recipient?: string | null; reference?: string | null; evidence?: string | null; at?: string; by?: string | null; date: string | null } | null;
  saleInvoice: { id: string; number: string; status: string; proceeds: string | null; outstanding: string | null; outputTax: string | null; href: string } | null; incidentStatus: string | null;
  financialState: string | null; financialStateLabel: string | null; recognized: boolean; costLinks: Array<{ id: string; bill: string | null; amount: string | null; treatment: string }>;
  insurance: { reference: string; expected: string | null } | null;
  finance: { picture: (Picture & { grossConsideration?: string; tax?: string; currency?: string | null; foreign?: boolean; costsEstimated?: boolean; separateCosts?: string; costEstimate?: string; basisSource?: string; outcome?: string; residual?: string | null }) | null;
    confirmed: { version: number; kind: string; outcome: string | null; gross: string | null; tax: string | null; separateCosts: string | null; carrying: string; cost: string; accumulated: string; impairment: string; proceeds: string; costs: string; gainLoss: string; effective: string; at: string } | null;
    intent: { status: string; journalEntryId: string | null; journalNumber: string | null; reversalJournalEntryId: string | null; postingDate: string; result: string | null } | null } | null;
  milestone: string; milestoneLabel: string; agreedPrice: string | null; currency: string | null; priceRevision: { at: string; reason: string | null } | null; scrapMethod: string | null;
  certificate: { required: boolean; number: string | null; issuer: string | null; date: string | null; references: string | null };
  dispatch: { at: string; by: string | null; carrier: string | null; reference: string | null } | null; allocation: { basis: string; amount: string | null } | null;
  payment: { invoiced: string | null; tax: string | null; received: string | null; outstanding: string | null } | null; returnedAt: string | null;
  completedAt: string | null; reinstatedAt: string | null; reinstatementReason: string | null; checklist: Array<{ label: string; done: boolean; detail: string | null }>; href: string };
export type CaseDetail = CaseRow & { saleCurrency: string | null; scrapMethod: string | null; scrapMethodCode: string | null; generatedInvoiceId: string | null; decisionNote: string | null; cancelReason: string | null; requiredApprovals: Array<{ level: string; label: string; given: boolean }>;
  approvals: Array<{ level: string; levelLabel: string; approver: string | null; at: string; note: string | null; current: boolean }>; lines: CaseLine[];
  exceptions: Array<{ id: string; code: string; asset: string | null; detail: string | null; responsible: string; status: string; resolution: string | null; raisedAt: string; resolvedAt: string | null }>;
  events: Array<{ id: string; action: string; asset: string | null; from: string | null; to: string | null; reason: string | null; by: string; at: string }>; financials: boolean;
  can: Record<"edit" | "submit" | "approve" | "reject" | "amend" | "handover" | "linkInvoice" | "prepare" | "post" | "complete" | "recover" | "cancel" | "correct" | "reconcile" | "audit" | "financials"
    | "saleTerms" | "scrapTerms" | "allocate" | "createInvoice" | "dispatch" | "evidence" | "preview" | "linkCost" | "insurance" | "adjust", boolean> };
export type SnapshotRow = { id: string; version: number; kind: string; by: string | null; at: string; effective: string; carrying: string; proceeds: string; costs: string; gainLoss: string; outcome: string | null; status: string; reason: string | null };
export type ExecutionRow = { caseId: string; case: string; lineId: string; type: string; asset: string; buyer: string | null; scrapMethod: string | null; milestone: string; milestoneLabel: string;
  agreedPrice: string | null; currency: string | null; invoice: string | null; invoiceStatus: string | null; allocated: string | null; invoiceTax: string | null; invoicePaid: string | null; outstanding: string | null;
  certificate: string | null; certificateRequired: boolean; dispatchedAt: string | null; carrier: string | null; handoverAt: string | null; exceptions: number; href: string };
export type Overview = { drafts: number; pendingApproval: number; approved: number; pendingHandover: number; pendingFinance: number; completedThisYear: number; exceptions: number;
  can: Record<"create" | "bulk" | "reconcile" | "export" | "audit" | "financials", boolean> };
export type ExceptionRow = { id: string; code: string; label: string; case: string; caseId: string; asset: string | null; detail: string | null; responsible: string; status: string; resolution: string | null; raisedAt: string; href: string };
export type AssetPanel = { assetId: string; lifecycle: string; pendingCase: string | null; cases: CaseRow[];
  final: { case: string; type: string; status: string; date: string | null; handover?: string | null; recipient?: string | null; carrying: string | null; proceeds: string | null; gainLoss: string | null; journal?: string | null; reinstatementReason?: string | null } | null;
  can: { create: boolean } };

export const getOverview = () => call<Overview>("");
export const getOptions = () => call<{ buyers: Option[]; recyclers: Option[]; types: Option[]; reasons: Option[] }>("/view/options");
export const listCases = (view: string, search = "") => call<{ rows: CaseRow[]; can: Record<string, boolean> }>(`/cases${qs({ view, search: search || undefined })}`);
export const getCase = (id: string) => call<CaseDetail>(`/cases/${id}`);
export const createCase = (body: Record<string, unknown>) => send<{ caseId: string; number: string; status: string; blocked: Array<{ asset?: string; message: string }> }>("/cases", body);
export const validateAssets = (body: Record<string, unknown>) => send<{ eligible: number; blocked: number; lines: Array<{ asset?: string; ok: boolean; blockers: Issue[]; warnings: Issue[] }> }>("/cases/validate", body);
export const caseAction = <T = Record<string, unknown>>(id: string, action: string, body: Record<string, unknown> = {}) => send<T>(`/cases/${id}/${action}`, body);
export const getPreview = (id: string) => call<{ lines: Array<Picture & { lineId: string; asset: string }>; totals: Record<string, string> }>(`/cases/${id}/financial-preview`);
export const getExceptions = (status = "OPEN") => call<ExceptionRow[]>(`/view/exceptions${qs({ status })}`);
export const reconcile = () => send<{ checked: number; raised: number; resolved: number }>("/reconcile", {});
export const resolveException = (id: string, resolution: string) => send(`/exceptions/${id}/resolve`, { resolution });
export const getReport = (kind: string, filters: Record<string, string> = {}) => call<Array<Record<string, unknown>>>(`/view/report${qs({ kind, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) })}`);
export const getSnapshots = (caseId: string, lineId: string) => call<SnapshotRow[]>(`/cases/${caseId}/financial-snapshots${qs({ lineId })}`);
export const unlinkCost = (linkId: string, reason: string) => send(`/costs/${linkId}/unlink`, { reason });
export const getAudit = () => call<Array<{ id: string; case: string | null; asset: string | null; action: string; from: string | null; to: string | null; reason: string | null; by: string; at: string }>>("/view/audit");
export const getExecution = (type: string, milestone = "") => call<ExecutionRow[]>(`/view/execution${qs({ type, milestone: milestone || undefined })}`);
export const MILESTONE_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { NOT_STARTED: "neutral", SALE_DOCUMENT_PENDING: "warning", READY_FOR_HANDOVER: "info", IN_TRANSIT: "info",
  PHYSICAL_EXIT_CONFIRMED: "info", FINANCE_PENDING: "warning", COMPLETED: "success", EXCEPTION: "danger" };
export const SCRAP_METHOD_OPTIONS: Option[] = [{ value: "RECYCLER_COLLECTION", label: "Recycler collection" }, { value: "SUPERVISED_DESTRUCTION", label: "Supervised destruction" }, { value: "SCRAP_DEALER_SALE", label: "Sold to a scrap dealer" }];
export const getAssetPanel = (assetId: string) => call<AssetPanel>(`/assets/${assetId}`);
export const disposalExportHref = "/api/assets/disposals/export";

export const REPORT_KINDS = [
  { id: "register", label: "Asset disposal register" }, { id: "by-method", label: "Disposals by method" }, { id: "by-period", label: "Disposals by period" }, { id: "by-category", label: "Disposals by category" },
  { id: "gain-loss", label: "Disposal gains / losses" }, { id: "proceeds-vs-carrying", label: "Sale proceeds vs carrying value" }, { id: "pending-disposal", label: "Assets pending disposal" },
  { id: "handover-pending", label: "Physical handover pending" }, { id: "finance-pending", label: "Finance derecognition pending" }, { id: "write-offs", label: "Lost / damaged write-offs" },
  { id: "scrapped", label: "Scrapped asset register" }, { id: "corrections", label: "Corrections and reversals" }, { id: "reconciliation", label: "Disposal reconciliation" },
  { id: "by-location-department", label: "Disposals by location / department" },
  { id: "asset-sales", label: "Asset sale register" }, { id: "scrap-register", label: "Scrap / recycling register" }, { id: "sales-by-category", label: "Sales by asset category" },
  { id: "sale-proceeds-by-period", label: "Sale proceeds by period" }, { id: "scrap-proceeds-by-period", label: "Scrap proceeds by period" }, { id: "carrying-value-at-disposal", label: "Carrying value at disposal" },
  { id: "gain-loss-on-sale", label: "Gain / loss on sale" }, { id: "scrap-certificates-missing", label: "Scrap certificates missing" }, { id: "sale-invoice-reconciliation", label: "Sale invoice reconciliation" },
  { id: "returned-sales", label: "Returned / reversed sales" }, { id: "bulk-progress", label: "Bulk sale / scrap progress" },
  { id: "asset-gain-loss", label: "Disposal gain / loss by asset" }, { id: "monthly-gain-loss", label: "Monthly disposal gain / loss" }, { id: "annual-gain-loss", label: "Annual disposal gain / loss" },
  { id: "gains-by-category", label: "Gains by asset category" }, { id: "losses-by-category", label: "Losses by asset category" }, { id: "scrap-write-off-losses", label: "Scrap and write-off losses" },
  { id: "fully-depreciated-sales", label: "Fully depreciated asset sales" }, { id: "gain-loss-by-location", label: "Disposal gain / loss by location" }, { id: "gain-loss-by-department", label: "Disposal gain / loss by department" },
  { id: "pending-financial-results", label: "Pending financial disposal results" }, { id: "adjusted-results", label: "Adjusted / reversed disposal results" }, { id: "disposal-gl-reconciliation", label: "Disposal-to-GL reconciliation" },
];
export const GAIN_LOSS_KINDS = ["asset-gain-loss", "monthly-gain-loss", "annual-gain-loss", "gains-by-category", "losses-by-category", "scrap-write-off-losses", "fully-depreciated-sales", "gain-loss-by-location",
  "gain-loss-by-department", "pending-financial-results", "adjusted-results", "disposal-gl-reconciliation"];
type Tone = "neutral" | "info" | "success" | "warning" | "danger";
export const CASE_TONE: Record<string, Tone> = { DRAFT: "neutral", PENDING_APPROVAL: "warning", CHANGES_REQUESTED: "warning", REJECTED: "neutral", APPROVED: "info", PENDING_HANDOVER: "info",
  PENDING_FINANCE: "warning", POSTING: "warning", COMPLETED: "success", CANCELLED: "neutral", RECOVERY_REQUIRED: "danger" };
export const LINE_TONE: Record<string, Tone> = { ...CASE_TONE, COMPLETED: "success", REINSTATED: "warning" };
export const CONDITION_OPTIONS: Option[] = [{ value: "NEW", label: "New" }, { value: "GOOD", label: "Good" }, { value: "FAIR", label: "Fair" }, { value: "DAMAGED", label: "Damaged" }, { value: "UNSERVICEABLE", label: "Unserviceable" }];
export const HANDOVER_OPTIONS: Record<string, Option[]> = {
  SALE: [{ value: "BUYER_DELIVERY", label: "Delivered to the buyer" }],
  SCRAP: [{ value: "RECYCLER_RECEIPT", label: "Received by the recycler" }, { value: "DESTRUCTION", label: "Destroyed under supervision" }],
  DONATION: [{ value: "DONATION_RECEIPT", label: "Received by the recipient" }],
  WRITE_OFF_DAMAGED: [{ value: "DESTRUCTION", label: "Destroyed under supervision" }, { value: "RECYCLER_RECEIPT", label: "Received by the recycler" }, { value: "OTHER_EXIT", label: "Other authorized exit" }],
  OTHER_APPROVED_EXIT: [{ value: "OTHER_EXIT", label: "Other authorized exit" }, { value: "BUYER_DELIVERY", label: "Delivered to the buyer" }, { value: "RECYCLER_RECEIPT", label: "Received by the recycler" }, { value: "DESTRUCTION", label: "Destroyed" }],
};
