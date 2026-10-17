"use client";

// Assets — Asset Disposal. The Disposals workspace (overview, every case by stage, exceptions, reports, audit), one disposal case (each asset's
// snapshot, approvals, physical exit, sale invoice, Finance's carrying value and derecognition, the completion checklist) and the asset's
// disposal panel. An asset is shown Disposed only once its exit and (when capitalized) Finance's derecognition are both confirmed.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { dateLabel, errorMessage, errorStatus, money } from "../register/register-api";
import {
  CASE_TONE, CONDITION_OPTIONS, DISPOSAL_BASE, HANDOVER_OPTIONS, LINE_TONE, MILESTONE_TONE, REPORT_KINDS, SCRAP_METHOD_OPTIONS, caseAction, createCase, disposalExportHref, getAssetPanel, getAudit, getCase,
  getExceptions, getExecution, getOptions, getOverview, getReport, getSnapshots, listCases, reconcile, resolveException, unlinkCost, GAIN_LOSS_KINDS, type CaseDetail, type CaseLine, type Option,
} from "./disposal-api";

const VIEWS = [{ id: "overview", label: "Overview" }, { id: "all", label: "All Disposals" }, { id: "draft", label: "Draft Requests" }, { id: "approval", label: "Pending Approval" },
  { id: "approved", label: "Approved / Pending Execution" }, { id: "sales", label: "Sales" }, { id: "scrap", label: "Scrap / Recycling" }, { id: "handover", label: "Pending Physical Handover" }, { id: "finance", label: "Pending Finance" }, { id: "completed", label: "Completed" },
  { id: "exceptions", label: "Exceptions" }, { id: "reports", label: "Reports" }, { id: "audit", label: "Audit" }];
const rupees = (v: string | null | undefined) => (v === null || v === undefined ? "—" : money(v));
const codes = (v: unknown) => String(v ?? "").split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
const denied = (error: unknown, what: string) => (errorStatus(error) === 403 ? <PermissionState title={`You can't see ${what}`} description="It needs an asset disposal permission." /> : <Notice tone="danger">{errorMessage(error)}</Notice>);
const useRefresh = () => {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  return () => client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets") });
};
function useOptions(enabled = true) {
  const workspace = useWorkspaceContext();
  return useQuery({ queryKey: scopedQueryKey(workspace, "assets", "disposals", "options"), queryFn: getOptions, retry: false, enabled, staleTime: 60_000 });
}

// ------------------------------------------------------------------ new disposal
export function newDisposalAsk(options: { buyers: Option[]; recyclers: Option[]; types: Option[]; reasons: Option[] }, bulk: boolean, onDone: (id: string, blocked: string | null) => void, assetCode?: string): Ask {
  return { title: "New disposal", confirm: "Create", description: "Every asset is checked against its status, custody, location, transfers and maintenance. Approval does not dispose of anything: the asset leaves, Finance derecognizes it, and only then is it Disposed.",
    fields: [...(assetCode ? [] : [{ name: "assets", label: bulk ? "Assets (codes, serial numbers or tags — one per line)" : "Asset (code, serial number or tag)", kind: bulk ? "textarea" as const : "text" as const, required: true }]),
      { name: "disposalType", label: "Disposal type", kind: "select", required: true, initial: "SCRAP", options: options.types },
      { name: "reasonCode", label: "Reason", kind: "select", initial: "BEYOND_REPAIR", options: options.reasons }, { name: "explanation", label: "Explanation", kind: "textarea", required: true },
      { name: "proposedEffectiveDate", label: "Intended disposal date", kind: "date", required: true, initial: new Date().toISOString().slice(0, 10) },
      { name: "proposedProceeds", label: "Proposed proceeds per asset, before GST (sale or scrap sale)", kind: "quantity" }, { name: "buyerPartyId", label: "Buyer (customer)", kind: "select", options: options.buyers },
      { name: "recyclerSupplierId", label: "Recycler / scrap vendor", kind: "select", options: options.recyclers }, { name: "recipientName", label: "Donation recipient", kind: "text" },
      { name: "relatedParty", label: "Sale to an employee or related party (needs management approval)", kind: "checkbox" },
      ...(bulk ? [{ name: "skipBlocked", label: "Leave out assets that cannot be disposed of (they are listed)", kind: "checkbox" as const }] : [])],
    run: async (v, key) => {
      const list = assetCode ? [assetCode] : bulk ? codes(v.assets) : [String(v.assets).trim()];
      const r = await createCase({ ...v, assets: list.map((asset) => ({ asset, proposedProceeds: v.proposedProceeds || undefined })), buyerPartyId: v.buyerPartyId || undefined,
        recyclerSupplierId: v.recyclerSupplierId || undefined, recipientName: v.recipientName || undefined, idempotencyKey: key });
      onDone(r.caseId, r.blocked.length ? `${r.blocked.length} asset(s) left out: ${r.blocked.map((b) => b.message).join("; ")}` : null);
    } };
}

// ------------------------------------------------------------------ workspace
export function DisposalWorkspaceScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") ?? "overview");
  const select = (id: string) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Disposals" description="Sale, scrap, donation and write-off of assets. Management authorizes, the asset's exit is evidenced, Finance derecognizes it — and only then is it Disposed. Its history stays searchable." />
      <Tabs selectedKey={view} onSelectionChange={(k) => select(String(k))}>
        <TabList aria-label="Disposal views">{VIEWS.map((v) => <Tab key={v.id} id={v.id}>{v.label}</Tab>)}</TabList>
      </Tabs>
      {view === "overview" && <OverviewPanel onOpen={select} />}
      {["all", "draft", "approval", "approved", "handover", "finance", "completed"].includes(view) && <CasesPanel view={view} key={view} />}
      {view === "sales" && <ExecutionPanel type="SALE" key="sale" />}
      {view === "scrap" && <ExecutionPanel type="SCRAP" key="scrap" />}
      {view === "exceptions" && <ExceptionsPanel />}
      {view === "reports" && <ReportsPanel />}
      {view === "audit" && <AuditPanel />}
    </div>
  );
}
function OverviewPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "disposals", "overview"), queryFn: getOverview, retry: false });
  const options = useOptions(Boolean(q.data?.can.create));
  if (q.isLoading) return <LoadingState label="Loading disposals" rows={3} />;
  if (q.isError) return denied(q.error, "disposals");
  const d = q.data!;
  const tile = (label: string, value: number, view: string) => (
    <button type="button" key={label} onClick={() => onOpen(view)} className="rounded-md border border-border bg-surface p-3 text-left hover:border-brand">
      <span className="block text-xs text-text-muted">{label}</span><span className="text-xl font-semibold">{value}</span></button>);
  const created = (id: string) => router.replace(`${DISPOSAL_BASE}/${id}`);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {tile("Draft requests", d.drafts, "draft")}{tile("Pending approval", d.pendingApproval, "approval")}{tile("Approved, not yet started", d.approved, "approved")}
        {tile("Assets pending handover", d.pendingHandover, "handover")}{tile("Assets pending Finance", d.pendingFinance, "finance")}{tile("Disposed this year", d.completedThisYear, "completed")}{tile("Open exceptions", d.exceptions, "exceptions")}
      </div>
      <span className="flex flex-wrap gap-2">
        {d.can.create && options.data && <Button variant="primary" onPress={() => setAsk(newDisposalAsk(options.data!, false, created))}>New disposal</Button>}
        {d.can.bulk && options.data && <Button variant="secondary" onPress={() => setAsk(newDisposalAsk(options.data!, true, created))}>Bulk disposal</Button>}
        {d.can.export && <Link className="self-center text-sm text-brand hover:underline" href={disposalExportHref}>Export disposals</Link>}
      </span>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function CasesPanel({ view }: { view: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "disposals", "cases", view, search), queryFn: () => listCases(view, search), retry: false });
  const options = useOptions(Boolean(q.data?.can.create));
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <TextField label="Search" size="compact" value={search} onChange={setSearch} placeholder="Disposal, asset code, name or serial" />
        <span className="flex items-end gap-2 sm:col-span-2">{q.data?.can.create && options.data && <Button size="compact" variant="primary" onPress={() => setAsk(newDisposalAsk(options.data!, false, (id) => router.replace(`${DISPOSAL_BASE}/${id}`)))}>New disposal</Button>}
          {q.data?.can.bulk && options.data && <Button size="compact" variant="secondary" onPress={() => setAsk(newDisposalAsk(options.data!, true, (id) => router.replace(`${DISPOSAL_BASE}/${id}`)))}>Bulk disposal</Button>}</span>
      </div>
      {q.isLoading ? <LoadingState label="Loading disposals" rows={3} /> : q.isError ? denied(q.error, "disposals") : (
        <LinesTable columns={["Disposal", "Assets", "Type", "Status", "Intended date", { label: "Proposed proceeds", numeric: true }, "Buyer / recipient", "Requested"]} empty={q.data!.rows.length ? undefined : "No disposals here."}>
          {q.data!.rows.map((k) => <tr key={k.id}><Cell><Link className="text-brand hover:underline" href={k.href}>{k.number}</Link>{k.exceptions > 0 && <span className="block text-xs text-danger">{`${k.exceptions} exception(s)`}</span>}</Cell>
            <Cell>{k.bulk ? `${k.assets} assets (${k.disposed} disposed)` : `${k.assetCodes}${k.firstAsset ? ` · ${k.firstAsset}` : ""}`}</Cell><Cell>{k.typeLabel}</Cell>
            <Cell><StatusBadge tone={CASE_TONE[k.status] ?? "neutral"}>{k.statusLabel}</StatusBadge></Cell><Cell>{dateLabel(k.effectiveDate)}</Cell><Cell numeric>{rupees(k.proposedProceeds)}</Cell>
            <Cell>{k.buyer ?? k.recipient ?? k.recycler ?? "—"}</Cell><Cell>{`${k.requestedBy ?? ""} · ${dateLabel(k.createdAt)}`}</Cell></tr>)}
        </LinesTable>
      )}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
// Every approved sale or scrap asset with where its execution stands: sales document, handover, transit, Finance.
function ExecutionPanel({ type }: { type: string }) {
  const workspace = useWorkspaceContext();
  const [milestone, setMilestone] = useState("");
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "disposals", "execution", type, milestone), queryFn: () => getExecution(type, milestone), retry: false });
  const sale = type === "SALE";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select label="Progress" size="compact" selectedKey={milestone || "ALL"} onSelectionChange={(k) => setMilestone(String(k) === "ALL" ? "" : String(k))} options={[{ value: "ALL", label: "All" }, { value: "SALE_DOCUMENT_PENDING", label: "Sales document pending" },
          { value: "READY_FOR_HANDOVER", label: "Ready for handover" }, { value: "IN_TRANSIT", label: "In transit" }, { value: "PHYSICAL_EXIT_CONFIRMED", label: "Physical exit confirmed" }, { value: "FINANCE_PENDING", label: "Finance pending" },
          { value: "COMPLETED", label: "Completed" }, { value: "EXCEPTION", label: "Exception" }]} />
      </div>
      {q.isLoading ? <LoadingState label="Loading" rows={3} /> : q.isError ? denied(q.error, sale ? "asset sales" : "scrapping") : (
        <LinesTable columns={sale ? ["Disposal", "Asset", "Buyer", "Progress", { label: "Agreed price", numeric: true }, "Invoice", { label: "Proceeds (before GST)", numeric: true }, { label: "Received", numeric: true }, { label: "Outstanding", numeric: true }]
          : ["Disposal", "Asset", "Method", "Progress", { label: "Scrap value", numeric: true }, "Certificate", "Handover"]} empty={(q.data ?? []).length ? undefined : "Nothing here."}>
          {(q.data ?? []).map((x) => <tr key={x.lineId}><Cell><Link className="text-brand hover:underline" href={x.href}>{x.case}</Link></Cell><Cell>{x.asset}</Cell>
            {sale ? <><Cell>{x.buyer ?? "—"}</Cell><Cell><StatusBadge tone={MILESTONE_TONE[x.milestone] ?? "neutral"}>{x.milestoneLabel}</StatusBadge></Cell><Cell numeric>{rupees(x.agreedPrice)}</Cell>
              <Cell>{x.invoice ? `${x.invoice} · ${String(x.invoiceStatus).replace(/_/g, " ")}` : "—"}</Cell><Cell numeric>{rupees(x.allocated)}</Cell><Cell numeric>{rupees(x.invoicePaid)}</Cell><Cell numeric>{rupees(x.outstanding)}</Cell></>
              : <><Cell>{x.scrapMethod ?? "Not set"}</Cell><Cell><StatusBadge tone={MILESTONE_TONE[x.milestone] ?? "neutral"}>{x.milestoneLabel}</StatusBadge></Cell><Cell numeric>{rupees(x.agreedPrice ?? "0")}</Cell>
                <Cell>{x.certificate ?? (x.certificateRequired ? <span className="text-danger">Missing</span> : "Not required")}</Cell><Cell>{x.handoverAt ? formatDateTime(x.handoverAt) : x.dispatchedAt ? `In transit (${x.carrier})` : "—"}</Cell></>}
          </tr>)}
        </LinesTable>
      )}
    </div>
  );
}
function ExceptionsPanel() {
  const workspace = useWorkspaceContext();
  const refresh = useRefresh();
  const [status, setStatus] = useState("OPEN");
  const [note, setNote] = useState<string | null>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "disposals", "exceptions", status), queryFn: () => getExceptions(status), retry: false });
  const run = async () => { try { const r = await reconcile(); setNote(`${r.checked} asset disposal(s) checked: ${r.raised} new exception(s), ${r.resolved} resolved.`); await refresh(); } catch (e) { setNote(errorMessage(e)); } };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select label="Show" size="compact" selectedKey={status} onSelectionChange={(k) => setStatus(String(k))} options={[{ value: "OPEN", label: "Open" }, { value: "RESOLVED", label: "Resolved" }]} />
        <span className="flex items-end"><Button size="compact" variant="secondary" onPress={run}>Run reconciliation</Button></span>
      </div>
      {note && <Notice tone="info">{note}</Notice>}
      {q.isLoading ? <LoadingState label="Loading exceptions" rows={3} /> : q.isError ? denied(q.error, "disposal exceptions") : (
        <LinesTable columns={["Exception", "Disposal", "Asset", "Detail", "Responsible", ""]} empty={q.data!.length ? undefined : "Nothing to reconcile."}>
          {q.data!.map((x) => <tr key={x.id}><Cell>{x.label}</Cell><Cell><Link className="text-brand hover:underline" href={x.href}>{x.case}</Link></Cell><Cell>{x.asset ?? "—"}</Cell><Cell>{x.detail ?? ""}{x.resolution ? <span className="block text-xs text-text-muted">{x.resolution}</span> : null}</Cell>
            <Cell>{x.responsible.toLowerCase()}</Cell><Cell>{x.status === "OPEN" && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: "Resolve the exception", confirm: "Resolve", fields: [{ name: "resolution", label: "How it was resolved", kind: "textarea", required: true }],
              run: async (v) => { await resolveException(x.id, String(v.resolution)); await refresh(); } })}>Resolve</Button>}</Cell></tr>)}
        </LinesTable>
      )}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function ReportsPanel() {
  const workspace = useWorkspaceContext();
  const [kind, setKind] = useState(REPORT_KINDS[0].id);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const gl = GAIN_LOSS_KINDS.includes(kind);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "disposals", "report", kind, JSON.stringify(gl ? filters : {})), queryFn: () => getReport(kind, gl ? filters : {}), retry: false });
  const setFilter = (k: string) => (v: string) => setFilters((f) => ({ ...f, [k]: v }));
  const rows = q.data ?? [];
  const cols = rows.length ? Object.keys(rows[0]).filter((x) => !["href", "id"].includes(x)) : [];
  const flat = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <Panel title="Reports" actions={<Select aria-label="Report" size="compact" selectedKey={kind} onSelectionChange={(x) => setKind(String(x))} options={REPORT_KINDS.map((x) => ({ value: x.id, label: x.label }))} />}>
      <Notice tone="neutral">Proposed values come from the disposal request; confirmed values are Finance&apos;s figures at the derecognition date. Estimated results are never added into recognized ones.</Notice>
      {gl && <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
        <TextField label="Period (YYYY-MM or FY 2026-27)" size="compact" value={filters.period ?? ""} onChange={setFilter("period")} />
        <Select label="Result" size="compact" selectedKey={filters.result || "ALL"} onSelectionChange={(k) => setFilter("result")(String(k) === "ALL" ? "" : String(k))} options={[{ value: "ALL", label: "All" }, { value: "GAIN", label: "Gain" }, { value: "LOSS", label: "Loss" }, { value: "ZERO", label: "Zero" }]} />
        <Select label="Status" size="compact" selectedKey={filters.status || "ALL"} onSelectionChange={(k) => setFilter("status")(String(k) === "ALL" ? "" : String(k))} options={[{ value: "ALL", label: "All" }, { value: "RECOGNIZED", label: "Recognized (posted)" }, { value: "ESTIMATED", label: "Estimated — not posted" }]} />
        <TextField label="Asset code" size="compact" value={filters.asset ?? ""} onChange={setFilter("asset")} />
      </div>}
      {q.isLoading ? <LoadingState label="Loading" rows={3} /> : q.isError ? <Notice tone="warning">{errorMessage(q.error)}</Notice> : (
        <LinesTable columns={cols.length ? cols.map((x) => x.replace(/([A-Z])/g, " $1").replace(/^./, (y) => y.toUpperCase())) : ["Result"]} empty={rows.length ? undefined : "Nothing to show."}>
          {rows.map((r, i) => <tr key={i}>{cols.map((x, j) => <Cell key={x}>{j === 0 && typeof r.href === "string" ? <Link className="text-brand hover:underline" href={r.href}>{flat(r[x])}</Link> : flat(r[x])}</Cell>)}</tr>)}
        </LinesTable>
      )}
    </Panel>
  );
}
function AuditPanel() {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "disposals", "audit"), queryFn: getAudit, retry: false });
  if (q.isLoading) return <LoadingState label="Loading history" rows={3} />;
  if (q.isError) return denied(q.error, "the disposal history");
  return (
    <LinesTable columns={["When", "Disposal", "Asset", "Action", "Change", "By", "Reason"]} empty={q.data!.length ? undefined : "Nothing recorded yet."}>
      {q.data!.map((e) => <tr key={e.id}><Cell>{formatDateTime(e.at)}</Cell><Cell>{e.case ?? "—"}</Cell><Cell>{e.asset ?? "—"}</Cell><Cell>{e.action.replace(/_/g, " ").toLowerCase()}</Cell>
        <Cell>{e.from || e.to ? `${e.from ?? "—"} → ${e.to ?? "—"}` : ""}</Cell><Cell>{e.by}</Cell><Cell>{e.reason ?? ""}</Cell></tr>)}
    </LinesTable>
  );
}

// ------------------------------------------------------------------ one case
export function DisposalCaseScreen({ caseId }: { caseId: string }) {
  const workspace = useWorkspaceContext();
  const refresh = useRefresh();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [result, setResult] = useState<{ tone: "info" | "warning"; text: string } | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "disposals", "case", caseId), queryFn: () => getCase(caseId), retry: false });
  if (q.isLoading) return <LoadingState label="Loading disposal" rows={5} />;
  if (q.isError) return denied(q.error, "this disposal");
  const k = q.data!;
  const act = (action: string, title: string, confirm: string, description: string, fields: Ask["fields"] = [], tone: "primary" | "danger" = "primary", shape?: (v: Record<string, string | boolean>) => Record<string, unknown>): Ask => ({
    title, confirm, description, fields, tone,
    run: async (v, key) => {
      try {
        const r = await caseAction<{ results?: Array<{ asset: string; message?: string; code?: string }>; status?: string }>(k.id, action, { ...(shape ? shape(v) : v), expectedVersion: k.version, commandId: key });
        const pending = r.results?.filter((x) => x.code) ?? [];
        setResult(pending.length ? { tone: "warning", text: pending.map((x) => `${x.asset}: ${x.message}`).join(" · ") } : null);
      } finally { await refresh(); }
    } });
  const reason = [{ name: "reason", label: "Reason", kind: "textarea" as const, required: true }];
  const live = k.lines.filter((l) => !["CANCELLED", "REJECTED"].includes(l.status));
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${k.number} · ${k.typeLabel}`} description={`${k.bulk ? `${k.assets} assets` : k.lines[0]?.asset ?? ""} · ${k.reason}`}
        primaryAction={<span className="flex flex-wrap gap-2">
          {k.can.submit && <Button variant="primary" onPress={() => setAsk(act("submit", "Submit for approval", "Submit", "The assets are checked again, and the approvals this disposal needs under the Company's policy are requested."))}>Submit</Button>}
          {k.can.approve && <Button variant="primary" onPress={() => setAsk(act("approve", "Approve the disposal", "Approve", `Approval authorizes the disposal process; it does not dispose of anything. Still needed: ${k.requiredApprovals.filter((a) => !a.given).map((a) => a.label).join(", ") || "—"}.`,
            [{ name: "note", label: "Note", kind: "textarea" }, ...(k.lines.some((l) => l.availability === "UNDER_MAINTENANCE") ? [{ name: "supersedeMaintenance", label: "Supersede the open repair work (it is cancelled)", kind: "checkbox" as const }] : [])]))}>Approve</Button>}
          {k.can.reject && <Button variant="secondary" onPress={() => setAsk(act("reject", "Send back for changes", "Send back", "The requester corrects the details or evidence and submits again.", reason, "primary", (v) => ({ ...v, decision: "REQUEST_CHANGES" })))}>Request changes</Button>}
          {k.can.reject && <Button variant="secondary" onPress={() => setAsk(act("reject", "Reject the disposal", "Reject", "The disposal is not authorized; the request stays on record.", reason, "danger", (v) => ({ ...v, decision: "REJECT" })))}>Reject</Button>}
          {k.can.amend && <Button variant="secondary" onPress={() => setAsk(act("amend", "Amend the disposal", "Amend", "A material change: every approval given so far no longer counts, and the disposal is approved again.",
            [{ name: "proposedEffectiveDate", label: "Intended disposal date", kind: "date", initial: k.effectiveDate }, ...(k.lines.length === 1 ? [{ name: "proceeds", label: "Proposed proceeds", kind: "quantity" as const, initial: k.lines[0].proposedProceeds ?? "" }] : []), ...reason], "primary",
            (v) => ({ proposedEffectiveDate: v.proposedEffectiveDate, reason: v.reason, ...(k.lines.length === 1 && v.proceeds !== "" ? { lines: [{ lineId: k.lines[0].id, proposedProceeds: v.proceeds }] } : {}) })))}>Amend</Button>}
          {k.can.saleTerms && <Button variant="secondary" onPress={() => setAsk(act("sale-details", "Sale terms", "Save", "The currency and each asset's agreed price before GST. Changing an agreed price later is a revision by an approver, with a reason.",
            [{ name: "currency", label: "Currency", kind: "text", initial: k.saleCurrency ?? "INR" }, ...live.map((l) => ({ name: `price_${l.id}`, label: `Agreed price — ${l.assetNumber}`, kind: "quantity" as const, initial: l.agreedPrice ?? l.proposedProceeds ?? "" })),
              { name: "reason", label: "Reason (for a revision)", kind: "textarea" as const }], "primary",
            (v) => ({ currency: v.currency, reason: v.reason, lines: live.map((l) => ({ lineId: l.id, agreedPrice: v[`price_${l.id}`] })).filter((x) => x.agreedPrice !== "") })))}>Sale terms</Button>}
          {k.can.scrapTerms && <Button variant="secondary" onPress={() => setAsk(act("scrap-details", "Scrap details", "Save", "How the assets are scrapped. A recycler's collection needs its certificate; a scrap dealer's purchase is invoiced through Sales.",
            [{ name: "scrapMethod", label: "Method", kind: "select", required: true, initial: k.scrapMethodCode ?? "RECYCLER_COLLECTION", options: SCRAP_METHOD_OPTIONS }], "primary"))}>Scrap details</Button>}
          {k.can.createInvoice && <Button variant="secondary" onPress={() => setAsk(act("create-sale-invoice", "Create the Sales Invoice", "Create draft invoice", "A draft Sales Invoice to the buyer, one line per asset at its agreed price. Finance sets its GST treatment and posts it in Sales; it is created only once."))}>Create Sales Invoice</Button>}
          {k.can.allocate && live.length > 1 && <Button variant="secondary" onPress={() => setAsk(act("allocate-proceeds", "Share an invoice's proceeds", "Allocate", "The invoice's amount before GST is shared among the assets; the shares always add up to it, rounded deterministically.",
            [{ name: "invoice", label: "Invoice number", kind: "text", required: true }, { name: "basis", label: "Basis", kind: "select", initial: "AGREED_PRICE", options: [{ value: "AGREED_PRICE", label: "In proportion to the agreed prices" }, { value: "EQUAL", label: "Equally" }] }]))}>Allocate proceeds</Button>}
          {k.can.complete && <Button variant="primary" onPress={() => setAsk(act("complete", "Complete the disposal", "Complete", "Every asset whose exit, sale invoice, final depreciation and Finance derecognition are confirmed is marked Disposed; the others stay pending with their reason."))}>Complete</Button>}
          {k.can.cancel && <Button variant="secondary" onPress={() => setAsk(act("cancel", "Cancel the disposal", "Cancel disposal", "Only before any asset has left, been invoiced or posted. The request stays on record; its restrictions end.", reason, "danger"))}>Cancel</Button>}
        </span>} />
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
      {k.legacy && <Notice tone="neutral">Carried over from the earlier disposal list.</Notice>}
      {k.status === "RECOVERY_REQUIRED" && <Notice tone="danger">A Finance posting is being verified. Do not post it again — use Verify posting.</Notice>}
      {k.decisionNote && ["CHANGES_REQUESTED", "REJECTED"].includes(k.status) && <Notice tone="warning">{k.decisionNote}</Notice>}
      <Panel title="Disposal"><FactList columns={3} items={[["Status", <StatusBadge key="s" tone={CASE_TONE[k.status] ?? "neutral"}>{k.statusLabel}</StatusBadge>], ["Type", k.typeLabel], ["Reason", k.reason],
        ["Intended date", dateLabel(k.effectiveDate)], ["Buyer", k.buyer ?? "—"], ["Recycler", k.recycler ?? "—"], ["Recipient", k.recipient ?? "—"], ["Related party", k.relatedParty ? "Yes" : "No"],
        ["Requested", `${k.requestedBy ?? ""} · ${dateLabel(k.requestedDate)}`], ["Approvals", k.requiredApprovals.map((a) => `${a.label}${a.given ? " ✓" : ""}`).join(" · ") || "—"], ["Explanation", k.explanation]] as Array<[string, ReactNode]>} /></Panel>
      {live.map((l) => <LinePanel key={l.id} k={k} l={l} act={act} onAsk={setAsk} />)}
      {k.lines.some((l) => ["CANCELLED", "REJECTED"].includes(l.status)) && <Panel title="Removed from this disposal"><LinesTable columns={["Asset", "Status"]}>{k.lines.filter((l) => ["CANCELLED", "REJECTED"].includes(l.status)).map((l) => <tr key={l.id}><Cell>{l.asset}</Cell><Cell>{l.statusLabel}</Cell></tr>)}</LinesTable></Panel>}
      {k.approvals.length > 0 && <Panel title="Approvals"><LinesTable columns={["Approval", "By", "When", "Note", ""]}>
        {k.approvals.map((a, i) => <tr key={i}><Cell>{a.levelLabel}</Cell><Cell>{a.approver ?? "—"}</Cell><Cell>{formatDateTime(a.at)}</Cell><Cell>{a.note ?? ""}</Cell><Cell>{a.current ? "" : <span className="text-text-muted">Superseded by a change</span>}</Cell></tr>)}
      </LinesTable></Panel>}
      {k.exceptions.length > 0 && <Panel title="Exceptions"><LinesTable columns={["Exception", "Asset", "Detail", "Responsible", "Status"]}>
        {k.exceptions.map((x) => <tr key={x.id}><Cell>{x.code.replace(/_/g, " ").toLowerCase()}</Cell><Cell>{x.asset ?? "—"}</Cell><Cell>{x.detail ?? ""}</Cell><Cell>{x.responsible.toLowerCase()}</Cell><Cell>{x.status.toLowerCase()}</Cell></tr>)}
      </LinesTable></Panel>}
      <Panel title="Activity"><LinesTable columns={["When", "What", "Asset", "By", "Note"]} empty={k.events.length ? undefined : "Nothing yet."}>
        {k.events.map((e) => <tr key={e.id}><Cell>{formatDateTime(e.at)}</Cell><Cell>{e.action.replace(/_/g, " ").toLowerCase()}</Cell><Cell>{e.asset ?? ""}</Cell><Cell>{e.by}</Cell><Cell>{e.reason ?? ""}</Cell></tr>)}
      </LinesTable></Panel>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
type ActFn = (action: string, title: string, confirm: string, description: string, fields?: Ask["fields"], tone?: "primary" | "danger", shape?: (v: Record<string, string | boolean>) => Record<string, unknown>) => Ask;
function LinePanel({ k, l, act, onAsk }: { k: CaseDetail; l: CaseLine; act: ActFn; onAsk: (a: Ask) => void }) {
  const p = l.finance?.picture ?? null;
  const intent = l.finance?.intent ?? null;
  const withLine = (v: Record<string, string | boolean>) => ({ ...v, lineId: l.id });
  const kinds = HANDOVER_OPTIONS[k.type] ?? [];
  const actions = <span className="flex flex-wrap gap-2">
    {k.can.handover && l.status === "PENDING_HANDOVER" && <Button size="compact" variant="primary" onPress={() => onAsk(act("confirm-handover", "Confirm the physical exit", "Confirm", `Scan the asset as it leaves. ${l.custodianType && ["EMPLOYEE", "DEPARTMENT"].includes(l.custodianType) ? `It is still with ${l.custodianNow}: return it first, or record an authorized exception.` : ""}`,
      [{ name: "identifier", label: `Scan or type ${l.assetNumber}'s code, serial or tag`, kind: "text", required: true }, { name: "handoverKind", label: "How it left", kind: "select", required: true, initial: kinds[0]?.value, options: kinds },
        { name: "condition", label: "Condition at disposal", kind: "select", required: true, options: CONDITION_OPTIONS }, { name: "dispositionDate", label: "Date it left", kind: "date", required: true, initial: new Date().toISOString().slice(0, 10) },
        { name: "recipient", label: "Received by", kind: "text" }, { name: "reference", label: "Delivery note / certificate reference", kind: "text" }, { name: "evidence", label: "Evidence", kind: "textarea" },
        ...(l.custodianType && ["EMPLOYEE", "DEPARTMENT"].includes(l.custodianType) ? [{ name: "custodyException", label: "Authorized custody exception (why it leaves without being returned first)", kind: "textarea" as const }] : [])], "primary", withLine))}>Confirm handover</Button>}
    {k.can.dispatch && l.status === "PENDING_HANDOVER" && !l.dispatch && <Button size="compact" variant="secondary" onPress={() => onAsk(act("dispatch", "Dispatch with a carrier", "Dispatch", "The asset is in transit until the buyer's receipt is confirmed; dispatch never disposes of it.",
      [{ name: "identifier", label: `Scan or type ${l.assetNumber}'s code, serial or tag`, kind: "text", required: true }, { name: "carrier", label: "Carrier", kind: "text", required: true }, { name: "reference", label: "Consignment / LR number", kind: "text" }], "primary", withLine))}>Dispatch</Button>}
    {k.can.evidence && !["COMPLETED", "CANCELLED"].includes(l.status) && <Button size="compact" variant="secondary" onPress={() => onAsk(act("record-scrap-evidence", "Scrap evidence", "Save", "The recycler's certificate or the destruction record. It is kept as evidence; it does not certify legal compliance.",
      [{ name: "certificateNumber", label: "Certificate number", kind: "text", initial: l.certificate.number ?? "" }, { name: "issuer", label: "Issued by", kind: "text", initial: l.certificate.issuer ?? "" }, { name: "certificateDate", label: "Date", kind: "date", initial: l.certificate.date ?? "" },
        { name: "references", label: "Photos / documents (references)", kind: "textarea", initial: l.certificate.references ?? "" }], "primary", withLine))}>Scrap evidence</Button>}
    {k.can.correct && l.status === "COMPLETED" && k.type === "SALE" && l.saleInvoice && !l.returnedAt && <Button size="compact" variant="secondary" onPress={() => onAsk(act("correct", "Buyer returned the asset", "Record return", "Sales has posted the Credit Note. Finance reverses the derecognition; the asset returns as Retired for review — never Active automatically.",
      [{ name: "creditNote", label: "Credit Note number", kind: "text", required: true }, { name: "identifier", label: `Scan or type ${l.assetNumber}'s code, serial or tag`, kind: "text", required: true }, { name: "reason", label: "Why it was returned", kind: "textarea", required: true }], "primary",
      (v) => ({ ...v, lineId: l.id, kind: "RETURNED_AFTER_SALE" })))}>Buyer returned it</Button>}
    {k.can.linkInvoice && !l.saleInvoice && ["PENDING_HANDOVER", "PENDING_FINANCE"].includes(l.status) && <Button size="compact" variant="secondary" onPress={() => onAsk(act("link-sale-invoice", "Link the Sales Invoice", "Link", "The posted Sales Invoice of this sale, to the buyer. Its amount before GST is the proceeds; the output GST is never proceeds.",
      [{ name: "invoice", label: "Invoice number", kind: "text", required: true }, ...(k.bulk ? [{ name: "amount", label: "Amount of the invoice for this asset (before GST)", kind: "quantity" as const }] : [])], "primary", withLine))}>Link Sales Invoice</Button>}
    {k.can.linkInvoice && l.saleInvoice && l.status !== "COMPLETED" && <Button size="compact" variant="secondary" onPress={() => onAsk(act("unlink-sale-invoice", "Unlink the invoice", "Unlink", "When Sales credited or replaced it.", [{ name: "reason", label: "Reason (credit note)", kind: "textarea", required: true }], "danger", withLine))}>Unlink invoice</Button>}
    {k.can.preview && !l.tracked && ["PENDING_HANDOVER", "PENDING_FINANCE"].includes(l.status) && <Button size="compact" variant="secondary" onPress={() => onAsk(act("recalculate-financials", "Recalculate the preview", "Recalculate", "Finance's figures are read again and a new preview version is kept. A preview is an estimate; nothing is approved or posted.", [], "primary", withLine))}>Recalculate preview</Button>}
    {k.can.prepare && l.status === "PENDING_FINANCE" && !l.tracked && intent?.status !== "POSTED" && <Button size="compact" variant="secondary" onPress={() => onAsk(act("approve-financials", "Approve the disposal result", "Approve result", `Finance approves the result at ${dateLabel(p?.effective)}: cost ${rupees(p?.cost)}, accumulated depreciation ${rupees(p?.accumulated)}, carrying amount ${rupees(p?.carrying)}, consideration before GST ${rupees(p?.proceeds)}, disposal costs ${rupees(p?.costs)} — ${p?.outcome === "LOSS" ? "loss" : p?.outcome === "GAIN" ? "gain" : "result"} ${rupees(p?.gainLoss)}. Someone else posts it.`, [], "primary", withLine))}>Approve result</Button>}
    {k.can.linkCost && ["PENDING_HANDOVER", "PENDING_FINANCE"].includes(l.status) && !l.recognized && <Button size="compact" variant="secondary" onPress={() => onAsk(act("link-cost", "Link a disposal cost", "Link", "A posted supplier bill (transport, dismantling, commission) as this asset's direct disposal cost — never counted twice.",
      [{ name: "bill", label: "Supplier bill number", kind: "text", required: true }, { name: "amount", label: "Amount for this asset (before GST; blank = the rest of the bill)", kind: "quantity" },
        { name: "treatment", label: "Treatment", kind: "select", initial: "NET_PROCEEDS", options: [{ value: "NET_PROCEEDS", label: "Reduces the disposal proceeds" }, { value: "SEPARATE_EXPENSE", label: "Shown as a separate expense" }] }], "primary", withLine))}>Link disposal cost</Button>}
    {k.can.insurance && l.status !== "CANCELLED" && <Button size="compact" variant="secondary" onPress={() => onAsk(act("record-insurance-claim", "Insurance claim", "Save", "Recorded beside the disposal for Finance. It never reduces the disposal loss; Finance decides whether and when the recovery is recognized.",
      [{ name: "reference", label: "Claim reference", kind: "text", required: true, initial: l.insurance?.reference ?? "" }, { name: "expectedAmount", label: "Expected recovery", kind: "quantity", initial: l.insurance?.expected ?? "" }], "primary", withLine))}>Insurance claim</Button>}
    {k.can.adjust && l.status === "COMPLETED" && l.saleInvoice && intent?.status === "POSTED" && <Button size="compact" variant="secondary" onPress={() => onAsk(act("adjust-result", "Adjust after a Credit Note", "Adjust", "Finance reverses the original disposal journal and posts the adjusted result; the original and the adjusted versions both stay.",
      [{ name: "creditNote", label: "Credit Note number", kind: "text", required: true }, { name: "amount", label: "Credited for this asset (before GST)", kind: "quantity", required: true }, { name: "reason", label: "Reason", kind: "textarea", required: true }], "primary", withLine))}>Adjust result</Button>}
    {k.can.post && intent?.status === "PREPARED" && l.status === "PENDING_FINANCE" && <Button size="compact" variant="primary" onPress={() => onAsk(act("post-derecognition", "Post the derecognition", "Post", "One Finance journal removes the cost and accumulated depreciation and books the gain or loss — exactly once. The accounting period must be open.", [], "primary", withLine))}>Post derecognition</Button>}
    {k.can.complete && l.status === "PENDING_FINANCE" && (l.tracked || intent?.status === "POSTED") && <Button size="compact" variant="primary" onPress={() => onAsk(act("complete", "Complete this asset", "Complete", "The asset is marked Disposed; its custody ends and its history stays.", [], "primary", withLine))}>Complete</Button>}
    {k.can.recover && (["POSTING", "RECOVERY_REQUIRED"].includes(l.status) || (intent?.status === "POSTED" && l.status !== "COMPLETED")) && <Button size="compact" variant="primary" onPress={() => onAsk(act("recover", "Verify the posting", "Verify", "Finance's journal is looked up for this asset. Found, the disposal completes from it; not found, it can be posted. It is never posted twice.", [], "primary", withLine))}>Verify posting</Button>}
    {k.can.cancel && k.bulk && ["PENDING_APPROVAL", "PENDING_HANDOVER", "DRAFT"].includes(l.status) && !l.saleInvoice && <Button size="compact" variant="secondary" onPress={() => onAsk(act("cancel", "Remove this asset", "Remove", "This asset stays in use; the others continue.", [{ name: "reason", label: "Reason", kind: "textarea", required: true }], "danger", withLine))}>Remove asset</Button>}
    {k.can.correct && l.status === "PENDING_FINANCE" && l.handover && l.handover.kind !== "LOSS_EVIDENCE" && <Button size="compact" variant="secondary" onPress={() => onAsk(act("correct", "Record the asset's return", "Record return", "The buyer or recipient returned it before the disposal completed. The handover stays on record.", [{ name: "reason", label: "What happened", kind: "textarea", required: true }, { name: "evidence", label: "Evidence", kind: "textarea" }], "primary", (v) => ({ ...v, lineId: l.id, kind: "RETURNED_BEFORE_COMPLETION" })))}>Record return</Button>}
    {k.can.correct && l.status === "COMPLETED" && <Button size="compact" variant="secondary" onPress={() => onAsk(act("correct", "Reverse and reinstate", "Reverse", "Finance reverses the derecognition journal; the asset returns as Retired with the same code and history, and Finance reviews its depreciation.", [{ name: "reason", label: "Why", kind: "textarea", required: true }], "danger", (v) => ({ ...v, lineId: l.id, kind: "REVERSE_AND_REINSTATE" })))}>Reverse disposal</Button>}
  </span>;
  return (
    <Panel title={`${l.asset} — ${l.statusLabel}`} actions={actions}>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 flex flex-col gap-3">
          <FactList columns={2} items={[["Status", <StatusBadge key="s" tone={LINE_TONE[l.status] ?? "neutral"}>{l.statusLabel}</StatusBadge>],
            ...(["SALE", "SCRAP"].includes(k.type) ? [["Progress", <StatusBadge key="m" tone={MILESTONE_TONE[l.milestone] ?? "neutral"}>{l.milestoneLabel}</StatusBadge>] as [string, ReactNode],
              ["Agreed price", l.agreedPrice ? `${rupees(l.agreedPrice)}${l.currency && l.currency !== "INR" ? ` ${l.currency}` : ""}${l.priceRevision ? " (revised)" : ""}` : "—"] as [string, ReactNode]] : []),
            ...(l.scrapMethod ? [["Scrap method", l.scrapMethod] as [string, ReactNode]] : []),
            ...(l.certificate.required || l.certificate.number ? [["Scrap evidence", l.certificate.number ? `${l.certificate.number}${l.certificate.issuer ? ` · ${l.certificate.issuer}` : ""}` : "Required — not recorded"] as [string, ReactNode]] : []),
            ...(l.dispatch ? [["Dispatched", `${formatDateTime(l.dispatch.at)} · ${l.dispatch.carrier ?? ""}${l.dispatch.reference ? ` · ${l.dispatch.reference}` : ""}`] as [string, ReactNode]] : []),
            ...(l.payment ? [["Invoiced / received / outstanding", `${rupees(l.payment.invoiced)} (GST ${rupees(l.payment.tax)}) · ${rupees(l.payment.received)} · ${rupees(l.payment.outstanding)}`] as [string, ReactNode]] : []),
            ...(l.allocation ? [["Proceeds allocated", `${rupees(l.allocation.amount)} (${l.allocation.basis.toLowerCase().replace(/_/g, " ")})`] as [string, ReactNode]] : []),
            ...(l.returnedAt ? [["Returned by the buyer", formatDateTime(l.returnedAt)] as [string, ReactNode]] : []), ["Lifecycle", `${l.lifecycleThen.toLowerCase()} when requested · ${l.lifecycleNow.toLowerCase()} now`],
            ["Custodian", `${l.custodianThen ?? "none"} when requested · ${l.custodianNow ?? "none"} now`], ["Location", `${l.locationThen ?? "—"} when requested · ${l.locationNow ?? "—"} now`],
            ["Transfer in progress", l.transferInProgress ?? "None"], ["Condition", l.condition?.toLowerCase() ?? "—"], ["Kind", l.tracked ? "Tracked only (no fixed-asset balance)" : "Capitalized"],
            ...(l.custodyException ? [["Custody exception", l.custodyException] as [string, ReactNode]] : []),
            ["Handover", l.handover ? `${l.handover.kindLabel}${l.handover.recipient ? ` — ${l.handover.recipient}` : ""} · ${dateLabel(l.handover.date)}${l.handover.reference ? ` · ${l.handover.reference}` : ""}` : "Not yet"],
            ["Sales Invoice", l.saleInvoice ? <Link key="i" className="text-brand hover:underline" href={l.saleInvoice.href}>{`${l.saleInvoice.number} · ${l.saleInvoice.status.replace(/_/g, " ")}${l.saleInvoice.outstanding ? ` · outstanding ${rupees(l.saleInvoice.outstanding)}` : ""}`}</Link> : "—"],
            ...(l.reinstatementReason ? [["Reinstated", l.reinstatementReason] as [string, ReactNode]] : [])]} />
          {l.finance && !l.tracked && <GainLossPanel k={k} l={l} />}
          {p && p.issues.length > 0 && l.status !== "COMPLETED" && <Notice tone="warning">{p.issues.map((x) => x.message).join(" · ")}</Notice>}
          {l.tracked && l.status !== "COMPLETED" && <Notice tone="neutral">Tracked only: no fixed-asset balance is derecognized. Any sale is still invoiced through Sales.</Notice>}
        </div>
        <div>
          <span className="mb-2 block text-sm font-medium">Completion steps</span>
          <ul className="flex flex-col gap-1 text-sm">{l.checklist.map((s, i) => <li key={i} className={s.done ? "text-success" : "text-text-muted"}>{`${s.done ? "✓" : "○"} ${s.label}`}{s.detail && <span className="block pl-4 text-xs text-text-muted">{s.detail}</span>}</li>)}</ul>
        </div>
      </div>
    </Panel>
  );
}

// ------------------------------------------------------------------ Gain / Loss on Disposal: the financial outcome of one asset
function GainLossPanel({ k, l }: { k: CaseDetail; l: CaseLine }) {
  const workspace = useWorkspaceContext();
  const refresh = useRefresh();
  const [history, setHistory] = useState(false);
  const versions = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "disposals", "snapshots", l.id), queryFn: () => getSnapshots(k.id, l.id), retry: false, enabled: history });
  const p = l.finance?.picture ?? null;
  const conf = l.finance?.confirmed ?? null;
  const intent = l.finance?.intent ?? null;
  const shown = l.recognized && conf ? conf : null;
  const v = (a?: string | null, b?: string | null) => rupees(shown ? a : (b ?? a));
  const gain = shown ? conf!.gainLoss : p?.gainLoss ?? conf?.gainLoss ?? null;
  const outcome = gain === null ? null : Number(gain) > 0 ? "gain" : Number(gain) < 0 ? "loss" : "zero gain / loss";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      <span className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">Gain / Loss on Disposal</span>
        <StatusBadge tone={l.recognized ? "success" : "warning"}>{l.financialStateLabel ?? (l.recognized ? "Posted" : "Not posted")}</StatusBadge></span>
      <FactList columns={3} items={[["Gross capitalized cost", v(conf?.cost, p?.cost)], ["Accumulated depreciation", v(conf?.accumulated, p?.accumulated)], ["Impairment", v(conf?.impairment, p?.impairment)],
        ["Carrying amount", v(conf?.carrying, p?.carrying)], ...(p?.residual ? [["Residual value (not the carrying amount)", rupees(p.residual)] as [string, ReactNode]] : []),
        ["Consideration (before GST)", v(conf?.proceeds, p?.proceeds)], ["Output GST (not proceeds)", rupees(shown ? conf?.tax : p?.tax ?? l.saleInvoice?.outputTax)],
        ["Disposal costs (reducing proceeds)", v(conf?.costs, p?.costs)], ...(Number(p?.separateCosts ?? conf?.separateCosts ?? 0) > 0 ? [["Disposal costs (separate expense)", rupees(p?.separateCosts ?? conf?.separateCosts)] as [string, ReactNode]] : []),
        ["Basis", p?.basisSource ? p.basisSource.toLowerCase().replace(/_/g, " ") : "—"], ["Derecognition date", dateLabel(shown ? conf?.effective : p?.effective ?? conf?.effective)],
        ["Journal", intent?.journalNumber ?? "—"]]} />
      <div className={`text-lg font-semibold ${outcome === "loss" ? "text-danger" : outcome === "gain" ? "text-success" : ""}`}>{`${l.recognized ? "Recognized" : "Estimated"} ${outcome ?? "result"}: ${rupees(gain)}${l.recognized ? "" : " — not posted"}`}</div>
      {!l.recognized && <p className="text-xs text-text-muted">Finance approves the calculation and someone else posts it before a recognized result appears in financial reports.</p>}
      {p?.costsEstimated && <Notice tone="warning">{`The disposal costs (${rupees(p.costEstimate)}) are an estimate: link their supplier bills before Finance approves.`}</Notice>}
      {l.costLinks.length > 0 && <LinesTable columns={["Disposal cost", { label: "Amount", numeric: true }, "Treatment", ""]}>{l.costLinks.map((x) => <tr key={x.id}><Cell>{x.bill ?? "—"}</Cell><Cell numeric>{rupees(x.amount)}</Cell>
        <Cell>{x.treatment === "NET_PROCEEDS" ? "Reduces proceeds" : "Separate expense"}</Cell><Cell>{!l.recognized && <Button size="compact" variant="secondary" onPress={async () => { await unlinkCost(x.id, "Linked in error"); await refresh(); }}>Unlink</Button>}</Cell></tr>)}</LinesTable>}
      {l.insurance && <Notice tone="neutral">{`Insurance claim ${l.insurance.reference}${l.insurance.expected ? ` (expected ${rupees(l.insurance.expected)})` : ""} — recorded separately; it does not reduce the loss.`}</Notice>}
      <span><Button size="compact" variant="secondary" onPress={() => setHistory((x) => !x)}>{history ? "Hide calculation versions" : "Calculation versions"}</Button></span>
      {history && (versions.isLoading ? <LoadingState label="Loading" rows={2} /> : versions.isError ? <Notice tone="danger">{errorMessage(versions.error)}</Notice> : (
        <LinesTable columns={["Version", "Kind", "Status", { label: "Carrying", numeric: true }, { label: "Proceeds", numeric: true }, { label: "Gain / loss", numeric: true }, "By"]}>
          {(versions.data ?? []).map((s) => <tr key={s.id}><Cell>{s.version}</Cell><Cell>{s.kind.toLowerCase()}</Cell><Cell>{s.status.toLowerCase()}</Cell><Cell numeric>{rupees(s.carrying)}</Cell><Cell numeric>{rupees(s.proceeds)}</Cell>
            <Cell numeric>{rupees(s.gainLoss)}</Cell><Cell>{`${s.by ?? ""} · ${formatDateTime(s.at)}`}</Cell></tr>)}
        </LinesTable>))}
    </div>
  );
}

// ------------------------------------------------------------------ the asset's disposal panel
export function AssetDisposalPanel({ assetId, assetCode }: { assetId: string; assetCode: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "disposals", "asset", assetId), queryFn: () => getAssetPanel(assetId), retry: false });
  const options = useOptions(Boolean(q.data?.can.create));
  if (q.isLoading || q.isError) return null;
  const d = q.data!;
  if (!d.pendingCase && !d.final && !d.cases.length && !d.can.create) return null;
  return (
    <Panel title="Disposal" actions={d.can.create && options.data ? <Button size="compact" variant="secondary" onPress={() => setAsk(newDisposalAsk(options.data!, false, (id) => router.push(`${DISPOSAL_BASE}/${id}`), assetCode))}>Dispose of this asset</Button> : undefined}>
      {d.pendingCase && <Notice tone="warning">{`Committed to disposal ${d.pendingCase}: not available for ordinary assignment, transfer or maintenance.`}</Notice>}
      {d.final && <FactList columns={3} items={[["Disposal", d.final.case], ["Type", d.final.type], ["Outcome", d.final.status], ["Date", dateLabel(d.final.date)], ["Handover", d.final.handover ? `${d.final.handover}${d.final.recipient ? ` — ${d.final.recipient}` : ""}` : "—"],
        ["Carrying value at disposal", rupees(d.final.carrying)], ["Proceeds", rupees(d.final.proceeds)], ["Gain / loss", rupees(d.final.gainLoss)], ["Derecognition journal", d.final.journal ?? "—"]]} />}
      {d.cases.length > 0 && <LinesTable columns={["Disposal", "Type", "Status", "Intended date"]}>{d.cases.map((k) => <tr key={k.id}><Cell><Link className="text-brand hover:underline" href={k.href}>{k.number}</Link></Cell><Cell>{k.typeLabel}</Cell>
        <Cell><StatusBadge tone={CASE_TONE[k.status] ?? "neutral"}>{k.statusLabel}</StatusBadge></Cell><Cell>{dateLabel(k.effectiveDate)}</Cell></tr>)}</LinesTable>}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </Panel>
  );
}
