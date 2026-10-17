"use client";

// Assets — Straight-Line Depreciation. The accountant's month-end: an overview of what is due, each asset's approved basis and schedule,
// monthly runs (prepared, reviewed with every included and excluded asset, approved by Finance, posted through Finance's journal),
// estimate changes that keep posted history, exceptions and the reconciliation with the General Ledger. Posted figures are Finance's.
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
import { AutomationPanel, JournalPreviewPanel } from "./AutomationScreens";
import { dateLabel, errorMessage, errorStatus, money } from "../register/register-api";
import {
  DEPRECIATION_BASE, LIFECYCLE_TONE, LINE_TONE, REPORT_KINDS, RUN_TONE, STATE_TONE, approveSchedule, assetAction, depreciationAction, depreciationExportHref, getAssetDepreciation, getDepreciableAssets,
  getDueLines, getEstimateChanges, getExceptions, getOverview, getPolicies, getReconciliation, getReport, getRun, getRuns, getSchedules, previewRevision, previewSchedule, runAction, type BasisVersion,
  type RevisionPreview, type RunLine, type SchedulePreview,
} from "./depreciation-api";

const VIEWS = [{ id: "overview", label: "Overview" }, { id: "assets", label: "Asset Schedules" }, { id: "runs", label: "Monthly Runs" }, { id: "automation", label: "Automatic Accounting" }, { id: "pending", label: "Pending Approval" },
  { id: "posted", label: "Posted Depreciation" }, { id: "changes", label: "Policy & Estimate Changes" }, { id: "policies", label: "Policies" }, { id: "reconciliation", label: "Reconciliation" },
  { id: "exceptions", label: "Exceptions" }, { id: "reports", label: "Reports" }];
const rupees = (v: string | null | undefined) => (v === null || v === undefined ? "—" : money(v));
const month = (p: string | null) => (p ? new Date(`${p.slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "—");

export function DepreciationWorkspaceScreen() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [view, setView] = useState(params.get("view") ?? "overview");
  const select = (id: string) => { setView(id); router.replace(`${pathname}?view=${id}`, { scroll: false }); };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Depreciation" description="Straight-line depreciation of the financial-reporting book, from each asset's Finance-approved basis. Runs are posted through Finance; posted figures are Finance's. Income-tax depreciation is not calculated here." />
      <Tabs selectedKey={view} onSelectionChange={(k) => select(String(k))}>
        <TabList aria-label="Depreciation views">{VIEWS.map((v) => <Tab key={v.id} id={v.id}>{v.label}</Tab>)}</TabList>
      </Tabs>
      {view === "overview" && <OverviewPanel onOpen={select} />}
      {view === "assets" && <SchedulesPanel />}
      {view === "runs" && <RunsPanel view="all" />}
      {view === "automation" && <AutomationPanel />}
      {view === "pending" && <RunsPanel view="pending" />}
      {view === "posted" && <RunsPanel view="posted" />}
      {view === "changes" && <ChangesPanel />}
      {view === "policies" && <PoliciesPanel />}
      {view === "reconciliation" && <ReconciliationPanel />}
      {view === "exceptions" && <ExceptionsPanel />}
      {view === "reports" && <ReportsPanel />}
    </div>
  );
}

function OverviewPanel({ onOpen }: { onOpen: (id: string) => void }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "overview"), queryFn: getOverview, retry: false });
  if (q.isLoading) return <LoadingState label="Loading depreciation" rows={3} />;
  if (q.isError) return errorStatus(q.error) === 403 ? <PermissionState title="You can't see depreciation" description="It needs a depreciation permission." /> : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data!;
  const open = Object.entries(d.openRuns).map(([k, n]) => `${n} ${k.replace(/_/g, " ").toLowerCase()}`).join(", ");
  return (
    <div className="flex flex-col gap-4">
      <FactList columns={3} items={[["Depreciating", String(d.depreciating)], ["Not yet depreciating", String(d.notStarted)], ["Fully depreciated", String(d.fullyDepreciated)],
        ["Due up to this month (unposted)", d.dueThisMonth === null ? `${d.dueLines} asset-months` : `${rupees(d.dueThisMonth)} · ${d.dueLines} asset-months`], ["Open runs", open || "None"],
        ["Waiting for approval", `${d.proposals} basis change${d.proposals === 1 ? "" : "s"}`]]} />
      {d.stale > 0 && <Notice tone="danger">{`${d.stale} asset${d.stale === 1 ? "'s" : "s'"} approved basis no longer matches the cost or balances. See Exceptions.`}</Notice>}
      <span className="flex flex-wrap gap-2">
        {d.can.prepare && <Button variant="primary" onPress={() => onOpen("runs")}>Monthly runs</Button>}
        <Button variant="secondary" onPress={() => onOpen("assets")}>Asset schedules</Button>
        <Button variant="secondary" onPress={() => onOpen("exceptions")}>Exceptions</Button>
      </span>
    </div>
  );
}

const SCHEDULE_VIEWS = [{ value: "current", label: "Current schedules" }, { value: "draft", label: "Draft / review" }, { value: "attention", label: "Needing attention" },
  { value: "completed", label: "Completed" }, { value: "superseded", label: "Superseded versions" }, { value: "terminated", label: "Terminated (disposed)" }, { value: "all", label: "All versions" },
  { value: "due", label: "Monthly due amounts" }, { value: "assets", label: "Assets by depreciation state" }];
function SchedulesPanel() {
  const workspace = useWorkspaceContext();
  const [view, setView] = useState("current");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "schedules", view, search), queryFn: () => getSchedules(view, search), retry: false, enabled: !["due", "assets"].includes(view) });
  const due = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "due", period), queryFn: () => getDueLines(period), retry: false, enabled: view === "due" });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <Select label="Show" size="compact" selectedKey={view} onSelectionChange={(k) => setView(String(k))} options={SCHEDULE_VIEWS} />
        {view === "due" ? <TextField label="Up to month (YYYY-MM)" size="compact" value={period} onChange={setPeriod} />
          : view !== "assets" && <TextField label="Search" size="compact" value={search} onChange={setSearch} placeholder="Asset code or name" />}
        <span className="flex items-end"><Link className="text-sm text-brand hover:underline" href={depreciationExportHref("schedule")}>Export all schedules</Link></span>
      </div>
      {view === "assets" ? <AssetsPanel /> : view === "due" ? (due.isLoading ? <LoadingState label="Loading" rows={3} /> : due.isError ? <Notice tone="danger">{errorMessage(due.error)}</Notice> : <>
        <Notice tone="neutral">{`Planned and not yet posted up to ${month(due.data!.period)}: ${rupees(due.data!.total)} across ${due.data!.assets} asset${due.data!.assets === 1 ? "" : "s"} — what the month's run will consume.`}</Notice>
        <LinesTable columns={["Asset", "Month", { label: "Planned", numeric: true }, "Schedule", "Run"]} empty={due.data!.rows.length ? undefined : "Nothing due."}>
          {due.data!.rows.map((r, i) => <tr key={i}><Cell><Link className="text-brand hover:underline" href={r.href}>{r.asset}</Link></Cell><Cell>{`${month(r.month)}${r.catchUp ? " (catch-up)" : ""}`}</Cell>
            <Cell numeric>{rupees(r.amount)}</Cell><Cell>{`v${r.scheduleVersion}`}</Cell><Cell>{r.inRun ?? "—"}</Cell></tr>)}</LinesTable></>)
      : list.isLoading ? <LoadingState label="Loading schedules" rows={4} /> : list.isError ? <Notice tone="danger">{errorMessage(list.error)}</Notice> : (
        <LinesTable columns={["Asset", "Version", "Status", "Policy", { label: "Monthly", numeric: true }, { label: "Planned", numeric: true }, { label: "Posted", numeric: true }, { label: "Difference", numeric: true }, "Next month", "Attention"]}
          empty={(list.data ?? []).length ? undefined : "No schedules here."}>
          {(list.data ?? []).map((r) => <tr key={r.scheduleId}><Cell><Link className="text-brand hover:underline" href={r.href}>{r.asset}</Link><span className="block text-xs text-text-muted">{r.category ?? ""}</span></Cell>
            <Cell>{`v${r.version}`}</Cell><Cell><StatusBadge tone={LIFECYCLE_TONE[r.lifecycle] ?? "neutral"}>{r.lifecycleLabel}</StatusBadge></Cell><Cell>{r.policy}</Cell><Cell numeric>{rupees(r.monthly)}</Cell>
            <Cell numeric>{rupees(r.planned)}</Cell><Cell numeric>{rupees(r.posted)}</Cell><Cell numeric>{r.variance && r.variance !== "0.00" ? <span className="text-danger">{rupees(r.variance)}</span> : rupees(r.variance)}</Cell>
            <Cell>{month(r.nextPeriod)}</Cell><Cell>{r.attention ?? r.closedReason ?? "—"}</Cell></tr>)}
        </LinesTable>
      )}
    </div>
  );
}
function AssetsPanel() {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [view, setView] = useState("all");
  const [search, setSearch] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "assets", view, search), queryFn: () => getDepreciableAssets(view, search), retry: false });
  const overview = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "overview"), queryFn: getOverview, retry: false });
  const bulk = async () => {
    try { const r = await depreciationAction<{ generated: number; proposed: number; blocked: unknown[] }>("bulk-generate"); setResult(`${r.generated} schedule${r.generated === 1 ? "" : "s"} generated, ${r.proposed} basis proposal${r.proposed === 1 ? "" : "s"} made, ${r.blocked.length} could not be proposed.`);
      await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets", "depreciation") }); } catch (failure) { setResult(errorMessage(failure)); }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <TextField label="Search" size="compact" value={search} onChange={setSearch} placeholder="Asset code, name or category" />
        <Select label="Show" size="compact" selectedKey={view} onSelectionChange={(k) => setView(String(k))} options={[{ value: "all", label: "All capitalized assets" }, { value: "depreciating", label: "Depreciating" },
          { value: "not_started", label: "Not yet depreciating" }, { value: "fully", label: "Fully depreciated" }, { value: "stale", label: "Basis out of date" }, { value: "proposed", label: "Waiting for approval" }]} />
        <span className="flex items-end gap-2">{overview.data?.can.generate && <Button size="compact" variant="secondary" onPress={bulk}>Generate schedules</Button>}
          {overview.data?.can.export && <Link className="text-sm text-brand hover:underline" href={depreciationExportHref("schedule")}>Export schedules</Link>}</span>
      </div>
      {result && <Notice tone="info">{result}</Notice>}
      {q.isLoading ? <LoadingState label="Loading assets" rows={4} /> : q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice> : (
        <LinesTable columns={["Asset", "Status", "Policy", { label: "Monthly", numeric: true }, { label: "Accumulated", numeric: true }, { label: "Carrying value", numeric: true }, "Next month"]}
          empty={(q.data ?? []).length ? undefined : "No assets here."}>
          {(q.data ?? []).map((r) => <tr key={r.assetId}><Cell><Link className="text-brand hover:underline" href={r.href}>{r.asset}</Link><span className="block text-xs text-text-muted">{r.category}</span></Cell>
            <Cell><StatusBadge tone={STATE_TONE[r.state] ?? "neutral"}>{r.label}</StatusBadge></Cell><Cell>{r.policy ?? "—"}</Cell><Cell numeric>{rupees(r.monthly)}</Cell><Cell numeric>{rupees(r.accumulated)}</Cell>
            <Cell numeric>{rupees(r.carrying)}</Cell><Cell>{month(r.nextPeriod)}</Cell></tr>)}
        </LinesTable>
      )}
    </div>
  );
}

function RunsPanel({ view }: { view: string }) {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "runs", view), queryFn: () => getRuns(view), retry: false });
  if (q.isError && errorStatus(q.error) === 403) return <PermissionState title="You can't see depreciation runs" description="It needs a depreciation permission." />;
  const prepare: Ask = { title: "Prepare a depreciation run", confirm: "Calculate", description: "Every capitalized asset is checked for the month: what it is due (with any earlier month not yet posted), and why any asset is left out. Nothing is posted until Finance approves and posts it.",
    fields: [{ name: "period", label: "Month (YYYY-MM)", kind: "text", required: true, initial: new Date().toISOString().slice(0, 7) }],
    run: async (v, key) => { const r = await depreciationAction<{ runId: string }>("run-prepare", { period: String(v.period).trim(), idempotencyKey: key }); router.push(`${DEPRECIATION_BASE}/runs/${r.runId}`); } };
  return (
    <div className="flex flex-col gap-3">
      {q.data?.can.prepare && view === "all" && <span><Button variant="primary" onPress={() => setAsk(prepare)}>Prepare run</Button></span>}
      {q.isLoading ? <LoadingState label="Loading runs" rows={3} /> : q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice> : (
        <LinesTable columns={["Run", "Month", "Status", { label: "Assets", numeric: true }, { label: "Proposed", numeric: true }, { label: "Posted", numeric: true }, "Prepared", "Approved", "Posted by"]}
          empty={(q.data?.rows ?? []).length ? undefined : "No runs here."}>
          {(q.data?.rows ?? []).map((r) => <tr key={r.id}><Cell><Link className="text-brand hover:underline" href={r.href}>{r.number}</Link></Cell><Cell>{month(r.periodStart)}</Cell>
            <Cell><StatusBadge tone={RUN_TONE[r.status] ?? "neutral"}>{r.statusLabel}</StatusBadge></Cell><Cell numeric>{r.summary.assetsWithCharge ?? 0}</Cell><Cell numeric>{rupees(r.proposedTotal)}</Cell>
            <Cell numeric>{r.status === "POSTED" ? rupees(r.postedTotal) : "—"}</Cell><Cell>{`${r.preparedBy ?? ""} · ${dateLabel(r.preparedAt)}`}</Cell><Cell>{r.approvedBy ?? "—"}</Cell><Cell>{r.postedBy ?? "—"}</Cell></tr>)}
        </LinesTable>
      )}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

function ChangesPanel() {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "changes"), queryFn: getEstimateChanges, retry: false });
  const decide = (id: string, approve: boolean): Ask => ({ title: approve ? "Approve the change" : "Reject the change", confirm: approve ? "Approve" : "Reject", tone: approve ? "primary" : "danger",
    description: approve ? "A new schedule version is generated from the first month not yet posted; posted history stays as it is." : "The current basis stays.",
    fields: [{ name: "note", label: approve ? "Note" : "Reason", kind: "textarea", required: !approve }],
    run: async (v) => { await depreciationAction(approve ? "basis-approve" : "basis-reject", { basisId: id, note: v.note, reason: v.note }); await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets", "depreciation") }); } });
  if (q.isLoading) return <LoadingState label="Loading changes" rows={3} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  return (
    <>
      <LinesTable columns={["Asset", "Change", "From", "Remaining life", "Residual", "Reason", "Status", ""]} empty={(q.data ?? []).length ? undefined : "No estimate changes or proposals."}>
        {(q.data ?? []).map((r) => <tr key={r.id}><Cell><Link className="text-brand hover:underline" href={r.href}>{r.asset}</Link></Cell><Cell>{r.source}</Cell><Cell>{month(r.effectiveFrom)}</Cell>
          <Cell>{r.previousRemaining ? `${r.previousRemaining} → ${r.remainingLifeMonths} months` : `${r.remainingLifeMonths} months`}</Cell><Cell>{r.previousResidual ? `${rupees(r.previousResidual)} → ${rupees(r.residual)}` : rupees(r.residual)}</Cell>
          <Cell>{r.reason ?? "—"}<span className="block text-xs text-text-muted">{`${r.requestedBy ?? ""}${r.approvedBy ? ` · decided by ${r.approvedBy}` : ""}`}</span></Cell><Cell>{r.status.toLowerCase()}</Cell>
          <Cell>{r.canDecide && <span className="flex gap-2"><Button size="compact" variant="primary" onPress={() => setAsk(decide(r.id, true))}>Approve</Button><Button size="compact" variant="secondary" onPress={() => setAsk(decide(r.id, false))}>Reject</Button></span>}</Cell></tr>)}
      </LinesTable>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </>
  );
}

function PoliciesPanel() {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "policies"), queryFn: () => getPolicies(true), retry: false });
  const fields = (initial: Record<string, string> = {}): Ask["fields"] => [
    { name: "name", label: "Policy name", kind: "text", required: true, initial: initial.name },
    { name: "usefulLifeMonths", label: "Useful life (months)", kind: "quantity", required: true, initial: initial.usefulLifeMonths },
    { name: "residualRule", label: "Residual value", kind: "select", required: true, initial: initial.residualRule ?? "AMOUNT", options: [{ value: "AMOUNT", label: "The asset's approved amount (zero allowed)" }, { value: "PERCENT", label: "A percentage of cost" }] },
    { name: "residualPercent", label: "Residual percentage (if a percentage)", kind: "quantity", initial: initial.residualPercent },
    { name: "convention", label: "Partial months", kind: "select", required: true, initial: initial.convention ?? "DAILY", options: [{ value: "DAILY", label: "Daily proration (recommended)" }, { value: "FULL_MONTH", label: "Full month" }] },
    { name: "commencementRule", label: "Commences", kind: "select", required: true, initial: "AVAILABLE_FOR_USE", options: [{ value: "AVAILABLE_FOR_USE", label: "From the available-for-use date" }, { value: "NEXT_MONTH", label: "From the next month" }] },
    { name: "expenseAccountId", label: "Depreciation expense account (id)", kind: "text", required: true, initial: initial.expenseAccountId },
    { name: "accumulatedAccountId", label: "Accumulated depreciation account (id)", kind: "text", required: true, initial: initial.accumulatedAccountId },
    { name: "effectiveFrom", label: "Applies from", kind: "date", required: true },
    { name: "reason", label: "Reason", kind: "textarea" }];
  const toInput = (v: Record<string, string | boolean>) => ({ ...v, usefulLifeMonths: Number(v.usefulLifeMonths), residualPercent: v.residualPercent === "" ? undefined : Number(v.residualPercent) });
  const create: Ask = { title: "New depreciation policy", confirm: "Create", description: "A Finance policy for the financial-reporting book. Useful lives and residual values follow the Company's accounting framework (for example Schedule II) — nothing is assumed.",
    fields: fields(), run: async (v) => { await depreciationAction("policy-create", toInput(v)); await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets", "depreciation") }); } };
  if (q.isLoading) return <LoadingState label="Loading policies" rows={3} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  return (
    <div className="flex flex-col gap-3">
      {q.data?.can.manage && <span><Button variant="primary" onPress={() => setAsk(create)}>New policy</Button></span>}
      <LinesTable columns={["Policy", "Life", "Residual", "Partial months", "Commences", "Accounts", "From", "Status", ""]} empty={(q.data?.rows ?? []).length ? undefined : "No policies yet — categories' Finance policies apply."}>
        {(q.data?.rows ?? []).map((p) => <tr key={p.id}><Cell>{`${p.code} v${p.version} · ${p.name}`}<span className="block text-xs text-text-muted">{p.category ?? "Any category"}</span></Cell><Cell>{`${p.usefulLifeMonths} months`}</Cell>
          <Cell>{p.residual}</Cell><Cell>{p.convention}</Cell><Cell>{p.commencement}</Cell><Cell>{`${p.expenseAccount ?? "—"} / ${p.accumulatedAccount ?? "—"}`}</Cell><Cell>{dateLabel(p.effectiveFrom)}</Cell><Cell>{p.status.toLowerCase()}</Cell>
          <Cell>{q.data?.can.manage && p.status === "ACTIVE" && <Button size="compact" variant="secondary" onPress={() => setAsk({ title: `Revise ${p.code}`, confirm: "Save as a new version",
            description: "Assets already approved keep the version they were approved on.", fields: fields({ name: p.name, usefulLifeMonths: String(p.usefulLifeMonths) }),
            run: async (v) => { await depreciationAction("policy-revise", { policyId: p.id, ...toInput(v) }); await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets", "depreciation") }); } })}>Revise</Button>}</Cell></tr>)}
      </LinesTable>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

function ReconciliationPanel() {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "reconciliation"), queryFn: getReconciliation, retry: false });
  if (q.isLoading) return <LoadingState label="Reconciling" rows={3} />;
  if (q.isError) return errorStatus(q.error) === 403 ? <PermissionState title="You can't reconcile depreciation" description="It needs the reconcile permission." /> : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data!;
  return (
    <div className="flex flex-col gap-3">
      <Notice tone={d.matched ? "success" : "danger"}>{d.matched ? "Every posted run agrees with its Finance journal, and every asset's accumulated depreciation agrees with what was posted." : d.message}</Notice>
      <LinesTable columns={["Run", "Month", { label: "Asset-level total", numeric: true }, { label: "General Ledger", numeric: true }, "Result"]} empty={d.runs.length ? undefined : "No posted runs yet."}>
        {d.runs.map((r) => <tr key={r.runId}><Cell><Link className="text-brand hover:underline" href={`${DEPRECIATION_BASE}/runs/${r.runId}`}>{r.run}</Link></Cell><Cell>{month(r.period)}</Cell><Cell numeric>{rupees(r.scheduleTotal)}</Cell>
          <Cell numeric>{rupees(r.glTotal)}</Cell><Cell>{r.matched ? "Agrees" : "Differs"}</Cell></tr>)}
      </LinesTable>
      {d.assetDifferences.length > 0 && <Panel title="Assets whose register balance differs"><LinesTable columns={["Asset", { label: "Register", numeric: true }, { label: "Posted depreciation", numeric: true }]}>
        {d.assetDifferences.map((a) => <tr key={a.assetId}><Cell>{a.asset}</Cell><Cell numeric>{rupees(a.register)}</Cell><Cell numeric>{rupees(a.expected)}</Cell></tr>)}</LinesTable></Panel>}
      {d.byAccount.length > 0 && <Panel title="Posted by account"><LinesTable columns={["Expense / accumulated", { label: "Total", numeric: true }]}>
        {d.byAccount.map((a, i) => <tr key={i}><Cell>{`${a.expense ?? "—"} / ${a.accumulated ?? "—"}`}</Cell><Cell numeric>{rupees(a.total)}</Cell></tr>)}</LinesTable></Panel>}
    </div>
  );
}
function ExceptionsPanel() {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "exceptions"), queryFn: getExceptions, retry: false });
  if (q.isLoading) return <LoadingState label="Loading exceptions" rows={3} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  return (
    <LinesTable columns={["Issue", "About"]} empty={(q.data ?? []).length ? undefined : "Nothing needs attention."}>
      {(q.data ?? []).map((e, i) => <tr key={i}><Cell>{e.label}</Cell><Cell><Link className="text-brand hover:underline" href={e.href}>{e.subject}</Link></Cell></tr>)}
    </LinesTable>
  );
}
function ReportsPanel() {
  const workspace = useWorkspaceContext();
  const [kind, setKind] = useState(REPORT_KINDS[0].id);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "report", kind), queryFn: () => getReport(kind), retry: false });
  const rows = q.data ?? [];
  const cols = rows.length ? Object.keys(rows[0]).filter((x) => !["href", "assetId", "runId", "id"].includes(x)) : [];
  const flat = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <Panel title="Reports" actions={<span className="flex items-center gap-2"><Select aria-label="Report" size="compact" selectedKey={kind} onSelectionChange={(x) => setKind(String(x))} options={REPORT_KINDS.map((x) => ({ value: x.id, label: x.label }))} />
      <Link className="text-sm text-brand hover:underline" href={depreciationExportHref("register")}>Export NBV register</Link></span>}>
      {q.isLoading ? <LoadingState label="Loading" rows={3} /> : q.isError ? <Notice tone="warning">{errorMessage(q.error)}</Notice> : (
        <LinesTable columns={cols.length ? cols.map((x) => x.replace(/([A-Z])/g, " $1").replace(/^./, (y) => y.toUpperCase())) : ["Result"]} empty={rows.length ? undefined : "Nothing to show."}>
          {rows.map((r, i) => <tr key={i}>{cols.map((x, j) => <Cell key={x}>{j === 0 && typeof r.href === "string" ? <Link className="text-brand hover:underline" href={r.href}>{flat(r[x])}</Link> : flat(r[x])}</Cell>)}</tr>)}
        </LinesTable>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------ one run
export function DepreciationRunScreen({ runId }: { runId: string }) {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "run", runId), queryFn: () => getRun(runId), retry: false });
  if (q.isLoading) return <LoadingState label="Loading run" rows={5} />;
  if (q.isError) return errorStatus(q.error) === 403 ? <PermissionState title="You can't see this run" description="It needs a depreciation permission." /> : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const r = q.data!;
  const refresh = () => client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets", "depreciation") });
  const act = (action: string, title: string, confirm: string, description: string, fields: Ask["fields"] = [], tone: "primary" | "danger" = "primary"): Ask => ({ title, confirm, description, fields, tone,
    run: async (v, key) => { await runAction(r.id, action, { ...v, expectedVersion: r.version, commandId: key }); await refresh(); } });
  const s = r.summary;
  const excludedCounts = Object.entries(s.excluded ?? {}).map(([k, n]) => `${n} ${String(r.exclusionLabels[k] ?? k).toLowerCase()}`).join("; ");
  const facts: Array<[string, ReactNode]> = [["Month", month(r.periodStart)], ["Book", r.book], ["Status", <StatusBadge key="s" tone={RUN_TONE[r.status] ?? "neutral"}>{r.statusLabel}</StatusBadge>],
    ["Assets with a charge", String(s.assetsWithCharge ?? 0)], ["Asset-months", String(s.lines ?? 0)], ["Fully depreciated", String(s.fullyDepreciated ?? 0)], ["Tracked only (never depreciated)", String(s.trackedOnly ?? 0)],
    ["Excluded", excludedCounts || "None"], ["Proposed depreciation", rupees(r.proposedTotal)], ["Already posted for this month", rupees(s.alreadyPosted ?? "0.00")],
    ["Pending Finance authorization", r.status === "READY_FOR_REVIEW" ? rupees(r.proposedTotal) : "—"], ["Posted", r.status === "POSTED" ? rupees(r.postedTotal) : "—"],
    ["Prepared", `${r.preparedBy ?? ""} · ${formatDateTime(r.preparedAt)}`], ["Approved", r.approvedBy ? `${r.approvedBy} · ${formatDateTime(r.approvedAt)}` : "—"], ["Posted by", r.postedBy ? `${r.postedBy} · ${formatDateTime(r.postedAt)}` : "—"]];
  const lineRow = (l: RunLine) => <tr key={l.id}><Cell><Link className="text-brand hover:underline" href={l.href}>{l.asset}</Link><span className="block text-xs text-text-muted">{l.category ?? ""}</span></Cell><Cell>{month(l.period)}</Cell>
    <Cell numeric>{rupees(l.amount)}</Cell><Cell>{l.expenseAccount ? `${l.expenseAccount} / ${l.accumulatedAccount}` : "—"}</Cell><Cell>{l.reason ?? (l.status === "POSTED" ? "Posted" : "")}</Cell></tr>;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`Depreciation ${r.number}`} description="Inspect every contributing asset before authorizing. Posting books one Finance journal for the run; the asset-level lines are its allocation."
        primaryAction={<span className="flex flex-wrap gap-2">
          {r.can.recalculate && <Button variant="secondary" onPress={() => setAsk(act("recalculate", "Recalculate", "Recalculate", "The run is recalculated from the current schedules; any approval is withdrawn."))}>Recalculate</Button>}
          {r.can.approve && <Button variant="primary" onPress={() => setAsk(act("approve", "Approve the run", "Approve", `Authorize ${rupees(r.proposedTotal)} for ${month(r.periodStart)}.${r.catchUpMonths.length ? ` It also charges ${r.catchUpMonths.map(month).join(", ")}, not posted when due.` : ""}`,
            [...(r.catchUpMonths.length ? [{ name: "acknowledgeCatchUp", label: "Finance confirms the treatment of the earlier months in this run", kind: "checkbox" as const, required: true }] : []), { name: "note", label: "Note", kind: "textarea" as const }]))}>Approve</Button>}
          {r.can.post && <Button variant="primary" onPress={() => setAsk(act("post", "Post through Finance", "Post", `Debit depreciation expense and credit accumulated depreciation for ${rupees(r.approvedTotal ?? r.proposedTotal)}. The accounting period must be open.`))}>Post</Button>}
          {r.can.recover && <Button variant="primary" onPress={() => setAsk(act("recover", "Verify the posting", "Verify", "Finance's journal is looked up by this run. Found, the run is completed from it; not found, it returns to approved. It is never posted twice."))}>Verify posting</Button>}
          {r.can.cancel && <Button variant="secondary" onPress={() => setAsk(act("cancel", "Cancel the run", "Cancel run", "Nothing was posted; the month can be prepared again.", [{ name: "reason", label: "Reason", kind: "textarea", required: true }], "danger"))}>Cancel</Button>}
        </span>} />
      {r.status === "NEEDS_CORRECTION" && <Notice tone="danger">Blocking exceptions: correct them (accounts, the asset&apos;s basis) and recalculate.</Notice>}
      {["POSTING", "RECOVERY_REQUIRED"].includes(r.status) && <Notice tone="warning">The posting is being verified. Do not submit it again — use Verify posting.</Notice>}
      {r.preparedByAutomation && <Notice tone="neutral">Prepared automatically under the Company&apos;s depreciation automation policy.</Notice>}
      <Panel title="Control summary"><FactList columns={3} items={facts} /></Panel>
      <JournalPreviewPanel runId={r.id} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {[["By category", r.byCategory], ["By account", r.byAccount], ["By department", r.byDepartment]].map(([title, rows]) => (
          <Panel key={String(title)} title={String(title)}><LinesTable columns={["", { label: "Total", numeric: true }]} empty={(rows as Array<unknown>).length ? undefined : "—"}>
            {(rows as Array<{ name: string; total: string | null }>).map((g) => <tr key={g.name}><Cell>{g.name}</Cell><Cell numeric>{rupees(g.total)}</Cell></tr>)}</LinesTable></Panel>))}
      </div>
      <Panel title={`Included (${r.included.length})`}><LinesTable columns={["Asset", "Month", { label: "Depreciation", numeric: true }, "Accounts", "Note"]} empty={r.included.length ? undefined : "No asset is due a charge."}>{r.included.map(lineRow)}</LinesTable></Panel>
      <Panel title={`Excluded (${r.excluded.length})`}><LinesTable columns={["Asset", "Month", { label: "Scheduled", numeric: true }, "Accounts", "Why"]} empty={r.excluded.length ? undefined : "Nothing excluded."}>
        {r.excluded.map((l) => <tr key={l.id}><Cell><Link className="text-brand hover:underline" href={l.href}>{l.asset}</Link></Cell><Cell>{month(l.period)}</Cell><Cell numeric>{rupees(l.scheduled)}</Cell><Cell>—</Cell>
          <Cell><span className={l.blocking ? "text-danger" : ""}>{l.reason ?? l.code}</span></Cell></tr>)}</LinesTable></Panel>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}

// ------------------------------------------------------------------ the asset's depreciation (Financials tab)
export function AssetDepreciationPanel({ assetId }: { assetId: string }) {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [preview, setPreview] = useState<RevisionPreview | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [versionId, setVersionId] = useState<string | undefined>(undefined);
  const [draftPreview, setDraftPreview] = useState<SchedulePreview | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "asset", assetId, versionId ?? ""), queryFn: () => getAssetDepreciation(assetId, versionId), retry: false });
  if (q.isLoading) return <LoadingState label="Loading depreciation" rows={3} />;
  if (q.isError) return errorStatus(q.error) === 403 ? null : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data!;
  const refresh = () => client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets", "depreciation") });
  const revise: Ask = { title: "Revise depreciation estimate", confirm: "Send for approval",
    description: "A change of estimate applies from the first month not yet posted; posted depreciation stays. Finance approves it, and a new schedule version is generated. A past error is a correction for Finance, not a revision.",
    fields: [{ name: "remainingLifeMonths", label: "New remaining useful life (months)", kind: "quantity", initial: d.remainingLifeMonths ? String(d.remainingLifeMonths) : "" },
      { name: "residualValue", label: "New residual value", kind: "quantity", initial: d.residual ?? "" }, { name: "reason", label: "Reason", kind: "textarea", required: true }],
    run: async (v) => { await assetAction(assetId, "revise", { remainingLifeMonths: v.remainingLifeMonths === "" ? undefined : Number(v.remainingLifeMonths), residualValue: v.residualValue === "" ? undefined : String(v.residualValue), reason: v.reason }); setPreview(null); await refresh(); } };
  const propose: Ask = { title: "Propose a depreciation basis", confirm: "Send for approval", description: "From the policy that applies to this asset's category; Finance approves it.",
    fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true, initial: "Policy assigned" }], run: async (v) => { await assetAction(assetId, "propose", { reason: v.reason }); await refresh(); } };
  const decide = (b: BasisVersion, approve: boolean): Ask => ({ title: approve ? "Approve the basis" : "Reject the basis", confirm: approve ? "Approve" : "Reject", tone: approve ? "primary" : "danger",
    description: `${b.source}: from ${month(b.effectiveFrom)}, ${b.remainingLifeMonths} months, residual ${rupees(b.residual)}.`, fields: [{ name: "note", label: approve ? "Note" : "Reason", kind: "textarea", required: !approve }],
    run: async (v) => { await depreciationAction(approve ? "basis-approve" : "basis-reject", { basisId: b.id, note: v.note, reason: v.note }); await refresh(); } });
  const showPreview = async () => {
    try { setPreview(await previewRevision(assetId, { remainingLifeMonths: d.remainingLifeMonths ?? undefined })); } catch (failure) { setPreview(null); window.alert(errorMessage(failure)); }
  };
  const firstPlanned = d.schedule.findIndex((x) => x.status === "PLANNED");
  const lines = showAll || firstPlanned < 0 ? d.schedule : d.schedule.filter((l, i) => l.status !== "PLANNED" || i < firstPlanned + 12);
  const approveDraft = (v: NonNullable<typeof d.version>): Ask => ({ title: `Approve schedule v${v.version}`, confirm: "Approve", description: "It becomes the plan in force; the plan it replaces is kept as a superseded version and posted months stay as they are.",
    fields: [{ name: "note", label: "Note", kind: "textarea" }], run: async (vals) => { const out = await approveSchedule(v.id, v.rowVersion, String(vals.note ?? "")); if (out.code) throw new Error(out.message ?? out.code); setVersionId(undefined); await refresh(); } });
  const showSchedulePreview = async () => { try { setDraftPreview(await previewSchedule(assetId)); } catch (failure) { window.alert(errorMessage(failure)); } };
  return (
    <Panel title="Depreciation" description={d.note} actions={<span className="flex flex-wrap gap-2">
      {d.versions.length > 1 && <Select aria-label="Schedule version" size="compact" selectedKey={d.version?.id ?? ""} onSelectionChange={(k) => setVersionId(String(k))}
        options={d.versions.map((v) => ({ value: v.id, label: `v${v.version} · ${v.lifecycleLabel}` }))} />}
      {d.can.propose && <><Button size="compact" variant="secondary" onPress={showSchedulePreview}>Preview schedule</Button><Button size="compact" variant="secondary" onPress={() => setAsk(propose)}>Propose basis</Button></>}
      {d.can.revise && <><Button size="compact" variant="secondary" onPress={showPreview}>Preview revision</Button><Button size="compact" variant="secondary" onPress={() => setAsk(revise)}>Revise estimate</Button></>}
      <Link className="text-sm text-brand hover:underline" href={depreciationExportHref("schedule", assetId)}>Export</Link></span>}>
      <div className="flex flex-col gap-3">
        <FactList columns={3} items={[["Status", <StatusBadge key="s" tone={STATE_TONE[d.state] ?? "neutral"}>{d.label}</StatusBadge>], ["Accounting book", d.book], ["Method", d.method],
          ["Capitalized cost", rupees(d.cost)], ["Residual value", rupees(d.residual)], ["Useful life", d.usefulLifeMonths ? `${d.usefulLifeMonths} months` : "—"],
          ["Remaining useful life", d.remainingLifeMonths ? `${d.remainingLifeMonths} months` : "—"], ["Commences", dateLabel(d.commencement)], ["Partial months", d.convention ?? "—"],
          ["Monthly amount", rupees(d.monthly)], ["Accumulated depreciation (posted)", rupees(d.accumulated)], ["Net carrying value", rupees(d.carrying)],
          ["Next depreciation month", month(d.nextPeriod)], ["Posting status", d.postingStatus], ["Policy", d.policy ?? "—"]]} />
        {d.version && <FactList columns={3} items={[["Schedule", <span key="v">{`v${d.version.version} `}<StatusBadge tone={LIFECYCLE_TONE[d.version.lifecycle] ?? "neutral"}>{d.version.lifecycleLabel}</StatusBadge></span>],
          ["Approved", d.version.approvedBy ? `${d.version.approvedBy} · ${dateLabel(d.version.approvedAt)}` : "Not yet"], ["Applies from", month(d.version.effectiveFrom)],
          ["Planned (this version)", rupees(d.totals.planned)], ["Posted by Finance", rupees(d.totals.posted)], ["Planned − posted", rupees(d.totals.variance)]]} />}
        {d.version?.closedReason && <Notice tone="neutral">{d.version.closedReason}</Notice>}
        {d.version?.validationErrors.map((e) => <Notice key={e.code} tone="danger">{e.message}</Notice>)}
        {d.version?.lifecycle === "DRAFT" && <Notice tone="warning">{"This schedule is a draft for review; it is not used by depreciation runs until it is approved."}
          {d.version.canApprove && <span className="ml-2"><Button size="compact" variant="primary" onPress={() => setAsk(approveDraft(d.version!))}>Approve schedule</Button></span>}</Notice>}
        {d.totals.exceptions > 0 && <Notice tone="danger">{`${d.totals.exceptions} month${d.totals.exceptions === 1 ? " needs" : "s need"} attention — see the schedule.`}</Notice>}
        {draftPreview && (draftPreview.valid ? <Panel title="Schedule preview (not saved)" description={`${draftPreview.usefulLifeMonths} months from ${dateLabel(draftPreview.commencement)}, residual ${rupees(draftPreview.residual)}: ${rupees(draftPreview.monthly)} a full month.`}>
            <LinesTable columns={["Month", { label: "Planned", numeric: true }, { label: "Closing", numeric: true }]}>{draftPreview.lines.slice(0, 12).map((l) => <tr key={l.periodStart}><Cell>{month(l.periodStart)}{l.eligibleDays !== l.periodDays && <span className="block text-xs text-text-muted">{`${l.eligibleDays} of ${l.periodDays} days`}</span>}</Cell>
              <Cell numeric>{rupees(l.amount)}</Cell><Cell numeric>{rupees(l.closing)}</Cell></tr>)}</LinesTable></Panel>
          : <Notice tone="danger">{draftPreview.errors.map((e) => e.message).join(" ")}</Notice>)}
        {d.bases.filter((b) => b.status === "PROPOSED").map((b) => <Notice key={b.id} tone="warning">{`${b.source} waiting for approval: from ${month(b.effectiveFrom)}, ${b.remainingLifeMonths} months, residual ${rupees(b.residual)} — requested by ${b.requestedBy ?? "—"}.`}
          {b.canDecide && <span className="ml-2 inline-flex gap-2"><Button size="compact" variant="primary" onPress={() => setAsk(decide(b, true))}>Approve</Button><Button size="compact" variant="secondary" onPress={() => setAsk(decide(b, false))}>Reject</Button></span>}</Notice>)}
        {preview && <Panel title={`Revision preview from ${month(preview.effectiveFrom)}`} description={`Carrying ${rupees(preview.carrying)} to residual ${rupees(preview.residual)} over ${preview.remainingLifeMonths} months: ${rupees(preview.monthly)} a month.`}>
          <LinesTable columns={["Month", { label: "Current schedule", numeric: true }, { label: "Revised", numeric: true }, { label: "Revised closing", numeric: true }]}>
            {preview.next.slice(0, 24).map((n, i) => <tr key={n.period}><Cell>{month(n.period)}</Cell><Cell numeric>{rupees(preview.old[i]?.amount)}</Cell><Cell numeric>{rupees(n.amount)}</Cell><Cell numeric>{rupees(n.closing)}</Cell></tr>)}
          </LinesTable></Panel>}
        {d.years.length > 0 && <LinesTable columns={["Financial year", { label: "Months", numeric: true }, { label: "Scheduled", numeric: true }, { label: "Posted", numeric: true }]}>
          {d.years.map((y) => <tr key={y.year}><Cell>{y.year}</Cell><Cell numeric>{y.months}</Cell><Cell numeric>{rupees(y.amount)}</Cell><Cell numeric>{rupees(y.posted)}</Cell></tr>)}</LinesTable>}
        {d.schedule.length > 0 && <>
          <LinesTable columns={["Month", { label: "Opening", numeric: true }, { label: "Planned", numeric: true }, { label: "Posted", numeric: true }, { label: "Difference", numeric: true },
            { label: "Planned accumulated", numeric: true }, { label: "Planned closing", numeric: true }, "Status", "Finance"]}>
            {d.opening && <tr><Cell><span className="font-medium">{d.opening.label}</span><span className="block text-xs text-text-muted">{`${d.opening.source} — recognized before this schedule; never posted again`}</span></Cell>
              <Cell numeric>{rupees(d.opening.cost)}</Cell><Cell numeric>—</Cell><Cell numeric>—</Cell><Cell numeric>—</Cell><Cell numeric>{rupees(d.opening.accumulated)}</Cell><Cell numeric>{rupees(d.opening.carrying)}</Cell><Cell>Baseline</Cell><Cell>—</Cell></tr>}
            {lines.map((l) => <tr key={l.period}><Cell>{month(l.period)}{l.days && <span className="block text-xs text-text-muted">{l.days}</span>}</Cell><Cell numeric>{rupees(l.opening)}</Cell><Cell numeric>{rupees(l.amount)}</Cell>
              <Cell numeric>{rupees(l.posted)}</Cell><Cell numeric>{l.variance && l.variance !== "0.00" ? <span className="text-danger">{rupees(l.variance)}</span> : rupees(l.variance)}</Cell>
              <Cell numeric>{rupees(l.accumulated)}</Cell><Cell numeric>{rupees(l.closing)}</Cell>
              <Cell><StatusBadge tone={LINE_TONE[l.status] ?? "neutral"}>{l.statusLabel}</StatusBadge>{l.note && <span className="block text-xs text-text-muted">{l.note}</span>}</Cell>
              <Cell>{l.journalHref ? <Link className="text-xs text-brand hover:underline" href={l.journalHref}>{l.journalNumber ?? "Journal"}</Link> : l.journalNumber ?? ""}
                {l.runId && <Link className="ml-2 text-xs text-brand hover:underline" href={`${DEPRECIATION_BASE}/runs/${l.runId}`}>{l.run}</Link>}</Cell></tr>)}
          </LinesTable>
          {!showAll && lines.length < d.schedule.length && <span><Button size="compact" variant="secondary" onPress={() => setShowAll(true)}>{`Show all ${d.schedule.length} months`}</Button></span>}
        </>}
        {d.bases.length > 0 && <LinesTable columns={["Basis", "Source", "From", "Remaining", { label: "Carrying", numeric: true }, { label: "Residual", numeric: true }, "Status", "Decided"]}>
          {d.bases.map((b) => <tr key={b.id}><Cell>{`v${b.version}`}</Cell><Cell>{b.source}</Cell><Cell>{month(b.effectiveFrom)}</Cell><Cell>{`${b.remainingLifeMonths} months`}</Cell><Cell numeric>{rupees(b.carrying)}</Cell>
            <Cell numeric>{rupees(b.residual)}</Cell><Cell>{b.status.toLowerCase()}</Cell><Cell>{b.approvedBy ? `${b.approvedBy} · ${dateLabel(b.approvedAt)}` : "—"}</Cell></tr>)}</LinesTable>}
      </div>
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </Panel>
  );
}
