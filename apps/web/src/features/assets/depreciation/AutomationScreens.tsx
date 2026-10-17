"use client";

// Assets — Automatic Depreciation Accounting. The automation of month-end depreciation: its settings (manual; automatic preparation with
// Finance approval — the default; or automatic posting, which only an authorized Finance user enables), its health, the coming months,
// runs waiting for approval, posting history, failed and partial executions, reconciliation and the audit trail. Calculation stays the
// schedules'; posting stays Finance's — a month is posted only when Finance's journal confirms it.
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PermissionState, Select, StatusBadge } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, FactList, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { AskDialog, type Ask } from "@/features/manufacturing/orders/components/MoDialogs";
import { errorMessage, errorStatus, money } from "../register/register-api";
import {
  AUTOMATION_REPORT_KINDS, EXECUTION_TONE, HEALTH_TONE, automationAction, getAutomation, getAutomationAudit, getAutomationReport, getExecutions, getJournalPreview, type Execution,
} from "./automation-api";

const rupees = (v: string | null | undefined) => (v === null || v === undefined ? "—" : money(v));
const month = (p: string | null) => (p ? new Date(`${p.slice(0, 7)}-01T00:00:00`).toLocaleDateString("en-IN", { month: "short", year: "numeric" }) : "—");
const SUBVIEWS = [{ value: "overview", label: "Overview" }, { value: "settings", label: "Automation settings" }, { value: "upcoming", label: "Upcoming runs" }, { value: "awaiting", label: "Ready for approval" },
  { value: "history", label: "Posting history" }, { value: "failed", label: "Failed & partial runs" }, { value: "reports", label: "Reports" }, { value: "audit", label: "Audit" }];

export function AutomationPanel() {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [view, setView] = useState("overview");
  const [ask, setAsk] = useState<Ask | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "automation"), queryFn: getAutomation, retry: false });
  if (q.isLoading) return <LoadingState label="Loading automation" rows={3} />;
  if (q.isError) return errorStatus(q.error) === 403 ? <PermissionState title="You can't see depreciation automation" description="It needs the automation view permission." /> : <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const d = q.data!;
  const refresh = () => client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets", "depreciation") });
  const configure: Ask = { title: "Automation settings", confirm: "Save as a new version", description: "Saved as a new, audited version. Automatic posting is enabled separately by an authorized Finance user.",
    fields: [{ name: "mode", label: "Mode", kind: "select", required: true, initial: d.effectiveMode === "AUTO_POST" ? "PREPARE_APPROVE" : d.effectiveMode,
      options: [{ value: "PREPARE_APPROVE", label: "Automatic preparation + Finance approval (recommended)" }, { value: "MANUAL", label: "Manual — an accountant prepares and posts" }] },
      { name: "triggerDaysAfterPeriodEnd", label: "Prepare this many days after the month ends", kind: "quantity", required: true, initial: String(d.policy?.triggerDaysAfterPeriodEnd ?? 0) },
      { name: "closeDeadlineDays", label: "Report unposted months after this many days", kind: "quantity", required: true, initial: String(d.policy?.closeDeadlineDays ?? 10) },
      { name: "firstPeriod", label: "First month to automate (YYYY-MM)", kind: "text", required: true, initial: (d.policy?.firstPeriod ?? new Date().toISOString()).slice(0, 7) },
      { name: "reason", label: "Reason", kind: "textarea", required: true }],
    run: async (v) => { await automationAction("configure", { mode: v.mode, triggerDaysAfterPeriodEnd: Number(v.triggerDaysAfterPeriodEnd), closeDeadlineDays: Number(v.closeDeadlineDays), firstPeriod: String(v.firstPeriod).trim(), reason: v.reason }); await refresh(); } };
  const enable: Ask = { title: "Enable automatic posting", confirm: "Enable", description: "Runs that pass every check will be posted to Finance without a further approval, acting as you with your current rights. Earlier months, exceptions and blocked runs still wait for Finance.",
    fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }], run: async (v) => { await automationAction("enable", { reason: v.reason }); await refresh(); } };
  const disable: Ask = { title: "Turn off automatic posting", confirm: "Turn off", tone: "danger", description: "New runs will wait for Finance approval. Postings already in progress are still verified.",
    fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }], run: async (v) => { await automationAction("disable", { reason: v.reason }); await refresh(); } };
  const runNow = async () => {
    try { const r = await automationAction<{ status: string; period?: string; message?: string; code?: string }>("run"); setResult(r.message ?? `${r.period ? month(r.period) : ""}: ${r.status.replace(/_/g, " ").toLowerCase()}${r.code ? ` (${r.code})` : ""}.`); await refresh(); }
    catch (failure) { setResult(errorMessage(failure)); }
  };
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Select label="Show" size="compact" selectedKey={view} onSelectionChange={(k) => setView(String(k))} options={SUBVIEWS} />
        {d.can.run && <Button size="compact" variant="secondary" onPress={runNow}>Run now</Button>}
        {d.can.configure && <Button size="compact" variant="secondary" onPress={() => setAsk(configure)}>Change settings</Button>}
        {d.can.enable && d.effectiveMode !== "AUTO_POST" && <Button size="compact" variant="secondary" isDisabled={!d.readiness.ready} onPress={() => setAsk(enable)}>Enable automatic posting</Button>}
        {d.can.enable && d.effectiveMode === "AUTO_POST" && <Button size="compact" variant="secondary" onPress={() => setAsk(disable)}>Turn off automatic posting</Button>}
      </div>
      {result && <Notice tone="info">{result}</Notice>}
      {view === "overview" && <>
        <FactList columns={3} items={[["Mode", d.effectiveModeLabel + (d.configured ? "" : " (default)")], ["Book", d.book], ["Health", <StatusBadge key="h" tone={HEALTH_TONE[d.health] ?? "neutral"}>{d.healthLabel}</StatusBadge>],
          ["Next month to process", month(d.nextEligibleMonth)], ["Ready for approval", String(d.counts.awaitingApproval)], ["Exceptions", String(d.counts.exceptions + d.counts.failed)],
          ["Postings being verified", String(d.counts.verifying)], ["Reconciliation mismatches", String(d.counts.mismatches)], ["Months overdue", String(d.counts.overdueMonths)]]} />
        <Notice tone="neutral">{d.note}</Notice>
        {d.overdue.length > 0 && <Notice tone="warning">{`Unposted beyond the close deadline: ${d.overdue.map((o) => `${month(o.month)} (${o.assets} assets${o.amount ? `, ${rupees(o.amount)}` : ""})`).join("; ")}.`}</Notice>}
        <ExecutionsTable rows={d.executions} />
      </>}
      {view === "settings" && <>
        {d.policy ? <FactList columns={3} items={[["Version", `v${d.policy.version}`], ["Mode", d.policy.modeLabel], ["Prepare after month end", `${d.policy.triggerDaysAfterPeriodEnd} day(s)`],
          ["Close deadline", `${d.policy.closeDeadlineDays} day(s)`], ["First month", month(d.policy.firstPeriod)], ["Notifications to Finance", d.policy.notifyFinance ? "On" : "Off"],
          ["Automatic posting acts as", d.policy.postingUser ?? "—"], ["Enabled by", d.policy.enabledBy ? `${d.policy.enabledBy} · ${formatDateTime(d.policy.enabledAt)}` : "—"], ["Saved by", `${d.policy.savedBy ?? ""} · ${formatDateTime(d.policy.savedAt)}`]]} />
          : <Notice tone="neutral">Not configured yet: automatic preparation with Finance approval applies, from this month.</Notice>}
        <Panel title="Readiness for automatic posting" description="Every check must pass before automatic posting can be enabled.">
          {d.readiness.ready ? <Notice tone="success">Every check passes.</Notice> : <ul className="flex flex-col gap-1 text-sm">{d.readiness.issues.map((i, n) => <li key={n}>{i.message}</li>)}</ul>}
        </Panel>
      </>}
      {view === "upcoming" && <LinesTable columns={["Month", "Eligible from", { label: "Expected", numeric: true }, { label: "Assets", numeric: true }, "Run"]}>
        {d.upcoming.map((u) => <tr key={u.month}><Cell>{month(u.month)}</Cell><Cell>{u.eligibleOn}</Cell><Cell numeric>{rupees(u.expected)}</Cell><Cell numeric>{u.assets}</Cell>
          <Cell>{u.href ? <Link className="text-brand hover:underline" href={u.href}>{`${u.run} · ${String(u.runStatus).replace(/_/g, " ").toLowerCase()}`}</Link> : "Not prepared"}</Cell></tr>)}</LinesTable>}
      {["awaiting", "history", "failed"].includes(view) && <ExecutionList view={view} canRetry={d.can.retry} />}
      {view === "reports" && <ReportsPanel />}
      {view === "audit" && <AuditPanel />}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
function ExecutionsTable({ rows, canRetry = false, onRetry }: { rows: Execution[]; canRetry?: boolean; onRetry?: (id: string) => void }) {
  return (
    <LinesTable columns={["Month", "Mode", "Status", "Reconciliation", { label: "Proposed", numeric: true }, { label: "Posted", numeric: true }, "Run / journal", "Attempts", ""]} empty={rows.length ? undefined : "No executions yet."}>
      {rows.map((x) => <tr key={x.id}><Cell>{month(x.period)}<span className="block text-xs text-text-muted">{x.trigger === "MANUAL" ? `Run by ${x.triggeredBy ?? "a person"}` : "Scheduled"}</span></Cell><Cell>{x.modeLabel}</Cell>
        <Cell><StatusBadge tone={EXECUTION_TONE[x.status] ?? "neutral"}>{x.statusLabel}</StatusBadge>{x.error && <span className="block text-xs text-text-muted">{x.error}</span>}</Cell><Cell>{x.reconciliationLabel ?? "—"}</Cell>
        <Cell numeric>{rupees(x.proposedTotal)}</Cell><Cell numeric>{rupees(x.postedTotal)}</Cell>
        <Cell>{x.href ? <Link className="text-brand hover:underline" href={x.href}>{x.run}</Link> : "—"}{x.journalHref ? <Link className="ml-2 text-xs text-brand hover:underline" href={x.journalHref}>{x.journalNumber}</Link> : x.journalNumber ? ` · ${x.journalNumber}` : ""}</Cell>
        <Cell>{x.attempts}</Cell><Cell>{canRetry && onRetry && ["FAILED", "EXCEPTION"].includes(x.status) && <Button size="compact" variant="secondary" onPress={() => onRetry(x.id)}>Retry</Button>}</Cell></tr>)}
    </LinesTable>
  );
}
function ExecutionList({ view, canRetry }: { view: string; canRetry: boolean }) {
  const workspace = useWorkspaceContext();
  const client = useQueryClient();
  const [result, setResult] = useState<string | null>(null);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "executions", view), queryFn: () => getExecutions(view), retry: false });
  const retry = async (id: string) => {
    try { const r = await automationAction<{ status: string; code?: string }>("retry", { executionId: id }); setResult(`Retried: ${r.status.replace(/_/g, " ").toLowerCase()}${r.code ? ` (${r.code})` : ""}.`); await client.invalidateQueries({ queryKey: scopedQueryKey(workspace, "assets", "depreciation") }); }
    catch (failure) { setResult(errorMessage(failure)); }
  };
  if (q.isLoading) return <LoadingState label="Loading" rows={3} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  return <>{result && <Notice tone="info">{result}</Notice>}<ExecutionsTable rows={q.data ?? []} canRetry={canRetry} onRetry={retry} /></>;
}
function ReportsPanel() {
  const workspace = useWorkspaceContext();
  const [kind, setKind] = useState(AUTOMATION_REPORT_KINDS[0].id);
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "automation-report", kind), queryFn: () => getAutomationReport(kind), retry: false });
  const rows = q.data ?? [];
  const cols = rows.length ? Object.keys(rows[0]).filter((x) => x !== "href") : [];
  const flat = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));
  return (
    <Panel title="Reports" actions={<Select aria-label="Report" size="compact" selectedKey={kind} onSelectionChange={(x) => setKind(String(x))} options={AUTOMATION_REPORT_KINDS.map((x) => ({ value: x.id, label: x.label }))} />}>
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
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "automation-audit"), queryFn: getAutomationAudit, retry: false });
  if (q.isLoading) return <LoadingState label="Loading" rows={3} />;
  if (q.isError) return <Notice tone="warning">{errorMessage(q.error)}</Notice>;
  return (
    <div className="flex flex-col gap-4">
      <Panel title="Settings versions"><LinesTable columns={["Version", "Mode", "Saved", "Reason", "Automatic posting acts as"]} empty={q.data!.versions.length ? undefined : "No changes yet."}>
        {q.data!.versions.map((v) => <tr key={v.id}><Cell>{`v${v.version}`}</Cell><Cell>{v.modeLabel}</Cell><Cell>{`${v.savedBy ?? ""} · ${formatDateTime(v.savedAt)}`}</Cell><Cell>{v.reason ?? "—"}</Cell><Cell>{v.postingUser ?? "—"}</Cell></tr>)}</LinesTable></Panel>
      <Panel title="Attempts"><LinesTable columns={["When", "Month", "Trigger", "Attempt", "Outcome"]} empty={q.data!.attempts.length ? undefined : "No attempts yet."}>
        {q.data!.attempts.map((a, i) => <tr key={i}><Cell>{formatDateTime(a.at)}</Cell><Cell>{month(a.month)}</Cell><Cell>{a.trigger.toLowerCase()}</Cell><Cell>{a.attempt}</Cell><Cell>{a.outcome.replace(/_/g, " ").toLowerCase()}</Cell></tr>)}</LinesTable></Panel>
    </div>
  );
}

// ------------------------------------------------------------------ a run's journal preview (on the run page)
export function JournalPreviewPanel({ runId }: { runId: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "assets", "depreciation", "journal-preview", runId), queryFn: () => getJournalPreview(runId), retry: false });
  const [open, setOpen] = useState<number | null>(null);
  if (q.isLoading) return <LoadingState label="Building the journal preview" rows={2} />;
  if (q.isError) return null;
  const j = q.data!;
  return (
    <Panel title={j.journal ? "Finance journal" : "Journal preview"} description={`Dated ${j.journalDate} · ${j.book}. ${j.balanced ? "Debits equal credits." : "Does not balance — it cannot be posted."}${j.mapped ? "" : " Some accounts are missing."}`}
      actions={j.journal?.href ? <Link className="text-sm text-brand hover:underline" href={j.journal.href}>{`Journal ${j.journal.number ?? ""}`}</Link> : undefined}>
      {j.catchUpMonths.length > 0 && <Notice tone="warning">{`Includes earlier months not posted when due: ${j.catchUpMonths.map(month).join(", ")}. Finance confirms the catch-up treatment when approving.`}</Notice>}
      <LinesTable columns={["Account", { label: "Debit", numeric: true }, { label: "Credit", numeric: true }, { label: "Asset-months", numeric: true }]}>
        {j.lines.map((l, i) => <tr key={i}><Cell>{l.account ?? "Missing account"}</Cell><Cell numeric>{l.debit ? rupees(l.debit) : ""}</Cell><Cell numeric>{l.credit ? rupees(l.credit) : ""}</Cell><Cell numeric>{l.assets}</Cell></tr>)}
        <tr><Cell><span className="font-medium">Total</span></Cell><Cell numeric>{rupees(j.totalDebit)}</Cell><Cell numeric>{rupees(j.totalCredit)}</Cell><Cell numeric>{""}</Cell></tr>
      </LinesTable>
      {j.groups.map((g, i) => <div key={i} className="mt-2"><Button size="compact" variant="secondary" onPress={() => setOpen(open === i ? null : i)}>{`${open === i ? "Hide" : "Show"} the ${g.allocations.length} asset allocations of ${g.expenseAccount ?? "—"}`}</Button>
        {open === i && <LinesTable columns={["Asset", "Month", { label: "Amount", numeric: true }, "Status"]}>{g.allocations.map((a, n) => <tr key={n}><Cell>{a.asset}</Cell><Cell>{`${month(a.month)}${a.catchUp ? " (catch-up)" : ""}`}</Cell>
          <Cell numeric>{rupees(a.amount)}</Cell><Cell>{a.status.toLowerCase()}</Cell></tr>)}</LinesTable>}</div>)}
    </Panel>
  );
}
