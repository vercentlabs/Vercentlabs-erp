"use client";

// Projects — Project Cost on screen. Actual cost, budget, open commitments, pending claims, the estimate to complete and at completion are
// separate figures, each with its definition; the breakdown is by category, source, task, milestone and month; every line opens its
// source. Labor and overhead are managerial cost — nothing here posts to the ledger. Confidential labor rates show only to those allowed.
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, LinkButton, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { call, dateLabel, errorMessage, errorStatus, newKey, qs, send } from "../api/projects-api";

type Group = { key: string; label: string; amount: string; lines: number; budget?: string | null };
type Summary = {
  currency: string; calculatedAt: string; basis: string; actual: string;
  budget: { set?: false; message?: string; id?: string; version?: number; total?: string; lines?: Record<string, string>; approvedAt?: string; reason?: string };
  proposal: { id: string; version: number; total: string; reason: string; proposedBy: string | null; mine: boolean; lines: Record<string, string> } | null;
  remaining: string | null; utilization: number | null; overrun: boolean | null;
  commitments: { total: string; items: Array<{ id: string; number: string; total: string; billed: string; open: string; href: string }> };
  pending: { awaitingApproval: string; awaitingRecognition: string; total: string };
  forecast: { version: number; estimateToComplete: string; asOf: string; commitmentTreatment: "INCLUDED" | "EXCLUDED"; notes: string | null; by: string | null; at: string } | null;
  eac: string | null; eacVariance: string | null; forecastOverrun: boolean | null;
  byCategory: Group[]; bySource: Group[]; byTask: Group[]; byMilestone: Group[]; byMonth: Array<{ month: string; amount: string }>;
  labor: { total: string; billable: string; nonBillable: string; minutes: number; missingRate: number }; pendingSupplierBills: string;
  profitability: { contractValue: string; invoicedNet: string; invoices: number; contribution: string; margin: number | null; note: string } | null;
  exceptions: number;
  can: { detail: boolean; laborRate: boolean; allocate: boolean; approve: boolean; forecast: boolean; reconcile: boolean; profitability: boolean; export: boolean };
};
type Line = { id: string; sourceModule: string; sourceRef: string; date: string; category: string; costType: string; basis: string; amount: string | null; task: string | null; milestone: string | null;
  person?: string | null; rate?: string | null; recognized?: boolean; href: string | null; missingRate?: boolean; minutes?: number };
const CATEGORIES: Record<string, string> = { LABOR: "Labor", TRAVEL: "Travel and accommodation", SUBCONTRACTORS: "Subcontractors", MATERIALS: "Materials", EQUIPMENT: "Equipment and rentals",
  SOFTWARE: "Software and services", OTHER_DIRECT: "Other direct expenses", OVERHEAD: "Allocated overhead" };
const SOURCES: Record<string, string> = { TIMESHEET: "Approved time", EXPENSE_CLAIM: "Expense claim", SUPPLIER_BILL: "Supplier bill", GOODS_ISSUE: "Material issue", OVERHEAD: "Overhead" };

const getSummary = (id: string) => call<{ summary: Summary }>(`/${id}/costs`).then((r) => r.summary);
const getLines = (id: string, filters: Record<string, string | undefined>) => call<{ lines: Line[] }>(`/${id}/costs/transactions${qs(filters)}`).then((r) => r.lines);
const getExceptions = (id: string) => call<{ rows: Array<{ kind: string; message: string }> }>(`/${id}/costs/exceptions`).then((r) => r.rows);
const reconcile = (id: string) => call<{ consistent: boolean; checks: Array<{ key: string; label: string; ok: boolean; details: string[] }> }>(`/${id}/costs/reconciliation`);
const costAction = <T = Record<string, unknown>>(id: string, view: string, input: Record<string, unknown>) => send<T>(`/${id}/costs/${view}`, input);
const companyAction = <T = Record<string, unknown>>(action: string, input: Record<string, unknown>) => send<T>(`/costs/${action}`, input);
export const getCostReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/reports/costs${qs({ kind })}`).then((r) => r.rows);
const money = (value: string | null | undefined, currency = "INR") => (value === null || value === undefined ? "—" : `${Number(value) < 0 ? "−" : ""}${currency === "INR" ? "₹" : `${currency} `}${Math.abs(Number(value)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "danger" | "warning" | "success" }) {
  return <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-surface px-3 py-2.5"><span className="text-xs font-medium text-text-muted">{label}</span>
    <span className={`text-lg font-semibold tabular-nums ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : ""}`}>{value}</span>
    {note && <span className="text-xs text-text-muted">{note}</span>}</div>;
}
function Bar({ part, whole }: { part: string; whole: string | null | undefined }) {
  const p = whole && Number(whole) > 0 ? Math.min(100, (Number(part) / Number(whole)) * 100) : 0;
  return <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted" aria-hidden><div className={`h-full rounded-full ${p >= 100 ? "bg-danger" : "bg-brand"}`} style={{ width: `${p}%` }} /></div>;
}

export function ProjectCostPanel({ projectId }: { projectId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "cost", projectId), queryFn: () => getSummary(projectId), retry: false });
  const exceptions = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "cost-exceptions", projectId), queryFn: () => getExceptions(projectId), retry: false, enabled: summary.isSuccess });
  const [view, setView] = useState<"overview" | "lines">("overview");
  const [dialog, setDialog] = useState<"overhead" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  if (summary.isLoading) return <LoadingState label="Loading project cost" rows={4} />;
  if (summary.isError) return errorStatus(summary.error) === 403 || errorStatus(summary.error) === 404 ? null : <Notice tone="danger">{errorMessage(summary.error)}</Notice>;
  const s = summary.data!;
  const cur = s.currency;
  const done = async (text: string) => { setDialog(null); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage({ tone: "success", text }); };
  const check = async () => {
    try { const r = await reconcile(projectId); setMessage({ tone: r.consistent ? "success" : "warning", text: r.consistent ? "Every cost line matches its source." : r.checks.filter((x) => !x.ok).map((x) => `${x.label}: ${x.details.join(", ")}`).join(" · ") }); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };
  return (
    <Panel title="Project cost" description={s.basis}
      actions={<span className="flex flex-wrap gap-2">
        {s.can.allocate && s.can.reconcile && <Button size="compact" variant="ghost" onPress={() => setDialog("overhead")}>Allocate overhead</Button>}
        {(s.can.reconcile || s.can.detail) && <Button size="compact" variant="ghost" onPress={check}>Reconcile</Button>}
        {s.can.export && <LinkButton size="compact" variant="ghost" href={`/api/projects/${projectId}/costs/export`}>Export</LinkButton>}
      </span>}>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {s.proposal && <Notice tone="info">{`Budget v${s.proposal.version} (${money(s.proposal.total, cur)}) is waiting for approval — see Financials → Budget.`}</Notice>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Figure label="Actual cost" value={money(s.actual, cur)} note={s.labor.missingRate ? `${s.labor.missingRate} entr${s.labor.missingRate === 1 ? "y" : "ies"} missing a rate` : "Recognized from sources"} tone={s.overrun ? "danger" : undefined} />
        <Figure label="Approved budget" value={s.budget.set === false ? "Budget not set" : money(s.budget.total, cur)} note={s.utilization === null ? undefined : `${s.utilization}% used · ${money(s.remaining, cur)} left`} />
        <Figure label="Open commitments" value={money(s.commitments.total, cur)} note="Purchase orders not yet billed" />
        <Figure label="Pending claims" value={money(s.pending.total, cur)} note="Awaiting approval or Finance" />
        <Figure label="Estimate to complete" value={s.forecast ? money(s.forecast.estimateToComplete, cur) : "Not estimated"} note={s.forecast ? `${s.forecast.commitmentTreatment === "INCLUDED" ? "Includes" : "Excludes"} commitments · ${dateLabel(s.forecast.asOf)}` : undefined} />
        <Figure label="Estimate at completion" value={money(s.eac, cur)} note={s.eacVariance === null ? undefined : `${Number(s.eacVariance) < 0 ? "Over" : "Under"} budget by ${money(String(Math.abs(Number(s.eacVariance))), cur)}`}
          tone={s.forecastOverrun ? "danger" : s.forecastOverrun === false ? "success" : undefined} />
      </div>
      {s.budget.set !== false && <Bar part={s.actual} whole={s.budget.total} />}
      {(exceptions.data ?? []).length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-warning-emphasis/40 bg-warning-soft p-3 text-sm text-warning">{exceptions.data!.map((row, i) => <li key={i}>{row.message}</li>)}</ul>
      )}
      <div className="flex gap-1">
        <Button size="compact" variant={view === "overview" ? "secondary" : "ghost"} onPress={() => setView("overview")}>Breakdown</Button>
        {s.can.detail && <Button size="compact" variant={view === "lines" ? "secondary" : "ghost"} onPress={() => setView("lines")}>Cost lines</Button>}
      </div>
      {view === "overview" ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="flex flex-col gap-2">
            <p className="text-xs font-medium text-text-muted">By category (budget where set)</p>
            {s.byCategory.length === 0 ? <p className="text-sm text-text-muted">No cost recognized yet.</p> : s.byCategory.map((row) => (
              <div key={row.key} className="flex flex-col gap-1 text-sm">
                <span className="flex justify-between gap-2"><span>{row.label}</span><span className="tabular-nums">{money(row.amount, cur)}{row.budget ? <span className="text-text-muted">{` / ${money(row.budget, cur)}`}</span> : null}</span></span>
                {row.budget && <Bar part={row.amount} whole={row.budget} />}
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-3 text-sm">
            <div><p className="text-xs font-medium text-text-muted">By source</p>
              <ul className="mt-1 flex flex-col gap-0.5">{s.bySource.map((row) => <li key={row.key} className="flex justify-between gap-2"><span>{row.label}</span><span className="tabular-nums">{money(row.amount, cur)}</span></li>)}
                {Number(s.pendingSupplierBills) > 0 && <li className="flex justify-between gap-2 text-text-muted"><span>Supplier bills awaiting approval (not cost yet)</span><span className="tabular-nums">{money(s.pendingSupplierBills, cur)}</span></li>}</ul></div>
            <div><p className="text-xs font-medium text-text-muted">Labor</p>
              <p>{`${Math.round(s.labor.minutes / 6) / 10} h · ${money(s.labor.total, cur)} (billable ${money(s.labor.billable, cur)}, non-billable ${money(s.labor.nonBillable, cur)})`}</p></div>
            {s.byMilestone.length > 0 && <div><p className="text-xs font-medium text-text-muted">By milestone</p>
              <ul className="mt-1 flex flex-col gap-0.5">{s.byMilestone.map((row) => <li key={row.key} className="flex justify-between gap-2"><span className="truncate">{row.label}</span><span className="tabular-nums">{money(row.amount, cur)}</span></li>)}</ul></div>}
            {s.byTask.length > 0 && <div><p className="text-xs font-medium text-text-muted">By task</p>
              <ul className="mt-1 flex flex-col gap-0.5">{s.byTask.slice(0, 8).map((row) => <li key={row.key} className="flex justify-between gap-2"><span className="truncate">{row.label}</span><span className="tabular-nums">{money(row.amount, cur)}</span></li>)}</ul></div>}
            {s.commitments.items.length > 0 && <div><p className="text-xs font-medium text-text-muted">Commitments</p>
              <ul className="mt-1 flex flex-col gap-0.5">{s.commitments.items.map((row) => <li key={row.id} className="flex justify-between gap-2"><Link className="text-brand hover:underline" href={row.href}>{row.number}</Link>
                <span className="tabular-nums">{`${money(row.open, cur)} open of ${money(row.total, cur)}`}</span></li>)}</ul></div>}
            {s.profitability && <div className="rounded-lg border border-border p-3"><p className="text-xs font-medium text-text-muted">Profitability</p>
              <p>{`Invoiced ${money(s.profitability.invoicedNet, cur)} − cost ${money(s.actual, cur)} = contribution ${money(s.profitability.contribution, cur)}${s.profitability.margin === null ? "" : ` (${s.profitability.margin}%)`}`}</p>
              <p className="text-xs text-text-muted">{`Contract value ${money(s.profitability.contractValue, cur)}. ${s.profitability.note}`}</p></div>}
          </div>
        </div>
      ) : <CostLines projectId={projectId} currency={cur} laborRate={s.can.laborRate} />}
      <p className="text-xs text-text-muted">{`Calculated ${formatDateTime(s.calculatedAt)} from the source records.`}</p>
      {dialog === "overhead" && <OverheadDialog projectId={projectId} onClose={() => setDialog(null)} onDone={done} />}
    </Panel>
  );
}
function CostLines({ projectId, currency, laborRate }: { projectId: string; currency: string; laborRate: boolean }) {
  const workspace = useWorkspaceContext();
  const [category, setCategory] = useState("");
  const [source, setSource] = useState("");
  const lines = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "cost-lines", projectId, category, source), queryFn: () => getLines(projectId, { category: category || undefined, source: source || undefined }) });
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-2 sm:max-w-lg">
        <Select label="Category" selectedKey={category} onSelectionChange={(k) => setCategory(String(k ?? ""))} options={[{ value: "", label: "All categories" }, ...Object.entries(CATEGORIES).map(([value, label]) => ({ value, label }))]} />
        <Select label="Source" selectedKey={source} onSelectionChange={(k) => setSource(String(k ?? ""))} options={[{ value: "", label: "All sources" }, ...Object.entries(SOURCES).map(([value, label]) => ({ value, label }))]} />
      </div>
      {lines.isLoading ? <LoadingState label="Loading cost lines" rows={3} /> : (
        <div className="max-h-96 overflow-auto">
          <LinesTable columns={["Date", "Source", "Category", "Task / milestone", ...(laborRate ? [{ label: "Rate", numeric: true }] : []), { label: "Amount", numeric: true }]} empty={(lines.data ?? []).length ? undefined : "No cost lines."}>
            {(lines.data ?? []).map((line) => (
              <tr key={line.id}>
                <Cell>{dateLabel(line.date)}</Cell>
                <Cell>{line.href ? <Link className="text-brand hover:underline" href={line.href}>{line.sourceRef}</Link> : line.sourceRef}<span className="block text-xs text-text-muted">{`${SOURCES[line.sourceModule]}${line.person ? ` · ${line.person}` : ""}${line.recognized === false ? " · awaiting approval" : ""}`}</span></Cell>
                <Cell>{CATEGORIES[line.category]}{line.costType === "ALLOCATED_OVERHEAD" && <span className="block text-xs text-text-muted">managerial allocation</span>}</Cell>
                <Cell>{line.task ?? line.milestone ?? "—"}</Cell>
                {laborRate && <Cell numeric>{line.rate ? money(line.rate, currency) : "—"}</Cell>}
                <Cell numeric>{line.missingRate ? <StatusBadge tone="warning">Rate missing</StatusBadge> : money(line.amount, currency)}</Cell>
              </tr>
            ))}
          </LinesTable>
        </div>
      )}
    </div>
  );
}
function useRun(onDone: (text: string) => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return { busy, error, run: async (work: () => Promise<string>) => { setBusy(true); setError(null); try { await onDone(await work()); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } } };
}
function BudgetDialog({ projectId, current, onClose, onDone }: { projectId: string; current: Record<string, string>; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...current }));
  const [reason, setReason] = useState("");
  const [key] = useState(newKey);
  const { busy, error, run } = useRun(onDone);
  const total = Object.values(values).reduce((sum, v) => sum + (Number(v) || 0), 0);
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Propose a cost budget" size="lg" description="Amounts per category; someone allowed to approve cost allocations approves it. Earlier versions are kept.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2">{Object.entries(CATEGORIES).map(([category, label]) => (
          <TextField key={category} label={label} inputMode="decimal" value={values[category] ?? ""} onChange={(next) => setValues((current) => ({ ...current, [category]: next }))} />
        ))}</div>
        <p className="text-sm font-medium">{`Total ${money(total.toFixed(2))}`}</p>
        <TextArea label="What it covers / why it changes" value={reason} onChange={setReason} isRequired maxLength={1000} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || reason.trim().length < 3 || total <= 0}
            onPress={() => run(async () => { const made = await costAction<{ version: number }>(projectId, "budget", { lines: Object.entries(values).filter(([, v]) => v !== "").map(([category, amount]) => ({ category, amount })), reason, idempotencyKey: key }); return `Budget v${made.version} proposed for approval.`; })}>Propose</Button></div>
      </div>
    </Dialog>
  );
}
function DecideDialog({ proposal, currency, onClose, onDone }: { proposal: NonNullable<Summary["proposal"]>; currency: string; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const { busy, error, run } = useRun(onDone);
  const decide = (decision: "APPROVE" | "REJECT") => run(async () => { await companyAction("decide-budget", { budgetId: proposal.id, decision, note: note || undefined }); return decision === "APPROVE" ? `Budget v${proposal.version} approved.` : "Budget rejected."; });
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title={`Budget v${proposal.version} · ${money(proposal.total, currency)}`} description={proposal.reason}>
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <ul className="flex flex-col gap-0.5 text-sm">{Object.entries(proposal.lines).map(([category, amount]) => <li key={category} className="flex justify-between"><span>{CATEGORIES[category]}</span><span className="tabular-nums">{money(amount, currency)}</span></li>)}</ul>
        <TextArea label="Note (required to reject)" value={note} onChange={setNote} maxLength={1000} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="danger" isDisabled={busy || !note.trim()} onPress={() => decide("REJECT")}>Reject</Button>
          <Button variant="primary" isLoading={busy} onPress={() => decide("APPROVE")}>Approve</Button></div>
      </div>
    </Dialog>
  );
}
function ForecastDialog({ projectId, current, onClose, onDone }: { projectId: string; current: Summary["forecast"]; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [etc, setEtc] = useState(current?.estimateToComplete ?? "");
  const [treatment, setTreatment] = useState<string>(current?.commitmentTreatment ?? "INCLUDED");
  const [notes, setNotes] = useState("");
  const [key] = useState(newKey);
  const { busy, error, run } = useRun(onDone);
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Estimate to complete" description="The further cost expected to finish the project. Each update is kept as a new version.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="Estimate to complete" inputMode="decimal" value={etc} onChange={setEtc} isRequired />
        <Select label="Open purchase commitments" selectedKey={treatment} onSelectionChange={(k) => setTreatment(String(k))}
          options={[{ value: "INCLUDED", label: "Already included in this estimate" }, { value: "EXCLUDED", label: "Not included — add them to the estimate at completion" }]} />
        <TextArea label="Assumptions" value={notes} onChange={setNotes} maxLength={2000} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || etc === ""} onPress={() => run(async () => { const made = await costAction<{ version: number }>(projectId, "forecast", { estimateToComplete: etc, commitmentTreatment: treatment, notes: notes || undefined, idempotencyKey: key }); return `Forecast v${made.version} saved.`; })}>Save forecast</Button></div>
      </div>
    </Dialog>
  );
}
function OverheadDialog({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const { busy, error, run } = useRun(onDone);
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Allocate overhead" description="Applies the company's active overhead policies to this project's approved labor in the period. A managerial allocation — never a new ledger expense; once per period.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="grid gap-3 sm:grid-cols-2"><TextField label="Period start" type="date" value={start} onChange={setStart} /><TextField label="Period end" type="date" value={end} onChange={setEnd} /></div>
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !start || !end} onPress={() => run(async () => { const made = await costAction<{ total: string }>(projectId, "overhead", { periodStart: start, periodEnd: end }); return `Overhead ${money(made.total)} allocated.`; })}>Allocate</Button></div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ budget and forecast (Financials → Budget)
// The approved budget against actual cost by category, the proposal waiting for approval, and the estimate to complete / at completion.
export function BudgetForecastPanel({ projectId }: { projectId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "cost", projectId), queryFn: () => getSummary(projectId), retry: false });
  const [dialog, setDialog] = useState<"budget" | "forecast" | "decide" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (summary.isLoading) return <LoadingState label="Loading budget" rows={4} />;
  if (summary.isError) return errorStatus(summary.error) === 403 || errorStatus(summary.error) === 404 ? <Notice tone="warning">Budget and forecast need the project cost permission.</Notice> : <Notice tone="danger">{errorMessage(summary.error)}</Notice>;
  const s = summary.data!;
  const cur = s.currency;
  const done = async (text: string) => { setDialog(null); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage(text); };
  return (
    <Panel title="Budget and forecast" description="The approved cost budget against actual cost, and the estimate to complete. Budgets are approved by someone other than their author; every version is kept."
      actions={<span className="flex flex-wrap gap-2">
        {s.can.allocate && !s.proposal && <Button size="compact" variant="secondary" onPress={() => setDialog("budget")}>{s.budget.set === false ? "Propose budget" : "Revise budget"}</Button>}
        {s.can.forecast && <Button size="compact" variant="secondary" onPress={() => setDialog("forecast")}>Update forecast</Button>}
      </span>}>
      {message && <Notice tone="success">{message}</Notice>}
      {s.proposal && (
        <Notice tone="info">{`Budget v${s.proposal.version} (${money(s.proposal.total, cur)}) proposed${s.proposal.proposedBy ? ` by ${s.proposal.proposedBy}` : ""}: ${s.proposal.reason}. `}
          {s.can.approve && !s.proposal.mine ? <button type="button" className="font-medium text-brand underline" onClick={() => setDialog("decide")}>Review it</button> : "Waiting for approval."}</Notice>
      )}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Figure label="Approved budget" value={s.budget.set === false ? "Budget not set" : money(s.budget.total, cur)} note={s.budget.version ? `Version ${s.budget.version}` : undefined} />
        <Figure label="Actual cost" value={money(s.actual, cur)} note={s.utilization === null ? undefined : `${s.utilization}% of budget · ${money(s.remaining, cur)} left`} tone={s.overrun ? "danger" : undefined} />
        <Figure label="Estimate to complete" value={s.forecast ? money(s.forecast.estimateToComplete, cur) : "Not estimated"} note={s.forecast ? `v${s.forecast.version} · ${dateLabel(s.forecast.asOf)}` : undefined} />
        <Figure label="Estimate at completion" value={money(s.eac, cur)} note={s.eacVariance === null ? undefined : `${Number(s.eacVariance) < 0 ? "Over" : "Under"} budget by ${money(String(Math.abs(Number(s.eacVariance))), cur)}`}
          tone={s.forecastOverrun ? "danger" : s.forecastOverrun === false ? "success" : undefined} />
      </div>
      <LinesTable columns={["Category", { label: "Budget", numeric: true }, { label: "Actual", numeric: true }, { label: "Remaining", numeric: true }, ""]} empty={s.byCategory.length ? undefined : "No budget or cost yet."}>
        {s.byCategory.map((row) => <tr key={row.key}><Cell>{row.label}</Cell><Cell numeric>{money(row.budget, cur)}</Cell><Cell numeric>{money(row.amount, cur)}</Cell>
          <Cell numeric>{row.budget ? money(String(Number(row.budget) - Number(row.amount)), cur) : "—"}</Cell><Cell>{row.budget ? <Bar part={row.amount} whole={row.budget} /> : null}</Cell></tr>)}
      </LinesTable>
      {dialog === "budget" && <BudgetDialog projectId={projectId} current={s.budget.lines ?? {}} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "decide" && s.proposal && <DecideDialog proposal={s.proposal} currency={cur} onClose={() => setDialog(null)} onDone={done} />}
      {dialog === "forecast" && <ForecastDialog projectId={projectId} current={s.forecast} onClose={() => setDialog(null)} onDone={done} />}
    </Panel>
  );
}

// ------------------------------------------------------------------ the overhead policy (Project Settings)
export function OverheadPolicyPanel() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const policies = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "overhead-policies"), queryFn: () => call<{ rows: Array<{ id: string; number: string; method: string; rate: string; project: string; effectiveFrom: string; effectiveTo: string | null; description: string; status: string }> }>("/costs/overhead-policies").then((r) => r.rows), retry: false });
  const [form, setForm] = useState({ method: "PER_LABOR_HOUR", rate: "", effectiveFrom: "", description: "" });
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (policies.isError || !policies.data) return null;
  const save = async () => {
    try { await companyAction("overhead-policy", form); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects", "overhead-policies") }); setMessage({ tone: "success", text: "Overhead policy saved." }); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };
  const end = async (id: string) => {
    try { await companyAction("end-overhead-policy", { policyId: id }); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects", "overhead-policies") }); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };
  const label = (method: string, rate: string) => (method === "PER_LABOR_HOUR" ? `${money(rate)} per approved labor hour` : method === "PERCENT_OF_LABOR" ? `${rate}% of labor cost` : `${money(rate)} fixed`);
  return (
    <Panel title="Project overhead" description="Managerial overhead allocated to projects by Finance. It distributes cost for profitability reporting; it never adds expense to the books.">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {policies.data.length > 0 && (
        <LinesTable columns={["Policy", "Basis", "Applies to", "From", "To", ""]}>
          {policies.data.map((row) => <tr key={row.id}><Cell>{row.number}<span className="block text-xs text-text-muted">{row.description}</span></Cell><Cell>{label(row.method, row.rate)}</Cell><Cell>{row.project}</Cell>
            <Cell>{dateLabel(row.effectiveFrom)}</Cell><Cell>{row.effectiveTo ? dateLabel(row.effectiveTo) : "—"}</Cell>
            <Cell>{row.status === "ACTIVE" ? <Button size="compact" variant="ghost" onPress={() => end(row.id)}>End</Button> : "Ended"}</Cell></tr>)}
        </LinesTable>
      )}
      <div className="grid gap-3 sm:grid-cols-4">
        <Select label="Basis" selectedKey={form.method} onSelectionChange={(k) => setForm({ ...form, method: String(k) })} options={[{ value: "PER_LABOR_HOUR", label: "Per approved labor hour" }, { value: "PERCENT_OF_LABOR", label: "% of labor cost" }]} />
        <TextField label={form.method === "PER_LABOR_HOUR" ? "Amount per hour" : "Percentage"} inputMode="decimal" value={form.rate} onChange={(rate) => setForm({ ...form, rate })} />
        <TextField label="From" type="date" value={form.effectiveFrom} onChange={(effectiveFrom) => setForm({ ...form, effectiveFrom })} />
        <TextField label="What it recovers" value={form.description} onChange={(description) => setForm({ ...form, description })} />
      </div>
      <div className="flex justify-end"><Button variant="primary" isDisabled={!form.rate || !form.effectiveFrom || form.description.trim().length < 3} onPress={save}>Add policy</Button></div>
    </Panel>
  );
}

// ------------------------------------------------------------------ reports (a set of Project Reports)
export const COST_REPORT_TABS = [{ id: "pc-summary", label: "Project cost summary" }, { id: "pc-by-category", label: "By category" }, { id: "pc-by-task-milestone", label: "By task / milestone" },
  { id: "pc-by-source", label: "By source" }, { id: "pc-labor", label: "Labor cost" }, { id: "pc-expenses", label: "Expense cost" }, { id: "pc-materials", label: "Material cost" },
  { id: "pc-budget-vs-actual", label: "Budget vs actual" }, { id: "pc-actual-plus-commitments", label: "Actual + commitments" }, { id: "pc-forecast", label: "Forecast / EAC" },
  { id: "pc-profitability", label: "Profitability" }, { id: "pc-variance-trend", label: "Forecast trend" }, { id: "pc-unallocated", label: "Unallocated source costs" },
  { id: "pc-corrections", label: "Cost corrections" }, { id: "pc-exceptions", label: "Reconciliation exceptions" }];
type Row = Record<string, unknown>;
const v = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));
const m = (value: unknown) => (value === null || value === undefined ? "—" : money(String(value)));
const projectCell = (row: Row) => <Link className="text-brand underline" href={`/projects/${v(row.projectId ?? row.project_id)}?tab=financials`}>{v(row.project)}</Link>;
export function CostReport({ kind, rows }: { kind: string; rows: Row[] }) {
  if (!rows.length) return null;
  const spec: Record<string, Array<[string, (row: Row) => React.ReactNode, boolean?]>> = {
    "pc-summary": [["Project", projectCell], ["Actual", (r) => m(r.actual), true], ["Budget", (r) => (r.budget ? m(r.budget) : "Not set"), true], ["Used", (r) => (r.utilization === null ? "—" : `${v(r.utilization)}%`), true], ["Commitments", (r) => m(r.commitments), true], ["EAC", (r) => m(r.eac), true], ["Overrun", (r) => (r.overrun ? "Yes" : "—")]],
    "pc-by-category": [["Project", projectCell], ["Category", (r) => v(r.category)], ["Actual", (r) => m(r.amount), true], ["Budget", (r) => m(r.budget), true]],
    "pc-by-task-milestone": [["Project", projectCell], ["Kind", (r) => v(r.kind)], ["Task / milestone", (r) => v(r.label)], ["Cost", (r) => m(r.amount), true]],
    "pc-by-source": [["Project", projectCell], ["Source", (r) => v(r.source)], ["Lines", (r) => v(r.lines), true], ["Cost", (r) => m(r.amount), true]],
    "pc-labor": [["Project", projectCell], ["Hours", (r) => v(r.hours), true], ["Labor cost", (r) => m(r.total), true], ["Billable", (r) => m(r.billable), true], ["Non-billable", (r) => m(r.nonBillable), true], ["Missing rates", (r) => v(r.missingRate), true]],
    "pc-expenses": [["Project", projectCell], ["Claims", (r) => m(r.claims), true], ["Supplier bills", (r) => m(r.supplierBills), true], ["Pending claims", (r) => m(r.pending), true]],
    "pc-materials": [["Project", projectCell], ["Materials consumed", (r) => m(r.materials), true]],
    "pc-budget-vs-actual": [["Project", projectCell], ["Budget", (r) => (r.budget ? m(r.budget) : "Not set"), true], ["Actual", (r) => m(r.actual), true], ["Remaining", (r) => m(r.remaining), true], ["Used", (r) => (r.utilization === null ? "—" : `${v(r.utilization)}%`), true]],
    "pc-actual-plus-commitments": [["Project", projectCell], ["Actual", (r) => m(r.actual), true], ["Commitments", (r) => m(r.commitments), true], ["Pending claims", (r) => m(r.pending), true], ["Exposure", (r) => m(r.exposure), true]],
    "pc-forecast": [["Project", projectCell], ["Actual", (r) => m(r.actual), true], ["ETC", (r) => m(r.etc), true], ["Commitments", (r) => v(r.treatment)], ["EAC", (r) => m(r.eac), true], ["Budget", (r) => m(r.budget), true], ["Variance", (r) => m(r.variance), true]],
    "pc-profitability": [["Project", projectCell], ["Contract value", (r) => m(r.contractValue), true], ["Invoiced (net)", (r) => m(r.invoiced), true], ["Cost", (r) => m(r.actual), true], ["Contribution", (r) => m(r.contribution), true], ["Margin", (r) => (r.margin === null ? "—" : `${v(r.margin)}%`), true]],
    "pc-variance-trend": [["Project", projectCell], ["Version", (r) => v(r.version), true], ["As of", (r) => v(r.asOf)], ["ETC", (r) => m(r.etc), true], ["Commitments", (r) => v(r.treatment)]],
    "pc-unallocated": [["Bill", (r) => v(r.bill_number)], ["Line", (r) => v(r.description)], ["PO", (r) => v(r.purchase_order_number)], ["Net", (r) => m(r.net_amount), true], ["Allocated", (r) => m(r.allocated), true], ["Unallocated", (r) => m(r.remaining), true]],
    "pc-corrections": [["Project", (r) => v(r.project)], ["Kind", (r) => v(r.kind)], ["Amount", (r) => m(r.amount), true], ["Reason", (r) => v(r.reason)], ["When", (r) => (r.at ? formatDateTime(String(r.at)) : "—")]],
    "pc-exceptions": [["Project", projectCell], ["Kind", (r) => v(r.kind)], ["What needs attention", (r) => v(r.message)]],
  };
  const columns = spec[kind];
  if (!columns) return null;
  return (
    <LinesTable columns={columns.map(([label, , numeric]) => (numeric ? { label, numeric: true } : label))}>
      {rows.map((row, i) => <tr key={i}>{columns.map(([label, render, numeric]) => <Cell key={label} numeric={numeric}>{render(row)}</Cell>)}</tr>)}
    </LinesTable>
  );
}
