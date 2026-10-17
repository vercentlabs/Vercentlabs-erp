"use client";

// Projects — Invoice From Billable Time on screen: the project's billing from time (approved eligible, invoiced, reserved, in draft and
// available hours — quantities, never revenue), the Sales invoices made from its time, the exceptions that need a person, and the
// Generate Invoice From Time flow: choose approved time (whole entries or part), preview it with the Sales engine's figures, and create a
// Sales Invoice Draft that Sales reviews and issues. The invoice — its number, tax, terms and PDF — is always Sales'.
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { call, dateLabel, errorMessage, errorStatus, newKey, qs, send } from "../api/projects-api";
import { hours } from "../timesheets/timesheets-api";

type Entry = { entryId: string; entryNumber: string; workDate: string; employeeId: string; employee: string | null; task: string | null; description: string; contractLineId: string; contractLine: string;
  salesOrder: string; rate: string; currency: string; approvedMinutes: number; invoicedMinutes: number; reservedMinutes: number; availableMinutes: number };
type Eligible = { entries: Entry[]; contractLines: Array<{ contractLineId: string; label: string; salesOrder: string; rate: string; currency: string; availableMinutes: number }>;
  totals: { approvedMinutes: number; invoicedMinutes: number; reservedMinutes: number; availableMinutes: number } };
type Preview = { salesOrder: string; invoiceDate: string; currency: string; lines: Array<{ label: string; description: string; minutes: number; hours: string; rate: string; taxable: string; tax: string;
  taxes: Array<{ label: string; rate: string; amount: string }> }>; totals: { minutes: number; taxable: string; tax: string; total: string }; note: string };
type Summary = {
  measure: string; totals: { approvedEligibleMinutes: number; invoicedMinutes: number; reservedMinutes: number; inDraftMinutes: number; availableMinutes: number; coverage: number | null };
  invoices: Array<{ id: string; number: string; status: string; draft: boolean; date: string | null; minutes: number; requests: string; currency: string; total?: string; outstanding?: string | null; href: string }>;
  exceptions: number; can: { request: boolean; authorize: boolean; draft: boolean; salesDraft: boolean };
};
type Exception = { kind: string; requestId?: string; documentId?: string; label: string; message: string };

const getSummary = (projectId: string) => call<{ summary: Summary }>(`/${projectId}/time-invoices`).then((r) => r.summary);
const getEligible = (projectId: string, filters: Record<string, string | undefined>) => call<Eligible>(`/${projectId}/time-invoices/eligible${qs(filters)}`);
const preview = (projectId: string, input: Record<string, unknown>) => send<Preview>(`/${projectId}/time-invoices/preview`, input);
const create = (projectId: string, input: Record<string, unknown>) => send<{ invoiceId: string; invoiceNumber: string; minutes: number; replayed?: boolean }>(`/${projectId}/time-invoices/create`, input);
const getExceptions = (projectId: string) => call<{ rows: Exception[] }>(`/time-invoices/exceptions${qs({ projectId })}`).then((r) => r.rows);
const reconcile = (projectId: string) => send<{ invoiced: number; released: number }>("/time-invoices/reconcile", { projectId });
const dispose = (input: Record<string, unknown>) => send("/time-invoices/disposition", input);
export const draftFromRequests = (requestIds: string[], idempotencyKey: string) => send<{ invoiceId: string; invoiceNumber: string }>("/time-invoices/draft", { requestIds, idempotencyKey });
export const getTimeInvoiceReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/reports/time-invoices${qs({ kind })}`).then((r) => r.rows);
const money = (value: string | number | null | undefined, currency: string) => (value === null || value === undefined ? "—" : `${currency === "INR" ? "₹" : `${currency} `}${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = { draft: "neutral", pending_approval: "info", approved: "info", posted: "success", partially_paid: "success", paid: "success",
  overdue: "warning", cancelled: "neutral", reversed: "danger" };

function Figure({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className="flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-surface px-3 py-2.5"><span className="text-xs font-medium text-text-muted">{label}</span>
    <span className="text-lg font-semibold tabular-nums">{value}</span>{note && <span className="text-xs text-text-muted">{note}</span>}</div>;
}

export function TimeInvoicingPanel({ projectId }: { projectId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-invoices", projectId), queryFn: () => getSummary(projectId), retry: false });
  const exceptions = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-invoice-exceptions", projectId), queryFn: () => getExceptions(projectId), retry: false, enabled: summary.isSuccess });
  const [dialog, setDialog] = useState<"generate" | Exception | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (summary.isLoading) return <LoadingState label="Loading billing from time" rows={3} />;
  if (summary.isError) return errorStatus(summary.error) === 403 ? null : <Notice tone="danger">{errorMessage(summary.error)}</Notice>;
  const s = summary.data!;
  const t = s.totals;
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") });
  const check = async () => {
    try { const done = await reconcile(projectId); await refresh(); setMessage({ tone: "success", text: `Checked with Sales: ${done.invoiced} request(s) invoiced, ${done.released} released.` }); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };
  return (
    <Panel title="Billing from time" description={`Approved, separately chargeable hours and the Sales invoices made from them. ${s.measure}`}
      actions={<span className="flex flex-wrap gap-2">
        {s.can.draft && t.availableMinutes > 0 && <Button size="compact" variant="primary" onPress={() => setDialog("generate")}>Generate invoice from time</Button>}
        <Button size="compact" variant="ghost" onPress={check}>Check Sales</Button>
      </span>}>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-5">
        <Figure label="Approved eligible" value={hours(t.approvedEligibleMinutes)} />
        <Figure label="Invoiced" value={hours(t.invoicedMinutes)} note={t.coverage === null ? undefined : `${t.coverage}% billing coverage (hours)`} />
        <Figure label="In Sales drafts" value={hours(t.inDraftMinutes)} />
        <Figure label="Reserved, not drafted" value={hours(t.reservedMinutes)} />
        <Figure label="Available to invoice" value={hours(t.availableMinutes)} />
      </div>
      {(exceptions.data ?? []).length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-warning-emphasis/40 bg-warning-soft p-3">
          <p className="text-sm font-medium text-warning">{`${exceptions.data!.length} billing exception(s) need a decision`}</p>
          <ul className="flex flex-col gap-1.5 text-sm">{exceptions.data!.map((row, index) => (
            <li key={index} className="flex flex-wrap items-center justify-between gap-2"><span><span className="font-medium">{row.label}</span> — {row.message}</span>
              {row.documentId && s.can.authorize && <Button size="compact" variant="secondary" onPress={() => setDialog(row)}>Decide</Button>}
              {row.kind === "DRAFT_OUTCOME" && <Button size="compact" variant="secondary" onPress={check}>Reconcile</Button>}</li>
          ))}</ul>
        </div>
      )}
      {s.invoices.length === 0 ? <p className="text-sm text-text-muted">No invoice has been made from this project&apos;s time yet.</p> : (
        <LinesTable columns={["Invoice", "Status", "Date", { label: "Hours", numeric: true }, "Requests", ...(s.invoices[0]?.total !== undefined ? [{ label: "Total", numeric: true }, { label: "Outstanding", numeric: true }] : [])]}>
          {s.invoices.map((row) => (
            <tr key={row.id}><Cell><Link className="text-brand underline" href={row.href}>{row.number}</Link></Cell><Cell><StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"}>{row.status.replace(/_/g, " ")}</StatusBadge></Cell>
              <Cell>{dateLabel(row.date)}</Cell><Cell numeric>{hours(row.minutes)}</Cell><Cell>{row.requests}</Cell>
              {row.total !== undefined && <><Cell numeric>{money(row.total, row.currency)}</Cell><Cell numeric>{row.outstanding ? money(row.outstanding, row.currency) : "—"}</Cell></>}</tr>
          ))}
        </LinesTable>
      )}
      {dialog === "generate" && <GenerateDialog projectId={projectId} onClose={() => setDialog(null)} onDone={async (text) => { setDialog(null); await refresh(); setMessage({ tone: "success", text }); }} />}
      {dialog && dialog !== "generate" && <DispositionDialog exception={dialog} onClose={() => setDialog(null)} onDone={async (text) => { setDialog(null); await refresh(); setMessage({ tone: "success", text }); }} />}
    </Panel>
  );
}

function GenerateDialog({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [line, setLine] = useState("");
  const eligible = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-invoice-eligible", projectId, from, to, line), queryFn: () => getEligible(projectId, { from: from || undefined, to: to || undefined, contractLineId: line || undefined }) });
  const [picked, setPicked] = useState<Record<string, string>>({});
  const [plan, setPlan] = useState<Preview | null>(null);
  const [note, setNote] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = eligible.data?.entries ?? [];
  const chosen = Object.entries(picked).map(([entryId, h]) => ({ entryId, minutes: Math.round(Number(h) * 60) }));
  const toggle = (entry: Entry, on: boolean) => { setPlan(null); setPicked((current) => { const next = { ...current }; if (on) next[entry.entryId] = (entry.availableMinutes / 60).toFixed(2); else delete next[entry.entryId]; return next; }); };
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(null); try { await work(); } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); } };
  const doPreview = () => run(async () => setPlan(await preview(projectId, { entries: chosen, billingPeriodStart: from || undefined, billingPeriodEnd: to || undefined })));
  const doCreate = () => run(async () => {
    const made = await create(projectId, { entries: chosen, billingPeriodStart: from || undefined, billingPeriodEnd: to || undefined, note: note || undefined, idempotencyKey: key });
    await onDone(`${made.invoiceNumber} created as a Sales Invoice Draft for ${hours(made.minutes)}. Sales reviews and issues it.`);
  });
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Generate invoice from time" size="lg"
      description="Choose approved, billable time — a whole entry or part of it. The preview uses the contract rate and the Sales tax engine; the draft is created in Sales.">
      <div className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Work from" type="date" value={from} onChange={(next) => { setFrom(next); setPlan(null); }} />
          <TextField label="Work to" type="date" value={to} onChange={(next) => { setTo(next); setPlan(null); }} />
          <Select label="Service" selectedKey={line || ""} onSelectionChange={(next) => { setLine(String(next ?? "")); setPlan(null); }}
            options={[{ value: "", label: "All services" }, ...(eligible.data?.contractLines ?? []).map((row) => ({ value: row.contractLineId, label: `${row.label} · ${row.salesOrder}` }))]} />
        </div>
        {eligible.isLoading ? <LoadingState label="Loading approved time" rows={3} /> : rows.length === 0 ? <p className="text-sm text-text-muted">No approved billable time is available for this selection.</p> : (
          <div className="max-h-80 overflow-auto">
            <LinesTable columns={["", "Entry", "Date", "Employee", "Service", { label: "Available", numeric: true }, { label: "Bill (h)", numeric: true }]}>
              {rows.map((row) => (
                <tr key={row.entryId}>
                  <Cell><Checkbox aria-label={row.entryNumber} isSelected={row.entryId in picked} onChange={(on) => toggle(row, on)} /></Cell>
                  <Cell>{row.entryNumber}<span className="block max-w-56 truncate text-xs text-text-muted">{row.task ?? row.description}</span></Cell><Cell>{dateLabel(row.workDate)}</Cell><Cell>{row.employee ?? "—"}</Cell>
                  <Cell>{row.contractLine}</Cell><Cell numeric>{hours(row.availableMinutes)}</Cell>
                  <Cell numeric>{row.entryId in picked ? <input aria-label={`Hours of ${row.entryNumber}`} inputMode="decimal" className="w-20 rounded border border-border bg-surface px-2 py-1 text-right text-sm"
                    value={picked[row.entryId]} onChange={(event) => { setPlan(null); setPicked((current) => ({ ...current, [row.entryId]: event.target.value })); }} /> : "—"}</Cell>
                </tr>
              ))}
            </LinesTable>
          </div>
        )}
        {error && <Notice tone="danger">{error}</Notice>}
        {plan && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <p className="text-sm font-medium">{`Invoice preview · ${plan.salesOrder} · ${dateLabel(plan.invoiceDate)}`}</p>
            <LinesTable columns={["Line", { label: "Taxable", numeric: true }, { label: "Tax", numeric: true }]}>
              {plan.lines.map((row) => <tr key={row.label}><Cell>{row.description}{row.taxes.length > 0 && <span className="block text-xs text-text-muted">{row.taxes.map((tax) => `${tax.label} ${tax.rate}%`).join(" + ")}</span>}</Cell>
                <Cell numeric>{money(row.taxable, plan.currency)}</Cell><Cell numeric>{money(row.tax, plan.currency)}</Cell></tr>)}
              <tr><Cell><span className="font-semibold">{`Total for ${hours(plan.totals.minutes)}`}</span></Cell><Cell numeric>{money(plan.totals.taxable, plan.currency)}</Cell><Cell numeric><span className="font-semibold">{money(plan.totals.total, plan.currency)}</span></Cell></tr>
            </LinesTable>
            <p className="text-xs text-text-muted">{plan.note}</p>
            <TextArea label="Note for Sales (optional)" value={note} onChange={setNote} maxLength={1000} />
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onPress={onClose}>Cancel</Button>
          {!plan ? <Button variant="primary" isLoading={busy} isDisabled={busy || !chosen.length} onPress={doPreview}>Preview</Button>
            : <Button variant="primary" isLoading={busy} isDisabled={busy} onPress={doCreate}>Create Sales Invoice Draft</Button>}
        </div>
      </div>
    </Dialog>
  );
}

function DispositionDialog({ exception, onClose, onDone }: { exception: Exception; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [disposition, setDisposition] = useState("");
  const [hoursText, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true); setError(null);
    try {
      await dispose({ requestId: exception.requestId, documentId: exception.documentId, disposition, reason, minutes: hoursText ? Math.round(Number(hoursText) * 60) : undefined });
      await onDone(disposition === "REBILLABLE" ? "The hours are available to invoice again." : "The hours stay invoiced; the decision is recorded.");
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Decide the billed time" description={`${exception.label}: ${exception.message}`}>
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <Select label="May these hours be billed again?" selectedKey={disposition || null} onSelectionChange={(next) => setDisposition(String(next ?? ""))}
          options={[{ value: "REBILLABLE", label: "Yes — the billing was wrong; return them to unbilled time" }, { value: "NOT_REBILLABLE", label: "No — a concession or tax correction; they stay invoiced" }]} />
        {exception.kind === "CREDIT_NOTE" && <TextField label="Hours this covers (all if empty)" inputMode="decimal" value={hoursText} onChange={setHours} />}
        <TextArea label="Why" value={reason} onChange={setReason} isRequired maxLength={500} />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button><Button variant="primary" isLoading={busy} isDisabled={busy || !disposition || reason.trim().length < 3} onPress={save}>Record decision</Button></div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ reports (a set of Project Reports)
export const TIME_INVOICE_REPORT_TABS = [{ id: "ti-unbilled", label: "Approved unbilled time" }, { id: "ti-reserved", label: "Reserved time" }, { id: "ti-invoiced-by-project", label: "Invoiced by project" },
  { id: "ti-by-customer", label: "By customer" }, { id: "ti-by-service", label: "By service" }, { id: "ti-by-period", label: "By billing period" }, { id: "ti-partially-invoiced", label: "Partially invoiced entries" },
  { id: "ti-drafts", label: "Draft time invoices" }, { id: "ti-contract-allowance", label: "Contract allowance" }, { id: "ti-rate-history", label: "Rate history" }, { id: "ti-adjustments", label: "Adjustments" },
  { id: "ti-duplicate-exceptions", label: "Duplicate billing" }, { id: "ti-reconciliation", label: "Reconciliation" }, { id: "ti-traceability", label: "Traceability" }];
type Row = Record<string, unknown>;
const v = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));
const h = (value: unknown) => (value === null || value === undefined ? "—" : hours(Number(value)));
export function TimeInvoiceReport({ kind, rows }: { kind: string; rows: Row[] }) {
  if (!rows.length) return null;
  const columns: Record<string, Array<[string, (row: Row) => string, boolean?]>> = {
    "ti-unbilled": [["Entry", (r) => `TE-${v(r.entry_number)}`], ["Project", (r) => v(r.project_code)], ["Date", (r) => v(r.work_date)], ["Approved", (r) => h(r.duration_minutes), true], ["Invoiced", (r) => h(r.invoiced), true], ["Reserved", (r) => h(r.reserved), true], ["Available", (r) => h(r.available), true]],
    "ti-reserved": [["Request", (r) => v(r.request)], ["Project", (r) => v(r.project_code)], ["Status", (r) => v(r.status)], ["Hours", (r) => h(r.minutes), true], ["Draft", (r) => v(r.draft)]],
    "ti-invoiced-by-project": [["Project", (r) => `${v(r.project_code)} ${v(r.name)}`], ["Invoiced", (r) => h(r.minutes), true]],
    "ti-by-customer": [["Customer", (r) => v(r.customer)], ["Invoiced", (r) => h(r.minutes), true], ["Invoices", (r) => v(r.invoices), true]],
    "ti-by-service": [["Service", (r) => v(r.service)], ["Rate", (r) => `${v(r.rate)} ${v(r.currency)}`], ["Invoiced", (r) => h(r.minutes), true]],
    "ti-by-period": [["Month", (r) => v(r.period)], ["Invoiced", (r) => h(r.invoiced), true], ["Reserved", (r) => h(r.reserved), true]],
    "ti-drafts": [["Invoice", (r) => v(r.invoice_number)], ["Date", (r) => v(r.invoice_date)], ["Project", (r) => v(r.project_code)], ["Hours", (r) => h(r.minutes), true]],
    "ti-contract-allowance": [["Contract line", (r) => v(r.label)], ["Project", (r) => v(r.project_code)], ["Allowance", (r) => h(r.max_minutes), true], ["Used", (r) => h(r.used), true], ["Status", (r) => v(r.status)]],
    "ti-rate-history": [["Contract line", (r) => v(r.label)], ["Project", (r) => v(r.project_code)], ["Rate", (r) => `${v(r.hourly_rate)} ${v(r.currency)}`], ["From", (r) => v(r.effective_from)], ["To", (r) => v(r.effective_to)], ["Status", (r) => v(r.status)]],
    "ti-adjustments": [["Request", (r) => v(r.request)], ["Project", (r) => v(r.project_code)], ["Document", (r) => `${v(r.document_kind)} ${v(r.document_number)}`], ["Hours", (r) => h(r.minutes), true], ["Decision", (r) => v(r.disposition)], ["Why", (r) => v(r.reason)]],
    "ti-duplicate-exceptions": [["Entry", (r) => `TE-${v(r.entry_number)}`], ["Project", (r) => v(r.project_code)], ["Approved", (r) => h(r.duration_minutes), true], ["Claimed", (r) => h(r.claimed), true]],
    "ti-reconciliation": [["Item", (r) => v(r.label)], ["Kind", (r) => v(r.kind)], ["What needs attention", (r) => v(r.message)]],
    "ti-traceability": [["Request", (r) => v(r.request)], ["Project", (r) => v(r.project_code)], ["Status", (r) => v(r.status)], ["Invoice", (r) => `${v(r.invoice_number)} (${v(r.invoice_status)})`], ["Service", (r) => v(r.service)], ["Time entries", (r) => v(r.sources)]],
  };
  const spec = columns[kind];
  if (!spec) return null;
  return (
    <LinesTable columns={spec.map(([label, , numeric]) => (numeric ? { label, numeric: true } : label))}>
      {rows.map((row, index) => <tr key={index}>{spec.map(([label, render, numeric]) => <Cell key={label} numeric={numeric}>{render(row)}</Cell>)}</tr>)}
    </LinesTable>
  );
}
