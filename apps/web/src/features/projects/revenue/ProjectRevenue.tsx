"use client";

// Projects — Project Revenue on screen. Four measures, never one "Revenue" card: contract value (Sales Orders), net invoiced (issued lines less
// credit notes, excluding GST), recognized revenue (Finance's postings) and collections (Finance's settlements, gross). Each says what it is,
// each line opens its Sales or Finance source, and the sections show only what the reader may see. Nothing here creates a financial record.
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, LinkButton, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { call, dateLabel, errorMessage, errorStatus, newKey, qs, send } from "../api/projects-api";

type Can = { contracts: boolean; invoices: boolean; recognition: boolean; collections: boolean; profitability: boolean; manageLinks: boolean; forecast: boolean; reconcile: boolean; export: boolean };
type Summary = {
  projectStatus: string; currency: string; calculatedAt: string; sourcesUpdatedAt: string | null; basis: string; models: Array<{ key: string; label: string }>; hybrid: boolean;
  contract: { value: string | null; original: string | null; proposed: string | null; message: string | null; amendments: number; orders: string[]; invoicedPercent: number | null };
  invoiced: { gross: string; lines: string; credited: string; net: string; invoices: number; pending: string };
  recognized: { available: boolean; total: string | null; currentPeriod: { name: string; amount: string } | null; deferred: string | null; accrued: string | null; message: string | null } | null;
  collections: { gross: string; settled: string; credited: string; outstanding: string; overdue: string; overdueInvoices: number; advancesUnapplied: string; advancesApplied: string } | null;
  unbilled: { contractRemaining: string | null; timeCapRemaining: string; approvedTimeValue: string; submittedMinutes: number; readyToBill: string; expenses: { total: string; requests: number }; drafts: string };
  forecast: { version: number; expectedFurther: string; asOf: string; assumptions: string; label: string } | null;
  exceptions: number; can: Can;
};
type ContractLine = { key: string; orderId: string; orderNumber: string; orderStatus: string; version: number; sequence: number; item: string | null; quantity: string; unitPrice: string; currency: string;
  lineValue: string; model: string; basis: string; sharedWith: number; allocation: { id: string; number: string; amount: string; reason: string } | null; capacityLeft: string | null; amount: string;
  amountBase: string | null; contracted: boolean; proposed: boolean; customerMismatch: boolean; href: string };
type InvoiceLine = { lineId: string; invoiceId: string; number: string; status: string; state: string; date: string; lineSequence: number; description: string | null; net: string; amount: string;
  amountBase: string | null; currency: string; basis: string; href: string };
type Credit = { creditId: string; number: string; status: string; state: string; date: string; sourceInvoice: string; amountBase: string | null; reason: string | null; href: string };

const MODEL: Record<string, string> = { FIXED: "Fixed price", TIME_AND_MATERIALS: "Time and materials", MILESTONE: "Milestone billing" };
const BASIS: Record<string, string> = { WHOLE_LINE: "Whole line", ALLOCATED: "Allocated share", SHARED: "Shared — needs an allocation", CONTRACT_LINE: "Order line", INVOICE_LINK: "Linked invoice",
  EXPENSE_RECHARGE: "Expense recharge" };
const STAGE: Record<string, { label: string; tone: "neutral" | "info" | "success" }> = { NOT_YET_ELIGIBLE: { label: "Not yet eligible", tone: "neutral" }, READY_TO_BILL: { label: "Ready to bill", tone: "info" },
  INVOICED: { label: "Invoiced", tone: "success" } };
const getSummary = (id: string) => call<{ summary: Summary }>(`/${id}/revenue`).then((r) => r.summary);
const getView = <T,>(id: string, view: string) => call<T>(`/${id}/revenue/${view}`);
const action = <T = Record<string, unknown>>(id: string, view: string, input: Record<string, unknown>) => send<T>(`/${id}/revenue/${view}`, input);
const companyAction = (name: string, input: Record<string, unknown>) => send(`/revenue/${name}`, input);
export const getRevenueReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/reports/revenue${qs({ kind })}`).then((r) => r.rows);
const money = (value: string | null | undefined, currency = "INR") => (value === null || value === undefined ? "—" : `${Number(value) < 0 ? "−" : ""}${currency === "INR" ? "₹" : `${currency} `}${Math.abs(Number(value)).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const hours = (minutes: number) => `${Math.round(minutes / 6) / 10} h`;

function Figure({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: "danger" | "warning" | "success" }) {
  return <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-surface px-3 py-2.5"><span className="text-xs font-medium text-text-muted">{label}</span>
    <span className={`text-lg font-semibold tabular-nums ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : ""}`}>{value}</span>
    {note && <span className="text-xs text-text-muted">{note}</span>}</div>;
}
type Section = "contracts" | "schedule" | "unbilled" | "invoices" | "collections" | "recognition" | "activity";

export function ProjectRevenuePanel({ projectId }: { projectId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "revenue", projectId), queryFn: () => getSummary(projectId), retry: false });
  const [section, setSection] = useState<Section>("contracts");
  const [dialog, setDialog] = useState<{ kind: "contract"; line: ContractLine } | { kind: "invoice"; line: InvoiceLine } | { kind: "forecast" } | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  if (summary.isLoading) return <LoadingState label="Loading project revenue" rows={4} />;
  if (summary.isError) return errorStatus(summary.error) === 403 || errorStatus(summary.error) === 404 ? null : <Notice tone="danger">{errorMessage(summary.error)}</Notice>;
  const s = summary.data!;
  const cur = s.currency;
  const done = async (text: string) => { setDialog(null); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage({ tone: "success", text }); };
  const reconcile = async () => {
    try {
      const r = await getView<{ consistent: boolean; checks: Array<{ label: string; ok: boolean; details: string[] }> }>(projectId, "reconciliation");
      setMessage({ tone: r.consistent ? "success" : "warning", text: r.consistent ? "Every figure matches its Sales or Finance source." : r.checks.filter((x) => !x.ok).map((x) => `${x.label}: ${x.details.join(", ")}`).join(" · ") });
    } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };
  const sections: Array<[Section, string, boolean]> = [["contracts", "Contracts", s.can.contracts], ["schedule", "Billing schedule", true], ["unbilled", "Unbilled work", true], ["invoices", "Invoices", s.can.invoices],
    ["collections", "Collections", s.can.collections], ["recognition", "Recognition", s.can.recognition], ["activity", "Reconciliation", true]];
  return (
    <Panel title="Project revenue" description={s.basis}
      actions={<span className="flex flex-wrap gap-2">
        {s.can.forecast && <Button size="compact" variant="secondary" onPress={() => setDialog({ kind: "forecast" })}>Update forecast</Button>}
        <Button size="compact" variant="ghost" onPress={reconcile}>Reconcile</Button>
        {s.can.export && <LinkButton size="compact" variant="ghost" href={`/api/projects/${projectId}/revenue/export`}>Export</LinkButton>}
      </span>}>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Figure label="Contract value" value={s.contract.value === null ? (s.contract.proposed ? "Not contracted" : "No contract") : money(s.contract.value, cur)}
          note={s.contract.value === null ? s.contract.message ?? undefined : s.contract.original && s.contract.original !== s.contract.value ? `Originally ${money(s.contract.original, cur)} · ${s.contract.amendments} amendment${s.contract.amendments === 1 ? "" : "s"}` : `Confirmed Sales Orders${s.contract.orders.length ? ` · ${s.contract.orders.join(", ")}` : ""}`} />
        <Figure label="Net invoiced (excl. GST)" value={money(s.invoiced.net, cur)}
          note={`${s.invoiced.invoices} issued invoice${s.invoiced.invoices === 1 ? "" : "s"}${Number(s.invoiced.credited) > 0 ? ` · ${money(s.invoiced.credited, cur)} credited` : ""}${s.contract.invoicedPercent === null ? "" : ` · ${s.contract.invoicedPercent}% of contract`}`} />
        <Figure label="Revenue recognized" value={!s.recognized ? "Restricted" : s.recognized.available ? money(s.recognized.total, cur) : "Not available"}
          note={!s.recognized ? "Finance permission needed" : s.recognized.message ?? (s.recognized.currentPeriod ? `${s.recognized.currentPeriod.name}: ${money(s.recognized.currentPeriod.amount, cur)}` : "Posted by Finance")}
          tone={s.recognized && !s.recognized.available ? "warning" : undefined} />
        <Figure label="Collected (gross)" value={!s.collections ? "Restricted" : money(s.collections.settled, cur)}
          note={!s.collections ? "Finance permission needed" : `${money(s.collections.outstanding, cur)} outstanding${Number(s.collections.overdue) > 0 ? ` · ${money(s.collections.overdue, cur)} overdue` : ""}`}
          tone={s.collections && Number(s.collections.overdue) > 0 ? "danger" : undefined} />
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Figure label="Unbilled contract value" value={s.unbilled.contractRemaining === null ? "Not measurable" : money(s.unbilled.contractRemaining, cur)} note="Fixed-price and milestone lines not yet invoiced" />
        <Figure label="Approved unbilled time" value={money(s.unbilled.approvedTimeValue, cur)} note={`At agreed rates${s.unbilled.submittedMinutes ? ` · ${hours(s.unbilled.submittedMinutes)} awaiting approval` : ""} · not revenue`} />
        <Figure label="Ready to bill" value={money(s.unbilled.readyToBill, cur)} note={`Milestones${s.unbilled.expenses.requests ? ` · ${money(s.unbilled.expenses.total, cur)} expenses to recharge` : ""}${Number(s.unbilled.drafts) > 0 ? ` · ${money(s.unbilled.drafts, cur)} in drafts` : ""}`} />
        <Figure label="Forecast further revenue" value={s.forecast ? money(s.forecast.expectedFurther, cur) : "No forecast"} note={s.forecast ? `${s.forecast.label} v${s.forecast.version}, ${dateLabel(s.forecast.asOf)}` : "Optional, manual"} />
      </div>
      {s.collections && Number(s.collections.advancesUnapplied) > 0 && <Notice tone="info">{`${money(s.collections.advancesUnapplied, cur)} received as advances is held against the orders — not revenue until Finance applies it.`}</Notice>}
      {s.models.length > 0 && <p className="text-xs text-text-muted">{`Billing: ${s.models.map((x) => x.label).join(" + ")}${s.hybrid ? " (hybrid — each line keeps its own method)" : ""}.`}</p>}
      <div className="flex flex-wrap gap-1">{sections.filter(([, , ok]) => ok).map(([key, label]) => (
        <Button key={key} size="compact" variant={section === key ? "secondary" : "ghost"} onPress={() => setSection(key)}>{key === "activity" && s.exceptions ? `${label} (${s.exceptions})` : label}</Button>
      ))}</div>
      {section === "contracts" && s.can.contracts && <ContractsSection projectId={projectId} currency={cur} canAllocate={s.can.manageLinks} onAllocate={(line) => setDialog({ kind: "contract", line })} onDone={done} />}
      {section === "schedule" && <ScheduleSection projectId={projectId} currency={cur} />}
      {section === "unbilled" && <UnbilledSection projectId={projectId} currency={cur} />}
      {section === "invoices" && s.can.invoices && <InvoicesSection projectId={projectId} currency={cur} canAllocate={s.can.manageLinks} onAllocate={(line) => setDialog({ kind: "invoice", line })} />}
      {section === "collections" && s.can.collections && <CollectionsSection projectId={projectId} currency={cur} />}
      {section === "recognition" && s.can.recognition && <RecognitionSection projectId={projectId} currency={cur} summary={s} />}
      {section === "activity" && <ExceptionsSection projectId={projectId} />}
      <p className="text-xs text-text-muted">{`Calculated ${formatDateTime(s.calculatedAt)} from Sales and Finance${s.sourcesUpdatedAt ? `; sources last changed ${formatDateTime(s.sourcesUpdatedAt)}` : ""}.`}</p>
      {dialog?.kind === "contract" && <AllocateDialog title={`Allocate ${dialog.line.orderNumber} line ${dialog.line.sequence}`} description={`Line value ${money(dialog.line.lineValue, dialog.line.currency)}${dialog.line.capacityLeft ? ` · ${money(dialog.line.capacityLeft, dialog.line.currency)} not yet allocated` : ""}. Use this when the line serves several projects.`}
        onClose={() => setDialog(null)} onSave={async (amount, reason, key) => { const r = await action<{ number: string }>(projectId, "contract-allocation", { salesOrderId: dialog.line.orderId, lineSequence: dialog.line.sequence, amount, reason, idempotencyKey: key }); await done(`${r.number} saved.`); }} />}
      {dialog?.kind === "invoice" && <AllocateDialog title={`Allocate ${dialog.line.number} line ${dialog.line.lineSequence}`} description={`Line value ${money(dialog.line.net, dialog.line.currency)} excluding GST. The project's part; never more than the line across projects.`}
        onClose={() => setDialog(null)} onSave={async (amount, reason, key) => { const r = await action<{ number: string }>(projectId, "invoice-allocation", { invoiceLineId: dialog.line.lineId, amount, reason, commandId: key }); await done(`${r.number} saved.`); }} />}
      {dialog?.kind === "forecast" && <ForecastDialog projectId={projectId} current={s.forecast} onClose={() => setDialog(null)} onDone={done} />}
    </Panel>
  );
}
function useSection<T>(projectId: string, view: string) {
  const workspace = useWorkspaceContext();
  return useQuery({ queryKey: scopedQueryKey(workspace, "projects", "revenue-view", projectId, view), queryFn: () => getView<T>(projectId, view), retry: false });
}
function Loading<T>({ query, children }: { query: { isLoading: boolean; isError: boolean; error: unknown; data?: T }; children: (data: T) => React.ReactNode }) {
  if (query.isLoading) return <LoadingState label="Loading" rows={3} />;
  if (query.isError) return <Notice tone="danger">{errorMessage(query.error)}</Notice>;
  return <>{children(query.data as T)}</>;
}
function ContractsSection({ projectId, currency, canAllocate, onAllocate, onDone }: { projectId: string; currency: string; canAllocate: boolean; onAllocate: (line: ContractLine) => void; onDone: (text: string) => Promise<void> }) {
  const q = useSection<{ lines: ContractLine[]; amendments: Array<{ id: string; order: string; fromVersion: number; toVersion: number; from: string; to: string; reason: string; at: string; href: string }> }>(projectId, "contracts");
  const end = async (allocationId: string) => { try { await companyAction("end-contract-allocation", { allocationId, reason: "Allocation withdrawn" }); await onDone("Allocation ended."); } catch (failure) { await onDone(errorMessage(failure)); } };
  return <Loading query={q}>{(data) => (
    <div className="flex flex-col gap-3">
      <LinesTable columns={["Order line", "Billing", "Status", "Basis", { label: "Line value", numeric: true }, { label: "This project", numeric: true }, ""]} empty={data.lines.length ? undefined : "No Sales Order is linked to this project."}>
        {data.lines.map((line) => (
          <tr key={line.key}>
            <Cell><Link className="text-brand hover:underline" href={line.href}>{`${line.orderNumber} · ${line.sequence}`}</Link><span className="block text-xs text-text-muted">{`${line.item ?? ""} · ${line.quantity} × ${money(line.unitPrice, line.currency)} · v${line.version}`}</span></Cell>
            <Cell>{MODEL[line.model]}</Cell>
            <Cell>{line.customerMismatch ? <StatusBadge tone="danger">Other customer</StatusBadge> : line.contracted ? <StatusBadge tone="success">Contracted</StatusBadge> : line.proposed ? <StatusBadge tone="neutral">Proposed</StatusBadge> : <StatusBadge tone="neutral">{line.orderStatus}</StatusBadge>}</Cell>
            <Cell>{BASIS[line.basis]}{line.allocation && <span className="block text-xs text-text-muted">{`${line.allocation.number}: ${line.allocation.reason}`}</span>}</Cell>
            <Cell numeric>{money(line.lineValue, line.currency)}</Cell>
            <Cell numeric>{money(line.amountBase, currency)}</Cell>
            <Cell>{canAllocate && line.contracted && <span className="flex gap-1"><Button size="compact" variant="ghost" onPress={() => onAllocate(line)}>{line.allocation ? "Change" : "Allocate"}</Button>
              {line.allocation && <Button size="compact" variant="ghost" onPress={() => end(line.allocation!.id)}>End</Button>}</span>}</Cell>
          </tr>
        ))}
      </LinesTable>
      {data.amendments.length > 0 && <div><p className="text-xs font-medium text-text-muted">Amendments</p>
        <ul className="mt-1 flex flex-col gap-0.5 text-sm">{data.amendments.map((a) => <li key={a.id}><Link className="text-brand hover:underline" href={a.href}>{a.order}</Link>{` v${a.fromVersion} → v${a.toVersion}: ${money(a.from, currency)} → ${money(a.to, currency)} · ${a.reason}`}</li>)}</ul></div>}
    </div>
  )}</Loading>;
}
function ScheduleSection({ projectId, currency }: { projectId: string; currency: string }) {
  const q = useSection<{ rows: Array<{ milestoneId: string; code: string; name: string; due: string | null; orderNumber: string | null; amount: string | null; invoiced: string; state: string; href: string }> }>(projectId, "schedule");
  return <Loading query={q}>{(data) => (
    <LinesTable columns={["Milestone", "Due", "Order", "Stage", { label: "Amount", numeric: true }, { label: "Invoiced", numeric: true }]} empty={data.rows.length ? undefined : "No milestone bills against a Sales Order line."}>
      {data.rows.map((row) => <tr key={row.milestoneId}><Cell><Link className="text-brand hover:underline" href={row.href}>{`${row.code} · ${row.name}`}</Link></Cell><Cell>{row.due ? dateLabel(row.due) : "—"}</Cell><Cell>{row.orderNumber ?? "—"}</Cell>
        <Cell><StatusBadge tone={STAGE[row.state].tone}>{STAGE[row.state].label}</StatusBadge></Cell><Cell numeric>{money(row.amount, currency)}</Cell><Cell numeric>{money(row.invoiced, currency)}</Cell></tr>)}
    </LinesTable>
  )}</Loading>;
}
function UnbilledSection({ projectId, currency }: { projectId: string; currency: string }) {
  const q = useSection<{ contractLines: Array<{ key: string; orderNumber: string; sequence?: number; model: string; amount?: string; invoiced: string; remaining: string; pending?: string }>;
    time: Array<{ contractLineId: string; label: string; rate: string | null; approvedMinutes: number; billedMinutes: number; unbilledMinutes: number; submittedMinutes: number; unbilledValue: string }>; expenses: { total: string; requests: number } }>(projectId, "unbilled");
  return <Loading query={q}>{(data) => (
    <div className="flex flex-col gap-3">
      <LinesTable columns={["Contract line", "Billing", { label: "Invoiced", numeric: true }, { label: "Remaining", numeric: true }]} empty={data.contractLines.length ? undefined : "No contracted lines."}>
        {data.contractLines.map((line) => <tr key={line.key}><Cell>{`${line.orderNumber}${line.sequence ? ` · ${line.sequence}` : ""}`}</Cell><Cell>{MODEL[line.model]}{line.model === "TIME_AND_MATERIALS" && <span className="block text-xs text-text-muted">remaining authorized cap</span>}</Cell>
          <Cell numeric>{money(line.invoiced, currency)}</Cell><Cell numeric>{money(line.remaining, currency)}</Cell></tr>)}
      </LinesTable>
      {data.time.length > 0 && <LinesTable columns={["Hourly service", { label: "Rate", numeric: true }, { label: "Approved", numeric: true }, { label: "Billed", numeric: true }, { label: "Unbilled", numeric: true }, { label: "Awaiting approval", numeric: true }, { label: "Unbilled value", numeric: true }]}>
        {data.time.map((row) => <tr key={row.contractLineId}><Cell>{row.label}</Cell><Cell numeric>{money(row.rate, currency)}</Cell><Cell numeric>{hours(row.approvedMinutes)}</Cell><Cell numeric>{hours(row.billedMinutes)}</Cell>
          <Cell numeric>{hours(row.unbilledMinutes)}</Cell><Cell numeric>{hours(row.submittedMinutes)}</Cell><Cell numeric>{money(row.unbilledValue, currency)}</Cell></tr>)}
      </LinesTable>}
      {data.expenses.requests > 0 && <p className="text-sm">{`${data.expenses.requests} expense recharge request${data.expenses.requests === 1 ? "" : "s"} (${money(data.expenses.total, currency)}) waiting for a Sales invoice.`}</p>}
    </div>
  )}</Loading>;
}
function InvoicesSection({ projectId, currency, canAllocate, onAllocate }: { projectId: string; currency: string; canAllocate: boolean; onAllocate: (line: InvoiceLine) => void }) {
  const q = useSection<{ lines: InvoiceLine[]; credits: Credit[] }>(projectId, "invoices");
  return <Loading query={q}>{(data) => (
    <div className="flex flex-col gap-3">
      <LinesTable columns={["Invoice line", "Date", "Status", "Attributed by", { label: "Line (excl. GST)", numeric: true }, { label: "This project", numeric: true }, ""]} empty={data.lines.length ? undefined : "No invoice lines are attributed to this project."}>
        {data.lines.map((line) => <tr key={line.lineId}><Cell><Link className="text-brand hover:underline" href={line.href}>{`${line.number} · ${line.lineSequence}`}</Link><span className="block text-xs text-text-muted">{line.description}</span></Cell>
          <Cell>{dateLabel(line.date)}</Cell><Cell>{line.state === "ISSUED" ? line.status.replace(/_/g, " ") : line.state === "PENDING" ? <StatusBadge tone="neutral">{`${line.status.replace(/_/g, " ")} — pending`}</StatusBadge> : <StatusBadge tone="neutral">{line.status}</StatusBadge>}</Cell>
          <Cell>{BASIS[line.basis] ?? line.basis}</Cell><Cell numeric>{money(line.net, line.currency)}</Cell><Cell numeric>{money(line.amountBase, currency)}</Cell>
          <Cell>{canAllocate && line.state === "ISSUED" && line.basis === "ALLOCATED" && <Button size="compact" variant="ghost" onPress={() => onAllocate(line)}>Change</Button>}</Cell></tr>)}
      </LinesTable>
      {data.credits.length > 0 && <LinesTable columns={["Credit note", "Against", "Date", "Status", "Reason", { label: "This project", numeric: true }]}>
        {data.credits.map((row) => <tr key={`${row.creditId}`}><Cell><Link className="text-brand hover:underline" href={row.href}>{row.number}</Link></Cell><Cell>{row.sourceInvoice}</Cell><Cell>{dateLabel(row.date)}</Cell>
          <Cell>{row.state === "ISSUED" ? row.status.replace(/_/g, " ") : `${row.status} — not counted`}</Cell><Cell>{row.reason ?? "—"}</Cell><Cell numeric>{row.amountBase ? `−${money(row.amountBase, currency)}` : "—"}</Cell></tr>)}
      </LinesTable>}
      {canAllocate && <InvoiceAllocationHint projectId={projectId} onAllocate={onAllocate} />}
    </div>
  )}</Loading>;
}
// Lines of a divided order line that still need an allocation are listed as exceptions; this offers them for allocation.
function InvoiceAllocationHint({ projectId, onAllocate }: { projectId: string; onAllocate: (line: InvoiceLine) => void }) {
  const q = useSection<{ rows: Array<{ kind: string; invoiceLineId?: string; invoiceId?: string; invoiceNumber?: string; lineSequence?: number; net?: string; currency?: string; message: string }> }>(projectId, "exceptions");
  const open = (q.data?.rows ?? []).filter((row) => row.kind === "INVOICE_LINE_UNALLOCATED" && row.invoiceLineId);
  if (!open.length) return null;
  return <ul className="flex flex-col gap-1 rounded-lg border border-border p-3 text-sm">{open.map((row) => (
    <li key={row.invoiceLineId} className="flex items-center justify-between gap-2"><span>{row.message}</span>
      <Button size="compact" variant="secondary" onPress={() => onAllocate({ lineId: row.invoiceLineId!, invoiceId: row.invoiceId ?? "", number: row.invoiceNumber ?? "", status: "posted", state: "ISSUED", date: "",
        lineSequence: row.lineSequence ?? 0, description: null, net: row.net ?? "0", amount: "0", amountBase: null, currency: row.currency ?? "INR", basis: "ALLOCATED", href: "" })}>Allocate</Button></li>
  ))}</ul>;
}
function CollectionsSection({ projectId, currency }: { projectId: string; currency: string }) {
  const q = useSection<{ rows: Array<{ invoiceId: string; number: string; due: string; gross: string; settled: string; credited: string; outstanding: string; overdue: boolean; daysOverdue: number; receipts: Array<{ number: string; date: string; amount: string }>; href: string }>;
    advances: Array<{ id: string; order: string; date: string; status: string; reference: string; amount: string }> }>(projectId, "collections");
  return <Loading query={q}>{(data) => (
    <div className="flex flex-col gap-3">
      <LinesTable columns={["Invoice", "Due", { label: "Gross", numeric: true }, { label: "Settled", numeric: true }, { label: "Credited", numeric: true }, { label: "Outstanding", numeric: true }]} empty={data.rows.length ? undefined : "No issued invoices yet."}>
        {data.rows.map((row) => <tr key={row.invoiceId}><Cell><Link className="text-brand hover:underline" href={row.href}>{row.number}</Link>{row.receipts.length > 0 && <span className="block text-xs text-text-muted">{row.receipts.map((r) => `${r.number} ${money(r.amount, currency)}`).join(" · ")}</span>}</Cell>
          <Cell>{dateLabel(row.due)}{row.overdue && <span className="block text-xs text-danger">{`${row.daysOverdue} days overdue`}</span>}</Cell><Cell numeric>{money(row.gross, currency)}</Cell><Cell numeric>{money(row.settled, currency)}</Cell>
          <Cell numeric>{money(row.credited, currency)}</Cell><Cell numeric>{money(row.outstanding, currency)}</Cell></tr>)}
      </LinesTable>
      {data.advances.length > 0 && <LinesTable columns={["Advance", "Order", "Received", "Status", { label: "Amount", numeric: true }]}>
        {data.advances.map((row) => <tr key={row.id}><Cell>{row.reference}</Cell><Cell>{row.order}</Cell><Cell>{row.date ? dateLabel(row.date) : "—"}</Cell><Cell>{row.status === "recorded" ? "Held — not yet applied" : row.status}</Cell><Cell numeric>{money(row.amount, currency)}</Cell></tr>)}
      </LinesTable>}
      <p className="text-xs text-text-muted">{"Collections include GST and follow Finance's receipt allocations; a receipt shared by several invoices counts only its part against this project's invoices."}</p>
    </div>
  )}</Loading>;
}
function RecognitionSection({ projectId, currency, summary }: { projectId: string; currency: string; summary: Summary }) {
  const q = useSection<{ available: boolean; rows: Array<{ entryId: string; entryNumber: string; date: string; period: string | null; account: string; source: string; amount: string; href: string }> }>(projectId, "recognition");
  const r = summary.recognized!;
  return <Loading query={q}>{(data) => (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-3 text-sm">
        <p><span className="text-text-muted">Deferred / unearned: </span>{r.deferred === null ? "Not configured" : money(r.deferred, currency)}</p>
        <p><span className="text-text-muted">Accrued / unbilled: </span>{r.accrued === null ? "Not configured" : money(r.accrued, currency)}</p>
        <p><span className="text-text-muted">Current period: </span>{r.currentPeriod ? `${r.currentPeriod.name} · ${money(r.currentPeriod.amount, currency)}` : "—"}</p>
      </div>
      {!data.available && <Notice tone="warning">{"Finance has not posted revenue for this project's issued invoices yet. Recognized revenue is unavailable, not zero."}</Notice>}
      <LinesTable columns={["Journal", "Date", "Period", "Source", "Account", { label: "This project", numeric: true }]} empty={data.rows.length ? undefined : "No revenue postings."}>
        {data.rows.map((row, i) => <tr key={`${row.entryId}:${i}`}><Cell><Link className="text-brand hover:underline" href={row.href}>{row.entryNumber}</Link></Cell><Cell>{dateLabel(row.date)}</Cell><Cell>{row.period ?? "—"}</Cell><Cell>{row.source}</Cell>
          <Cell>{row.account}</Cell><Cell numeric>{money(row.amount, currency)}</Cell></tr>)}
      </LinesTable>
      <p className="text-xs text-text-muted">{"Recognition is Finance's accounting event. Completing a task or milestone, approving time or receiving a payment never recognizes revenue here."}</p>
    </div>
  )}</Loading>;
}
function ExceptionsSection({ projectId }: { projectId: string }) {
  const q = useSection<{ rows: Array<{ kind: string; message: string }> }>(projectId, "exceptions");
  return <Loading query={q}>{(data) => (data.rows.length === 0 ? <p className="text-sm text-text-muted">Nothing needs reconciling.</p> : (
    <ul className="flex flex-col gap-1 rounded-lg border border-warning-emphasis/40 bg-warning-soft p-3 text-sm text-warning">{data.rows.map((row, i) => <li key={i}>{row.message}</li>)}</ul>
  ))}</Loading>;
}
function AllocateDialog({ title, description, onClose, onSave }: { title: string; description: string; onClose: () => void; onSave: (amount: string, reason: string, key: string) => Promise<void> }) {
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => { setBusy(true); setError(null); try { await onSave(amount, reason, key); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } };
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title={title} description={description}>
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="This project's amount (excl. GST)" inputMode="decimal" value={amount} onChange={setAmount} isRequired />
        <TextArea label="Why this share" value={reason} onChange={setReason} isRequired maxLength={1000} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !amount || reason.trim().length < 3} onPress={save}>Save allocation</Button></div>
      </div>
    </Dialog>
  );
}
function ForecastDialog({ projectId, current, onClose, onDone }: { projectId: string; current: Summary["forecast"]; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [expected, setExpected] = useState(current?.expectedFurther ?? "");
  const [assumptions, setAssumptions] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try { const r = await action<{ version: number }>(projectId, "forecast", { expectedFurtherRevenue: expected, assumptions, idempotencyKey: key }); await onDone(`Forecast v${r.version} saved.`); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Revenue forecast" description="Further revenue you expect beyond what is contracted — an estimate, kept as a new version and never mixed into the Sales figures.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <TextField label="Expected further revenue (excl. GST)" inputMode="decimal" value={expected} onChange={setExpected} isRequired />
        <TextArea label="Assumptions" value={assumptions} onChange={setAssumptions} isRequired maxLength={2000} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || expected === "" || assumptions.trim().length < 3} onPress={save}>Save forecast</Button></div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ reports (a set of Project Reports)
export const REVENUE_REPORT_TABS = [{ id: "rv-contract-value", label: "Contract value" }, { id: "rv-invoiced", label: "Invoiced revenue" }, { id: "rv-recognized", label: "Recognized revenue" },
  { id: "rv-unbilled-contract", label: "Unbilled contract value" }, { id: "rv-unbilled-time", label: "Approved unbilled time" }, { id: "rv-milestone-schedule", label: "Milestone billing schedule" },
  { id: "rv-collections", label: "Customer collections" }, { id: "rv-receivables", label: "Outstanding receivables" }, { id: "rv-overdue", label: "Overdue invoices" },
  { id: "rv-by-service-line", label: "By service line" }, { id: "rv-by-period", label: "By accounting period" }, { id: "rv-revenue-vs-cost", label: "Revenue vs cost" },
  { id: "rv-amendments", label: "Contract amendments" }, { id: "rv-credit-notes", label: "Credit note adjustments" }, { id: "rv-exceptions", label: "Reconciliation exceptions" }];
type Row = Record<string, unknown>;
const v = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));
const mo = (value: unknown) => (value === null || value === undefined ? "—" : money(String(value)));
const projectCell = (row: Row) => (row.projectId ? <Link className="text-brand underline" href={`/projects/${v(row.projectId)}?tab=financials`}>{v(row.project)}</Link> : <strong>{v(row.project)}</strong>);
export function RevenueReport({ kind, rows }: { kind: string; rows: Row[] }) {
  if (!rows.length) return null;
  const spec: Record<string, Array<[string, (row: Row) => React.ReactNode, boolean?]>> = {
    "rv-contract-value": [["Project", projectCell], ["Orders", (r) => v(r.orders)], ["Original", (r) => mo(r.original), true], ["Current", (r) => mo(r.current), true], ["Proposed", (r) => mo(r.proposed), true]],
    "rv-invoiced": [["Project", projectCell], ["Gross (incl. GST)", (r) => mo(r.gross), true], ["Invoiced lines", (r) => mo(r.lines), true], ["Credited", (r) => mo(r.credited), true], ["Net invoiced", (r) => mo(r.net), true], ["In drafts", (r) => mo(r.pending), true]],
    "rv-recognized": [["Project", projectCell], ["Recognized", (r) => (r.available ? mo(r.recognized) : "Not available"), true], ["Deferred", (r) => (r.deferred === null ? "Not configured" : mo(r.deferred)), true], ["Net invoiced", (r) => mo(r.netInvoiced), true]],
    "rv-unbilled-contract": [["Project", projectCell], ["Contract", (r) => mo(r.contract), true], ["Invoiced", (r) => mo(r.invoiced), true], ["Remaining", (r) => mo(r.remaining), true], ["T&M cap left", (r) => mo(r.timeCap), true]],
    "rv-unbilled-time": [["Project", projectCell], ["Service", (r) => v(r.line)], ["Rate", (r) => mo(r.rate), true], ["Unbilled hours", (r) => v(r.unbilledHours), true], ["Value", (r) => mo(r.value), true], ["Awaiting approval", (r) => v(r.pendingHours), true]],
    "rv-milestone-schedule": [["Project", projectCell], ["Milestone", (r) => v(r.milestone)], ["Due", (r) => v(r.due)], ["Stage", (r) => STAGE[String(r.state)]?.label ?? v(r.state)], ["Amount", (r) => mo(r.amount), true], ["Invoiced", (r) => mo(r.invoiced), true]],
    "rv-collections": [["Project", projectCell], ["Invoiced (gross)", (r) => mo(r.gross), true], ["Settled", (r) => mo(r.settled), true], ["Credited", (r) => mo(r.credited), true], ["Outstanding", (r) => mo(r.outstanding), true], ["Advances held", (r) => mo(r.advances), true]],
    "rv-receivables": [["Project", projectCell], ["Invoice", (r) => v(r.invoice)], ["Due", (r) => v(r.due)], ["Gross", (r) => mo(r.gross), true], ["Outstanding", (r) => mo(r.outstanding), true], ["Overdue", (r) => (r.overdue ? "Yes" : "—")]],
    "rv-overdue": [["Project", projectCell], ["Invoice", (r) => v(r.invoice)], ["Due", (r) => v(r.due)], ["Days overdue", (r) => v(r.daysOverdue), true], ["Outstanding", (r) => mo(r.outstanding), true]],
    "rv-by-service-line": [["Project", projectCell], ["Order", (r) => v(r.order)], ["Line", (r) => v(r.line)], ["Billing", (r) => v(r.model)], ["Contract", (r) => mo(r.contract), true], ["Invoiced", (r) => mo(r.invoiced), true], ["Remaining", (r) => mo(r.remaining), true]],
    "rv-by-period": [["Project", projectCell], ["Period", (r) => v(r.period)], ["Recognized", (r) => mo(r.amount), true]],
    "rv-revenue-vs-cost": [["Project", projectCell], ["Recognized", (r) => (r.recognized === null ? "Not available" : mo(r.recognized)), true], ["Net invoiced", (r) => mo(r.netInvoiced), true], ["Cost", (r) => mo(r.cost), true], ["Contribution", (r) => mo(r.contribution), true], ["Margin", (r) => (r.margin === null || r.margin === undefined ? "—" : `${v(r.margin)}%`), true]],
    "rv-amendments": [["Project", projectCell], ["Order", (r) => v(r.order)], ["Versions", (r) => `v${v(r.fromVersion)} → v${v(r.toVersion)}`], ["From", (r) => mo(r.from), true], ["To", (r) => mo(r.to), true], ["Reason", (r) => v(r.reason)]],
    "rv-credit-notes": [["Project", projectCell], ["Credit note", (r) => v(r.creditNote)], ["Invoice", (r) => v(r.invoice)], ["Status", (r) => v(r.status)], ["Amount", (r) => mo(r.amount), true], ["Reason", (r) => v(r.reason)]],
    "rv-exceptions": [["Project", projectCell], ["Kind", (r) => v(r.kind)], ["What needs attention", (r) => v(r.message)]],
  };
  const columns = spec[kind];
  if (!columns) return null;
  return (
    <LinesTable columns={columns.map(([label, , numeric]) => (numeric ? { label, numeric: true } : label))}>
      {rows.map((row, i) => <tr key={i}>{columns.map(([label, render, numeric]) => <Cell key={label} numeric={numeric}>{render(row)}</Cell>)}</tr>)}
    </LinesTable>
  );
}
