"use client";

// The reports added by the CRM plan (3.7): Forecast (by expected close month), Trends, Pivot, Activities (per salesperson) and Targets.
// Money is in the organization's base currency; a deal in a currency with no exchange rate is left out and said so.
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Select, TextField } from "@vercentlabs/design-system";

import { UnconvertedNotice } from "@/features/crm/shared/ui/UnconvertedNotice";
import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice } from "@/shared/ui/Panel";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getActivityReport, getForecast, getPivot, getPivotDefinitions, getTargets, getTrends, saveTargets } from "../api/insights-api";

const monthLabel = (month: string) => new Date(`${month.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
const today = () => new Date().toISOString().slice(0, 10);
const yearAgo = () => new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

function Table({ head, children, foot }: { head: string[]; children: React.ReactNode; foot?: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border">
      <table className="w-full text-sm">
        <thead className="bg-surface-muted text-left text-text-secondary">
          <tr>{head.map((heading, index) => <th key={heading} className={`px-3 py-2 font-medium ${index ? "text-right" : ""}`}>{heading}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-border">{children}</tbody>
        {foot && <tfoot className="border-t border-border-strong bg-surface-muted font-semibold">{foot}</tfoot>}
      </table>
    </div>
  );
}
const Cell = ({ children, first = false }: { children: React.ReactNode; first?: boolean }) =>
  <td className={`px-3 py-2 ${first ? "font-medium" : "text-right tabular-nums"}`}>{children}</td>;
// A share of the largest value, as a thin bar under the figure.
const Bar = ({ value, max }: { value: number; max: number }) => (
  <span className="mt-1 block h-1 rounded-full bg-surface-muted"><span className="block h-1 rounded-full bg-brand" style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} /></span>
);

// ------------------------------------------------------------------ Forecast

export function ForecastReport() {
  const workspace = useWorkspaceContext();
  const [months, setMonths] = useState("6");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "insights", "forecast", months), queryFn: () => getForecast(Number(months)) });
  const report = query.data;
  const money = (value: number) => formatMoney(report?.currency.reportingCurrency ?? "INR", value, { compact: true });
  const max = Math.max(0, ...(report?.months ?? []).map((row) => row.committed + row.bestCase + row.pipeline));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-text-secondary">Open deals by the month they are expected to close, in their forecast category, with what was actually won each month.</p>
        <Select label="Months" size="compact" selectedKey={months} onSelectionChange={(value) => setMonths(String(value))}
          options={["3", "6", "12"].map((value) => ({ value, label: `Next ${value} months` }))} />
      </div>
      {report && <UnconvertedNotice currency={report.currency} />}
      {query.isLoading ? <LoadingState label="Loading the forecast" rows={4} /> : report && (
        <Table head={["Month", "Deals", "Committed", "Best case", "Pipeline", "Weighted", "Won"]}
          foot={report.overdue.deals > 0 ? (
            <tr><Cell first>Past their close date{report.overdue.undated ? ` or undated (${report.overdue.undated})` : ""}</Cell><Cell>{report.overdue.deals}</Cell><Cell>—</Cell><Cell>—</Cell>
              <Cell>{money(report.overdue.value)}</Cell><Cell>{money(report.overdue.weighted)}</Cell><Cell>—</Cell></tr>
          ) : undefined}>
          {report.months.map((row) => (
            <tr key={row.month}>
              <Cell first>{monthLabel(row.month)}<Bar value={row.committed + row.bestCase + row.pipeline} max={max} /></Cell>
              <Cell>{row.deals}</Cell><Cell>{money(row.committed)}</Cell><Cell>{money(row.bestCase)}</Cell><Cell>{money(row.pipeline)}</Cell>
              <Cell>{money(row.weighted)}</Cell><Cell>{row.wonDeals ? `${money(row.won)} (${row.wonDeals})` : "—"}</Cell>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Trends

export function TrendsReport() {
  const workspace = useWorkspaceContext();
  const [interval, setInterval_] = useState("month");
  const [from, setFrom] = useState(yearAgo());
  const [to, setTo] = useState(today());
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "insights", "trends", interval, from, to), queryFn: () => getTrends({ interval, from, to }) });
  const report = query.data;
  const max = Math.max(0, ...(report?.series ?? []).map((row) => row.leadsCreated));
  const label = (period: string) => (interval === "week" ? `Week of ${formatDate(period)}` : interval === "quarter" ? `Q${Math.floor(Number(period.slice(5, 7)) / 3) + 1} ${period.slice(0, 4)}` : monthLabel(period));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <Select label="By" size="compact" selectedKey={interval} onSelectionChange={(value) => setInterval_(String(value))}
          options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "quarter", label: "Quarter" }]} />
        <TextField label="From" type="date" size="compact" value={from} onChange={setFrom} />
        <TextField label="To" type="date" size="compact" value={to} onChange={setTo} />
      </div>
      {query.isError && <Notice>{(query.error as Error).message}</Notice>}
      {query.isLoading ? <LoadingState label="Loading trends" rows={4} /> : report && (
        <Table head={["Period", ...(report.seesLeads ? ["Leads in", "Converted"] : []), ...(report.seesDeals ? ["Deals made", "Won", "Value won", "Lost"] : [])]}>
          {[...report.series].reverse().map((row) => (
            <tr key={row.period}>
              <Cell first>{label(row.period)}{report.seesLeads && <Bar value={row.leadsCreated} max={max} />}</Cell>
              {report.seesLeads && <><Cell>{row.leadsCreated}</Cell><Cell>{row.leadsConverted}</Cell></>}
              {report.seesDeals && <><Cell>{row.dealsCreated}</Cell><Cell>{row.dealsWon}</Cell><Cell>{formatMoney(report.currency ?? "INR", row.wonValue, { compact: true })}</Cell><Cell>{row.dealsLost}</Cell></>}
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Pivot

export function PivotReport() {
  const workspace = useWorkspaceContext();
  const definitions = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "insights", "pivot-definitions"), queryFn: getPivotDefinitions, staleTime: Infinity }).data;
  const [subject, setSubject] = useState<"deals" | "leads">("deals");
  const [rows, setRows] = useState("owner");
  const [columns, setColumns] = useState("");
  const [measure, setMeasure] = useState("count");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const query = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "insights", "pivot", subject, rows, columns, measure, from, to),
    queryFn: () => getPivot({ subject, rows, columns: columns || undefined, measure, from: from || undefined, to: to || undefined }),
    enabled: Boolean(definitions),
  });
  const report = query.data;
  const current = definitions?.[subject];
  const show = (value: number) => (report?.measure.money ? formatMoney(report.currency.reportingCurrency ?? "INR", value, { compact: true }) : value.toLocaleString("en-IN"));
  const choose = (next: "deals" | "leads") => { setSubject(next); setRows("owner"); setColumns(""); setMeasure("count"); };
  return (
    <div className="flex flex-col gap-3">
      {current && (
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Of" size="compact" selectedKey={subject} onSelectionChange={(value) => choose(String(value) as "deals" | "leads")}
            options={[{ value: "deals", label: "Deals" }, { value: "leads", label: "Leads" }]} />
          <Select label="Rows" size="compact" selectedKey={rows} onSelectionChange={(value) => setRows(String(value))} options={current.dimensions.map((entry) => ({ value: entry.key, label: entry.label }))} />
          <Select label="Columns" size="compact" selectedKey={columns} onSelectionChange={(value) => setColumns(String(value ?? ""))}
            options={[{ value: "", label: "None" }, ...current.dimensions.filter((entry) => entry.key !== rows).map((entry) => ({ value: entry.key, label: entry.label }))]} />
          <Select label="Measure" size="compact" selectedKey={measure} onSelectionChange={(value) => setMeasure(String(value))} options={current.measures.map((entry) => ({ value: entry.key, label: entry.label }))} />
          <TextField label={subject === "deals" ? "Made from" : "Created from"} type="date" size="compact" value={from} onChange={setFrom} />
          <TextField label="To" type="date" size="compact" value={to} onChange={setTo} />
        </div>
      )}
      {report && <UnconvertedNotice currency={report.currency} />}
      {query.isError && <Notice>{(query.error as Error).message}</Notice>}
      {query.isLoading || !definitions ? <LoadingState label="Loading the pivot" rows={4} /> : report && (
        report.rows.length === 0 ? <p className="text-sm text-text-secondary">Nothing to show for these choices.</p> : (
          <Table head={[current!.dimensions.find((entry) => entry.key === rows)?.label ?? "", ...report.columns.map((column) => column.label), ...(columns ? ["Total"] : [])]}
            foot={<tr><Cell first>Total</Cell>{report.columns.map((column) => <Cell key={column.key}>{show(report.columnTotals[column.key] ?? 0)}</Cell>)}{columns && <Cell>{show(report.total)}</Cell>}</tr>}>
            {report.rows.map((row) => (
              <tr key={row.key}>
                <Cell first>{row.label}</Cell>
                {report.columns.map((column) => <Cell key={column.key}>{report.cells[row.key]?.[column.key] ? show(report.cells[row.key][column.key]) : "—"}</Cell>)}
                {columns && <Cell>{show(report.rowTotals[row.key] ?? 0)}</Cell>}
              </tr>
            ))}
          </Table>
        )
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Activities per salesperson

export function ActivityReport() {
  const workspace = useWorkspaceContext();
  const [from, setFrom] = useState(`${today().slice(0, 8)}01`);
  const [to, setTo] = useState(today());
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "insights", "activity", from, to), queryFn: () => getActivityReport({ from, to }) });
  const report = query.data;
  const keys = ["calls", "emails", "meetings", "whatsapp", "sms", "tasksDone", "followUpsDone", "leadsTouched", "dealsTouched", "overdue"] as const;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-text-secondary">What each salesperson logged and completed in the period. Overdue is what is past due now.</p>
        <div className="flex gap-3">
          <TextField label="From" type="date" size="compact" value={from} onChange={setFrom} />
          <TextField label="To" type="date" size="compact" value={to} onChange={setTo} />
        </div>
      </div>
      {query.isLoading ? <LoadingState label="Loading activities" rows={4} /> : report && (
        <Table head={["Salesperson", "Calls", "Emails", "Meetings", "WhatsApp", "SMS", "Tasks done", "Follow-ups done", "Leads worked", "Deals worked", "Overdue now"]}
          foot={report.people.length > 1 ? <tr><Cell first>Total</Cell>{keys.map((key) => <Cell key={key}>{report.totals[key] ?? 0}</Cell>)}</tr> : undefined}>
          {report.people.map((person) => (
            <tr key={person.userId}>
              <Cell first>{person.name}</Cell>
              {keys.map((key) => <Cell key={key}>{key === "overdue" && person[key] > 0 ? <span className="text-danger">{person[key]}</span> : person[key]}</Cell>)}
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ Targets

export function TargetsReport() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(today().slice(0, 7));
  const key = scopedQueryKey(workspace, "crm", "insights", "targets", month);
  const query = useQuery({ queryKey: key, queryFn: () => getTargets(month) });
  const [editing, setEditing] = useState<Record<string, string> | null>(null);
  const report = query.data;
  const save = useMutation({
    mutationFn: () => saveTargets(month, Object.entries(editing ?? {}).map(([cell, value]) => {
      const [userId, metric] = cell.split("|");
      return { userId, metric, target: value.trim() ? Number(value) : null };
    })),
    onSuccess: (next) => { queryClient.setQueryData(key, next); setEditing(null); },
  });
  const show = (metric: { key: string; money?: boolean }, value: number) => (metric.money ? formatMoney(report?.currency ?? "INR", value, { compact: true }) : value.toLocaleString("en-IN"));
  const startEditing = () => setEditing(Object.fromEntries((report?.people ?? []).flatMap((person) =>
    report!.metrics.map((metric) => [`${person.userId}|${metric.key}`, person.measures[metric.key]?.target !== null && person.measures[metric.key]?.target !== undefined ? String(person.measures[metric.key].target) : ""]))));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TextField label="Month" type="month" size="compact" value={month} onChange={(value) => { setMonth(value || today().slice(0, 7)); setEditing(null); }} />
        {report?.canSet && (editing
          ? <div className="flex gap-2"><Button variant="secondary" onPress={() => setEditing(null)}>Cancel</Button><Button variant="primary" isLoading={save.isPending} onPress={() => save.mutate()}>Save targets</Button></div>
          : <Button variant="secondary" onPress={startEditing}>Set targets</Button>)}
      </div>
      {save.isError && <Notice>{(save.error as Error).message}</Notice>}
      {query.isLoading ? <LoadingState label="Loading targets" rows={4} /> : report && (
        <Table head={["Salesperson", ...report.metrics.map((metric) => metric.label)]}>
          {report.people.map((person) => (
            <tr key={person.userId}>
              <Cell first>{person.name}</Cell>
              {report.metrics.map((metric) => {
                const measure = person.measures[metric.key];
                const cell = `${person.userId}|${metric.key}`;
                return (
                  <Cell key={metric.key}>
                    {editing
                      ? <TextField aria-label={`${metric.label} target for ${person.name}`} size="compact" inputMode="decimal" value={editing[cell] ?? ""}
                          onChange={(value) => setEditing((current) => ({ ...current, [cell]: value }))} />
                      : <span className="flex flex-col items-end">
                          <span>{show(metric, measure.actual)}{measure.target !== null ? <span className="text-text-muted"> / {show(metric, measure.target)}</span> : null}</span>
                          {measure.attainment !== null && <span className={`text-xs ${measure.attainment >= 100 ? "text-success" : "text-text-muted"}`}>{measure.attainment}%</span>}
                        </span>}
                  </Cell>
                );
              })}
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
