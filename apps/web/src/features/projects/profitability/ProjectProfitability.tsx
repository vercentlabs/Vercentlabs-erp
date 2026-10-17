"use client";

// Projects — Project Profitability on screen. Never one "Profit" card: actual contribution and margin (Finance's recognized revenue less
// comparable project cost), the forecast final contribution and margin (forecast revenue less the estimate at completion) and budget
// variance stay separate, each stating its basis; contract, invoiced and collected are shown beside them as commercial references only.
// Missing data shows as missing — a margin is N/A without revenue, a contribution is provisional while sources need reconciling.
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

import { call, errorMessage, errorStatus, newKey, qs, send } from "../api/projects-api";

type Warning = { kind: string; severity: "danger" | "warning" | "info"; message: string };
type Summary = {
  projectStatus: string; internal: boolean; currency: string; period: { from: string | null; to: string | null; label: string }; calculationVersion: string; calculatedAt: string; sourcesUpdatedAt: string | null;
  lastSnapshot: { number: string; at: string; reason: string } | null;
  basis: { cost: string; label: string; note: string; completeness: "COMPLETE" | "PARTIAL" | "UNAVAILABLE"; policy: Record<string, string> };
  status: string; forecastStatus: string | null;
  actual: { recognized: string | null; cost: string; contribution: string | null; margin: number | null; provisional: boolean; zeroRevenue: boolean };
  forecast: { revenue: string | null; revenueParts: { fixed: string; tmKnown: string; otherInvoiced: string; further: string | null }; tmUnforecast: boolean; etc: string | null; commitmentTreatment: string | null;
    commitments: string; eac: string | null; contribution: string | null; margin: number | null; costForecastVersion: number | null; costForecastAsOf: string | null; revenueForecastVersion: number | null } | null;
  budget: { total: string | null; actualVariance: string | null; forecastVariance: string | null; overrun: boolean | null };
  commercial: { contract: string | null; original: string | null; netInvoiced: string; collected: string; outstanding: string; remaining: string | null } | null;
  warnings: Warning[];
  can: { details: boolean; laborCost: boolean; revenue: boolean; forecast: boolean; editForecast: boolean; snapshot: boolean; reconcile: boolean; export: boolean };
};
const STATUS: Record<string, { label: string; tone: "success" | "danger" | "neutral" | "warning" | "info" }> = {
  PROFITABLE: { label: "Profitable", tone: "success" }, BREAK_EVEN: { label: "Break-even", tone: "neutral" }, LOSS: { label: "Loss", tone: "danger" }, UNKNOWN: { label: "Unknown", tone: "warning" },
  INTERNAL: { label: "Internal investment", tone: "info" }, FORECAST_PROFIT: { label: "Forecast profit", tone: "success" }, FORECAST_BREAK_EVEN: { label: "Forecast break-even", tone: "neutral" },
  FORECAST_LOSS: { label: "Forecast loss", tone: "danger" }, FORECAST_UNAVAILABLE: { label: "Forecast unavailable", tone: "warning" },
};
const COMPLETENESS: Record<string, string> = { COMPLETE: "Complete, reconciled sources", PARTIAL: "Provisional — some sources need reconciling", UNAVAILABLE: "Unavailable — Finance has not recognized revenue" };
const getSummary = (id: string, period: Record<string, string | undefined>) => call<{ summary: Summary }>(`/${id}/profitability${qs(period)}`).then((r) => r.summary);
const getView = <T,>(id: string, view: string, period: Record<string, string | undefined> = {}) => call<T>(`/${id}/profitability/${view}${qs(period)}`);
export const getProfitabilityReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/reports/profitability${qs({ kind })}`).then((r) => r.rows);
const money = (value: string | null | undefined, currency = "INR") => (value === null || value === undefined ? "—" : `${Number(value) < 0 ? "−" : ""}${currency === "INR" ? "₹" : `${currency} `}${Math.abs(Number(value)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const percent = (value: number | null | undefined) => (value === null || value === undefined ? "N/A" : `${value}%`);

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "danger" | "warning" | "success" }) {
  return <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-surface px-3 py-2.5"><span className="text-xs font-medium text-text-muted">{label}</span>
    <span className={`text-lg font-semibold tabular-nums ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : ""}`}>{value}</span>
    {note && <span className="text-xs text-text-muted">{note}</span>}</div>;
}
const toneOf = (value: string | null | undefined) => (value === null || value === undefined ? undefined : Number(value) < 0 ? "danger" as const : Number(value) > 0 ? "success" as const : undefined);
type PeriodKey = "all" | "month" | "previous" | "year" | "custom";
function periodRange(key: PeriodKey, custom: { from: string; to: string }): { from?: string; to?: string } {
  const now = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (key === "month") return { from: iso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1))), to: iso(now) };
  if (key === "previous") return { from: iso(new Date(Date.UTC(now.getFullYear(), now.getMonth() - 1, 1))), to: iso(new Date(Date.UTC(now.getFullYear(), now.getMonth(), 0))) };
  if (key === "year") { const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1; return { from: `${start}-04-01`, to: iso(now) }; }
  if (key === "custom") return { from: custom.from || undefined, to: custom.to || undefined };
  return {};
}
type Section = "breakdown" | "trend" | "history" | "warnings";

export function ProjectProfitabilityPanel({ projectId }: { projectId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [periodKey, setPeriodKey] = useState<PeriodKey>("all");
  const [custom, setCustom] = useState({ from: "", to: "" });
  const period = periodRange(periodKey, custom);
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "profitability", projectId, period.from ?? "", period.to ?? ""), queryFn: () => getSummary(projectId, period), retry: false });
  const [section, setSection] = useState<Section>("breakdown");
  const [dialog, setDialog] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  if (summary.isLoading) return <LoadingState label="Loading profitability" rows={4} />;
  if (summary.isError) return errorStatus(summary.error) === 403 || errorStatus(summary.error) === 404 ? null : <Notice tone="danger">{errorMessage(summary.error)}</Notice>;
  const s = summary.data!;
  const cur = s.currency;
  const refresh = async (text: string) => { setDialog(false); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage({ tone: "success", text }); };
  const snapshot = async () => {
    try { const r = await send<{ number: string }>(`/${projectId}/profitability/snapshot`, { idempotencyKey: newKey() }); await refresh(`Snapshot ${r.number} recorded.`); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };
  const reconcile = async () => {
    try {
      const r = await getView<{ consistent: boolean; checks: Array<{ label: string; ok: boolean; details: string[] }> }>(projectId, "reconciliation");
      setMessage({ tone: r.consistent ? "success" : "warning", text: r.consistent ? "The calculation and both sources reconcile." : r.checks.filter((x) => !x.ok).map((x) => `${x.label}: ${x.details.join(", ")}`).join(" · ") });
    } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };
  const status = STATUS[s.status];
  const fstatus = s.forecastStatus ? STATUS[s.forecastStatus] : null;
  return (
    <Panel title={s.internal ? "Internal investment" : "Project profitability"} description={`${s.basis.label}. ${s.basis.note}`}
      actions={<span className="flex flex-wrap gap-2">
        {s.can.editForecast && <Button size="compact" variant="secondary" onPress={() => setDialog(true)}>Revise forecast</Button>}
        {s.can.snapshot && <Button size="compact" variant="ghost" onPress={snapshot}>Record snapshot</Button>}
        {s.can.reconcile && <Button size="compact" variant="ghost" onPress={reconcile}>Reconcile</Button>}
        {s.can.export && <LinkButton size="compact" variant="ghost" href={`/api/projects/${projectId}/profitability/export${qs(period)}`}>Export</LinkButton>}
      </span>}>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="flex flex-wrap items-end gap-2">
        <div className="w-48"><Select label="Period" selectedKey={periodKey} onSelectionChange={(k) => setPeriodKey(String(k) as PeriodKey)}
          options={[{ value: "all", label: "Project to date" }, { value: "month", label: "Current month" }, { value: "previous", label: "Previous month" }, { value: "year", label: "Financial year" }, { value: "custom", label: "Custom range" }]} /></div>
        {periodKey === "custom" && <><TextField label="From" type="date" value={custom.from} onChange={(from) => setCustom({ ...custom, from })} /><TextField label="To" type="date" value={custom.to} onChange={(to) => setCustom({ ...custom, to })} /></>}
        <span className="flex flex-wrap gap-1 pb-1.5"><StatusBadge tone={status.tone}>{status.label}</StatusBadge>{fstatus && <StatusBadge tone={fstatus.tone}>{fstatus.label}</StatusBadge>}
          <StatusBadge tone={s.basis.completeness === "COMPLETE" ? "success" : "warning"}>{COMPLETENESS[s.basis.completeness]}</StatusBadge></span>
      </div>
      {s.internal ? (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          <Figure label="Investment to date" value={money(s.actual.cost, cur)} note={s.period.label} />
          <Figure label="Approved budget" value={s.budget.total === null ? "Budget not set" : money(s.budget.total, cur)} note={s.budget.actualVariance === null ? undefined : `${money(s.budget.actualVariance, cur)} left`} />
          {s.forecast && <Figure label="Estimate at completion" value={s.forecast.eac === null ? "Not estimated" : money(s.forecast.eac, cur)} note={s.forecast.etc === null ? "Add an estimate to complete" : `${money(s.forecast.etc, cur)} still to spend`} />}
          {s.forecast && <Figure label="Budget variance (forecast)" value={money(s.budget.forecastVariance, cur)} tone={toneOf(s.budget.forecastVariance)} note="Negative = projected overrun" />}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Figure label="Recognized revenue" value={s.actual.recognized === null ? "Not available" : money(s.actual.recognized, cur)} note={s.actual.recognized === null ? "Finance has not posted the invoices" : `Finance postings · ${s.period.label}`} tone={s.actual.recognized === null ? "warning" : undefined} />
            <Figure label="Actual project cost" value={money(s.actual.cost, cur)} note={s.basis.cost === "MANAGERIAL" ? "Includes managerial labor/overhead" : "Finance-sourced cost"} />
            <Figure label="Actual contribution" value={s.actual.contribution === null ? "Unavailable" : money(s.actual.contribution, cur)} tone={toneOf(s.actual.contribution)}
              note={s.actual.provisional ? "Provisional — sources need reconciling" : "Recognized revenue − actual cost"} />
            <Figure label="Actual margin" value={percent(s.actual.margin)} note={s.actual.margin === null ? (s.actual.zeroRevenue ? "No revenue recognized yet" : "Needs recognized revenue") : "Of recognized revenue"} tone={toneOf(s.actual.contribution)} />
          </div>
          {s.forecast && (
            <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
              <Figure label="Forecast final revenue" value={s.forecast.revenue === null ? "Unavailable" : money(s.forecast.revenue, cur)} note={s.forecast.tmUnforecast ? "Future hourly work not forecast" : "Contract + time + forecast"} />
              <Figure label="Estimate at completion" value={s.forecast.eac === null ? "Not estimated" : money(s.forecast.eac, cur)} note={s.forecast.etc === null ? "Add an estimate to complete" : `Actual + ${money(s.forecast.etc, cur)} to complete${s.forecast.commitmentTreatment === "EXCLUDED" ? " + open POs" : ""}`} />
              <Figure label="Forecast contribution" value={s.forecast.contribution === null ? "Unavailable" : money(s.forecast.contribution, cur)} tone={toneOf(s.forecast.contribution)} note="Forecast revenue − EAC" />
              <Figure label="Forecast margin" value={percent(s.forecast.margin)} tone={toneOf(s.forecast.contribution)} note={s.budget.forecastVariance === null ? "Of forecast revenue" : `Budget variance ${money(s.budget.forecastVariance, cur)}`} />
            </div>
          )}
          {s.commercial && <p className="text-sm text-text-muted">{`Commercial references (not in the formula): contract ${money(s.commercial.contract, cur)}${s.commercial.original && s.commercial.original !== s.commercial.contract ? ` (originally ${money(s.commercial.original, cur)})` : ""} · net invoiced ${money(s.commercial.netInvoiced, cur)} · collected ${money(s.commercial.collected, cur)} · ${money(s.commercial.outstanding, cur)} outstanding${s.commercial.remaining ? ` · ${money(s.commercial.remaining, cur)} still to bill` : ""}.`}</p>}
        </>
      )}
      {s.warnings.filter((w) => w.severity !== "info").length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-warning-emphasis/40 bg-warning-soft p-3 text-sm text-warning">{s.warnings.filter((w) => w.severity !== "info").map((w, i) => <li key={i}>{w.message}</li>)}</ul>
      )}
      {s.can.details && (
        <>
          <div className="flex flex-wrap gap-1">{([["breakdown", "Cost and revenue"], ["trend", "Trend"], ["history", "History"], ["warnings", `Exceptions (${s.warnings.length})`]] as Array<[Section, string]>).map(([key, label]) => (
            <Button key={key} size="compact" variant={section === key ? "secondary" : "ghost"} onPress={() => setSection(key)}>{label}</Button>
          ))}</div>
          {section === "breakdown" && <BreakdownSection projectId={projectId} currency={cur} period={period} />}
          {section === "trend" && <TrendSection projectId={projectId} currency={cur} period={period} />}
          {section === "history" && <HistorySection projectId={projectId} currency={cur} />}
          {section === "warnings" && (s.warnings.length ? <ul className="flex flex-col gap-1 text-sm">{s.warnings.map((w, i) => <li key={i} className="flex gap-2"><StatusBadge tone={w.severity === "danger" ? "danger" : w.severity === "warning" ? "warning" : "neutral"}>{w.kind.replace(/_/g, " ").toLowerCase()}</StatusBadge>{w.message}</li>)}</ul>
            : <p className="text-sm text-text-muted">No exceptions.</p>)}
        </>
      )}
      <p className="text-xs text-text-muted">{`${s.basis.policy.actual} ${s.basis.policy.breakEven} Calculation ${s.calculationVersion}, ${formatDateTime(s.calculatedAt)}${s.sourcesUpdatedAt ? `; sources last changed ${formatDateTime(s.sourcesUpdatedAt)}` : ""}${s.lastSnapshot ? `; last snapshot ${s.lastSnapshot.number} (${formatDateTime(s.lastSnapshot.at)})` : ""}.`}</p>
      {dialog && s.forecast !== undefined && <ForecastDialog projectId={projectId} current={s.forecast} onClose={() => setDialog(false)} onDone={refresh} />}
    </Panel>
  );
}
function BreakdownSection({ projectId, currency, period }: { projectId: string; currency: string; period: Record<string, string | undefined> }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "profitability-breakdown", projectId, period.from ?? "", period.to ?? ""), queryFn: () => getView<{
    cost: { total: string; direct: string; indirect: string; managerial: string; financeSourced: string; categories: Array<{ key: string; label: string; amount: string; budget: string | null; share: number | null; kind: string; basis: string }>;
      labor: { total: string; billable: string; nonBillable: string; hours: number; missingRate: number; people: Array<{ person: string; minutes: number; amount: string }> | null } };
    revenue: { recognized: string | null; bySource: Array<{ source: string; amount: string }>; rows: Array<{ entryId: string; entryNumber: string; date: string; source: string; amount: string; href: string }> | null } }>(projectId, "breakdown", period) });
  if (q.isLoading) return <LoadingState label="Loading breakdown" rows={3} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const b = q.data!;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="flex flex-col gap-2">
        <LinesTable columns={["Cost category", "Basis", { label: "Cost", numeric: true }, { label: "Share", numeric: true }, { label: "Budget", numeric: true }]} empty={b.cost.categories.length ? undefined : "No cost recognized."}>
          {b.cost.categories.map((row) => <tr key={row.key}><Cell>{row.label}{row.kind === "INDIRECT" && <span className="block text-xs text-text-muted">indirect (allocated)</span>}</Cell><Cell>{row.basis === "MANAGERIAL" ? "Managerial" : "Finance-sourced"}</Cell>
            <Cell numeric>{money(row.amount, currency)}</Cell><Cell numeric>{percent(row.share)}</Cell><Cell numeric>{money(row.budget, currency)}</Cell></tr>)}
        </LinesTable>
        <p className="text-sm">{`Direct ${money(b.cost.direct, currency)} · indirect ${money(b.cost.indirect, currency)} · managerial ${money(b.cost.managerial, currency)} · Finance-sourced ${money(b.cost.financeSourced, currency)}`}</p>
        <p className="text-sm">{`Labor ${b.cost.labor.hours} h · ${money(b.cost.labor.total, currency)} — billable ${money(b.cost.labor.billable, currency)}, non-billable ${money(b.cost.labor.nonBillable, currency)}${b.cost.labor.missingRate ? ` · ${b.cost.labor.missingRate} entries without a rate` : ""}`}</p>
        {b.cost.labor.people && <ul className="flex flex-col gap-0.5 text-sm">{b.cost.labor.people.map((p) => <li key={p.person} className="flex justify-between"><span>{p.person}</span><span className="tabular-nums">{`${Math.round(p.minutes / 6) / 10} h · ${money(p.amount, currency)}`}</span></li>)}</ul>}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-text-muted">Recognized revenue by source</p>
        {b.revenue.recognized === null ? <p className="text-sm text-text-muted">Not available from Finance.</p>
          : <ul className="flex flex-col gap-0.5 text-sm">{b.revenue.bySource.map((row) => <li key={row.source} className="flex justify-between"><span>{row.source}</span><span className="tabular-nums">{money(row.amount, currency)}</span></li>)}</ul>}
        {b.revenue.rows && b.revenue.rows.length > 0 && <ul className="flex flex-col gap-0.5 text-sm">{b.revenue.rows.map((row, i) => <li key={`${row.entryId}:${i}`} className="flex justify-between"><Link className="text-brand hover:underline" href={row.href}>{`${row.entryNumber} · ${row.source}`}</Link><span className="tabular-nums">{money(row.amount, currency)}</span></li>)}</ul>}
      </div>
    </div>
  );
}
function TrendSection({ projectId, currency, period }: { projectId: string; currency: string; period: Record<string, string | undefined> }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "profitability-trend", projectId, period.from ?? "", period.to ?? ""), queryFn: () => getView<{ revenueAvailable: boolean;
    rows: Array<{ month: string; revenue: string | null; cost: string; contribution: string | null; cumulativeContribution: string | null; cumulativeMargin: number | null }> }>(projectId, "trend", period) });
  if (q.isLoading) return <LoadingState label="Loading trend" rows={3} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const t = q.data!;
  return (
    <div className="flex flex-col gap-2">
      {!t.revenueAvailable && <Notice tone="warning">Revenue is not available from Finance, so contribution by month is not shown.</Notice>}
      <LinesTable columns={["Month", { label: "Revenue", numeric: true }, { label: "Cost", numeric: true }, { label: "Contribution", numeric: true }, { label: "Running contribution", numeric: true }, { label: "Running margin", numeric: true }]} empty={t.rows.length ? undefined : "Nothing recognized yet."}>
        {t.rows.map((row) => <tr key={row.month}><Cell>{row.month}</Cell><Cell numeric>{money(row.revenue, currency)}</Cell><Cell numeric>{money(row.cost, currency)}</Cell>
          <Cell numeric><span className={Number(row.contribution) < 0 ? "text-danger" : ""}>{money(row.contribution, currency)}</span></Cell><Cell numeric>{money(row.cumulativeContribution, currency)}</Cell><Cell numeric>{percent(row.cumulativeMargin)}</Cell></tr>)}
      </LinesTable>
    </div>
  );
}
function HistorySection({ projectId, currency }: { projectId: string; currency: string }) {
  const workspace = useWorkspaceContext();
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "profitability-history", projectId), queryFn: () => getView<{
    snapshots: Array<{ id: string; number: string; reason: string; note: string | null; at: string; by: string | null; status: string; completeness: string; recognized: string | null; cost: string; contribution: string | null; margin: number | null; forecastMargin?: number | null; eac?: string | null }>;
    costForecasts: Array<{ version: number; estimateToComplete: string; asOf: string; notes: string | null; by: string | null }>; revenueForecasts: Array<{ version: number; expectedFurther: string; asOf: string; assumptions: string; by: string | null }> }>(projectId, "history") });
  if (q.isLoading) return <LoadingState label="Loading history" rows={3} />;
  if (q.isError) return <Notice tone="danger">{errorMessage(q.error)}</Notice>;
  const h = q.data!;
  return (
    <div className="flex flex-col gap-3">
      <LinesTable columns={["Snapshot", "When", "Status", { label: "Revenue", numeric: true }, { label: "Cost", numeric: true }, { label: "Contribution", numeric: true }, { label: "Margin", numeric: true }, { label: "Forecast margin", numeric: true }]} empty={h.snapshots.length ? undefined : "No snapshots yet — one is kept when the project completes."}>
        {h.snapshots.map((row) => <tr key={row.id}><Cell>{row.number}<span className="block text-xs text-text-muted">{`${row.reason === "COMPLETION" ? "At completion" : row.reason === "MANUAL" ? "Recorded" : "Scheduled"}${row.by ? ` by ${row.by}` : ""}${row.note ? ` · ${row.note}` : ""}`}</span></Cell>
          <Cell>{formatDateTime(row.at)}</Cell><Cell><StatusBadge tone={STATUS[row.status]?.tone ?? "neutral"}>{STATUS[row.status]?.label ?? row.status}</StatusBadge></Cell><Cell numeric>{money(row.recognized, currency)}</Cell><Cell numeric>{money(row.cost, currency)}</Cell>
          <Cell numeric>{money(row.contribution, currency)}</Cell><Cell numeric>{percent(row.margin)}</Cell><Cell numeric>{percent(row.forecastMargin)}</Cell></tr>)}
      </LinesTable>
      {h.costForecasts.length > 0 && <div><p className="text-xs font-medium text-text-muted">Estimate to complete — versions</p>
        <ul className="mt-1 flex flex-col gap-0.5 text-sm">{h.costForecasts.map((row) => <li key={row.version}>{`v${row.version} · ${row.asOf} · ${money(row.estimateToComplete, currency)}${row.by ? ` · ${row.by}` : ""}${row.notes ? ` — ${row.notes}` : ""}`}</li>)}</ul></div>}
      {h.revenueForecasts.length > 0 && <div><p className="text-xs font-medium text-text-muted">Further revenue — versions</p>
        <ul className="mt-1 flex flex-col gap-0.5 text-sm">{h.revenueForecasts.map((row) => <li key={row.version}>{`v${row.version} · ${row.asOf} · ${money(row.expectedFurther, currency)}${row.by ? ` · ${row.by}` : ""} — ${row.assumptions}`}</li>)}</ul></div>}
    </div>
  );
}
function ForecastDialog({ projectId, current, onClose, onDone }: { projectId: string; current: Summary["forecast"]; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [etc, setEtc] = useState(current?.etc ?? "");
  const [treatment, setTreatment] = useState(current?.commitmentTreatment ?? "INCLUDED");
  const [further, setFurther] = useState(current?.revenueParts.further ?? "");
  const [assumptions, setAssumptions] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      const r = await send<{ costForecastVersion: number }>(`/${projectId}/profitability/forecast`, { estimateToComplete: etc, commitmentTreatment: treatment, expectedFurtherRevenue: further === "" ? undefined : further, assumptions,
        expectedCostForecastVersion: current?.costForecastVersion ?? 0, idempotencyKey: key });
      await onDone(`Forecast v${r.costForecastVersion} saved.`);
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Revise the forecast" description="Records the estimate to complete in Project Cost and, if given, the further revenue in Project Revenue — each as a new version.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="Estimate to complete (cost still to come)" inputMode="decimal" value={etc} onChange={setEtc} isRequired />
        <Select label="Open purchase commitments" selectedKey={treatment} onSelectionChange={(k) => setTreatment(String(k))}
          options={[{ value: "INCLUDED", label: "Already included in this estimate" }, { value: "EXCLUDED", label: "Not included — add them to the estimate at completion" }]} />
        <TextField label="Expected further revenue beyond the contract (optional)" inputMode="decimal" value={further} onChange={setFurther} description="For hourly work still to come, change requests or renewals — an estimate, never revenue." />
        <TextArea label="Assumptions" value={assumptions} onChange={setAssumptions} isRequired maxLength={2000} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || etc === "" || assumptions.trim().length < 3} onPress={save}>Save forecast</Button></div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ reports (a set of Project Reports)
export const PROFITABILITY_REPORT_TABS = [{ id: "pf-summary", label: "Profitability summary" }, { id: "pf-actual-margin", label: "Actual margin" }, { id: "pf-forecast-margin", label: "Forecast margin" },
  { id: "pf-profitable-vs-loss", label: "Profitable vs loss-making" }, { id: "pf-revenue-vs-cost-by-period", label: "Revenue vs cost by period" }, { id: "pf-cost-breakdown", label: "Cost breakdown" },
  { id: "pf-labor-vs-revenue", label: "Labor cost vs revenue" }, { id: "pf-budget-vs-forecast", label: "Budget vs forecast cost" }, { id: "pf-margin-history", label: "Margin change history" },
  { id: "pf-by-customer", label: "By customer" }, { id: "pf-by-manager", label: "By project manager" }, { id: "pf-completed", label: "Completed projects" }, { id: "pf-exceptions", label: "Financial data exceptions" }];
type Row = Record<string, unknown>;
const v = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));
const mo = (value: unknown) => (value === null || value === undefined ? "—" : money(String(value)));
const pc = (value: unknown) => (value === null || value === undefined ? "N/A" : `${String(value)}%`);
const st = (value: unknown) => (STATUS[String(value)]?.label ?? v(value));
const projectCell = (row: Row) => (row.projectId ? <Link className="text-brand underline" href={`/projects/${v(row.projectId)}?tab=financials`}>{v(row.project)}</Link> : <strong>{v(row.project)}</strong>);
export function ProfitabilityReport({ kind, rows }: { kind: string; rows: Row[] }) {
  if (!rows.length) return null;
  const spec: Record<string, Array<[string, (row: Row) => React.ReactNode, boolean?]>> = {
    "pf-summary": [["Project", projectCell], ["Status", (r) => st(r.status)], ["Recognized", (r) => (r.recognized === null ? "Not available" : mo(r.recognized)), true], ["Cost", (r) => mo(r.cost), true], ["Contribution", (r) => mo(r.contribution), true], ["Margin", (r) => pc(r.margin), true], ["Forecast margin", (r) => pc(r.forecastMargin), true], ["Data", (r) => v(r.completeness)]],
    "pf-actual-margin": [["Project", projectCell], ["Status", (r) => st(r.status)], ["Recognized", (r) => mo(r.recognized), true], ["Cost", (r) => mo(r.cost), true], ["Contribution", (r) => mo(r.contribution), true], ["Margin", (r) => pc(r.margin), true]],
    "pf-forecast-margin": [["Project", projectCell], ["Forecast", (r) => st(r.forecastStatus)], ["Forecast revenue", (r) => mo(r.forecastRevenue), true], ["EAC", (r) => mo(r.eac), true], ["Contribution", (r) => mo(r.contribution), true], ["Margin", (r) => pc(r.margin), true]],
    "pf-profitable-vs-loss": [["Status", (r) => st(r.status)], ["Projects", (r) => v(r.projects), true], ["Recognized", (r) => mo(r.recognized), true], ["Cost", (r) => mo(r.cost), true], ["Contribution", (r) => mo(r.contribution), true], ["Margin", (r) => pc(r.margin), true]],
    "pf-revenue-vs-cost-by-period": [["Project", projectCell], ["Month", (r) => v(r.month)], ["Revenue", (r) => mo(r.revenue), true], ["Cost", (r) => mo(r.cost), true], ["Contribution", (r) => mo(r.contribution), true], ["Running margin", (r) => pc(r.cumulativeMargin), true]],
    "pf-cost-breakdown": [["Project", projectCell], ["Category", (r) => v(r.category)], ["Kind", (r) => v(r.kind)], ["Basis", (r) => v(r.basis)], ["Cost", (r) => mo(r.amount), true], ["Share", (r) => pc(r.share), true]],
    "pf-labor-vs-revenue": [["Project", projectCell], ["Hours", (r) => v(r.hours), true], ["Labor cost", (r) => mo(r.labor), true], ["Billable", (r) => mo(r.billable), true], ["Non-billable", (r) => mo(r.nonBillable), true], ["Recognized", (r) => mo(r.recognized), true], ["Labor share", (r) => pc(r.laborShare), true]],
    "pf-budget-vs-forecast": [["Project", projectCell], ["Budget", (r) => (r.budget === null ? "Not set" : mo(r.budget)), true], ["Actual", (r) => mo(r.actual), true], ["EAC", (r) => mo(r.eac), true], ["Variance", (r) => mo(r.variance), true], ["Overrun", (r) => (r.overrun ? "Yes" : "—")]],
    "pf-margin-history": [["Project", projectCell], ["Snapshot", (r) => v(r.snapshot)], ["When", (r) => (r.at ? formatDateTime(String(r.at)) : "—")], ["Reason", (r) => v(r.reason)], ["Status", (r) => st(r.status)], ["Margin", (r) => pc(r.margin), true], ["Forecast margin", (r) => pc(r.forecastMargin), true]],
    "pf-by-customer": [["Customer", (r) => v(r.group)], ["Projects", (r) => v(r.projects), true], ["Recognized", (r) => mo(r.recognized), true], ["Cost", (r) => mo(r.cost), true], ["Contribution", (r) => mo(r.contribution), true], ["Margin", (r) => pc(r.margin), true], ["Without revenue data", (r) => v(r.unknown), true]],
    "pf-by-manager": [["Project manager", (r) => v(r.group)], ["Projects", (r) => v(r.projects), true], ["Recognized", (r) => mo(r.recognized), true], ["Cost", (r) => mo(r.cost), true], ["Contribution", (r) => mo(r.contribution), true], ["Margin", (r) => pc(r.margin), true], ["Without revenue data", (r) => v(r.unknown), true]],
    "pf-completed": [["Project", projectCell], ["Completed", (r) => v(r.completedAt ? String(r.completedAt).slice(0, 10) : null)], ["Contribution now", (r) => mo(r.contribution), true], ["At completion", (r) => mo(r.atCompletion), true], ["Changed since", (r) => mo(r.since), true], ["Margin", (r) => pc(r.margin), true]],
    "pf-exceptions": [["Project", projectCell], ["Kind", (r) => v(r.kind).replace(/_/g, " ").toLowerCase()], ["What needs attention", (r) => v(r.message)]],
  };
  const columns = spec[kind];
  if (!columns) return null;
  return (
    <LinesTable columns={columns.map(([label, , numeric]) => (numeric ? { label, numeric: true } : label))}>
      {rows.map((row, i) => <tr key={i}>{columns.map(([label, render, numeric]) => <Cell key={label} numeric={numeric}>{render(row)}</Cell>)}</tr>)}
    </LinesTable>
  );
}
