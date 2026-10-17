"use client";

// Projects — time billing for project managers, Sales and Finance: a project's Financials (labor cost beside billable and invoiced value,
// its approved unbilled time and its billing history), Billable Hours across projects (ready to bill, requests, exceptions) and one billing
// request (its reserved minutes, the handoff to Sales, the invoice it was billed on, credits and cancellations).
import { useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, ComboBox, Dialog, EmptyState, ErrorState, MetricStrip, PageHeader, PermissionState, StatusBadge, Tab, TabList, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { useSubmitKey } from "@/shared/http/submit-once";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, newKey, type Project } from "../api/projects-api";
import { hours } from "../timesheets/timesheets-api";
import {
  BILLING_BASE, REQUEST_TONE, createRequest, getExceptions, getInvoiceCandidates, getRequest, getUnbilled, listRequests, requestAction, runBillingCommand, type UnbilledRow,
} from "./billable-api";
import { TimeInvoicingPanel, draftFromRequests } from "../time-invoicing/TimeInvoicing";

const STATE_LABEL = { UNBILLED: "Unbilled", PARTIALLY_ALLOCATED: "Partly reserved or invoiced", ALLOCATED: "Fully reserved", INVOICED: "Invoiced" } as const;

// Unbilled time, grouped by contract line, with the request that reserves it (one request per line).
function UnbilledTable({ rows, canRequest, onRequested }: { rows: UnbilledRow[]; canRequest: boolean; onRequested: (text: string) => Promise<void> }) {
  const [line, setLine] = useState<string | null>(null);
  if (!rows.length) return <p className="text-sm text-text-muted">No approved, eligible time is waiting to be billed.</p>;
  const lines = [...new Map(rows.map((row) => [row.contractLineId, row])).values()];
  return (
    <div className="flex flex-col gap-3">
      {lines.map((group) => (
        <div key={group.contractLineId} className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-medium">{`${group.project} · ${group.contractLine} (${group.rate} ${group.currency}/h)`}</span>
            {canRequest && <Button size="compact" variant="secondary" onPress={() => setLine(group.contractLineId)}>Request billing</Button>}
          </div>
          <LinesTable columns={["Entry", "Employee", "Date", "Work", { label: "Approved", numeric: true }, { label: "Invoiced", numeric: true }, { label: "Reserved", numeric: true }, { label: "Free", numeric: true }, "State"]}>
            {rows.filter((row) => row.contractLineId === group.contractLineId).map((row) => (
              <tr key={row.entryId}><Cell>{row.entryNumber}</Cell><Cell>{row.employee ?? "—"}</Cell><Cell>{row.workDate}</Cell><Cell><span className="line-clamp-1">{row.description}</span></Cell>
                <Cell numeric>{hours(row.approvedMinutes)}</Cell><Cell numeric>{hours(row.invoicedMinutes)}</Cell><Cell numeric>{hours(row.reservedMinutes)}</Cell><Cell numeric>{hours(row.freeMinutes)}</Cell>
                <Cell>{STATE_LABEL[row.state]}</Cell></tr>
            ))}
          </LinesTable>
        </div>
      ))}
      {line && <RequestDialog rows={rows.filter((row) => row.contractLineId === line && row.freeMinutes > 0)} onClose={() => setLine(null)} onDone={onRequested} />}
    </div>
  );
}

function RequestDialog({ rows, onClose, onDone }: { rows: UnbilledRow[]; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [minutes, setMinutes] = useState<Record<string, string>>(Object.fromEntries(rows.map((row) => [row.entryId, String(row.freeMinutes / 60)])));
  const [chosen, setChosen] = useState<string[]>(rows.map((row) => row.entryId));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  const { run } = useSubmitKey();
  const total = rows.filter((row) => chosen.includes(row.entryId)).reduce((sum, row) => sum + Math.round(Number(minutes[row.entryId] || 0) * 60), 0);
  const step = rows[0]?.roundingMinutes ?? 1;
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`Reserve ${hours(total)} for billing`}
      description={`The minutes are reserved for Sales and cannot be claimed again until the request is cancelled. ${step > 1 ? `This line bills in ${step}-minute steps.` : ""} No invoice or ledger entry is created.`}>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <div key={row.entryId} className="flex items-center gap-2">
            <Checkbox isSelected={chosen.includes(row.entryId)} onChange={(on) => setChosen(on ? [...chosen, row.entryId] : chosen.filter((id) => id !== row.entryId))}>
              {`${row.entryNumber} · ${row.workDate} · ${row.employee ?? ""}`}
            </Checkbox>
            <TextField aria-label={`Hours of ${row.entryNumber}`} size="compact" className="w-24" inputMode="decimal" value={minutes[row.entryId]} onChange={(value) => setMinutes({ ...minutes, [row.entryId]: value })}
              suffix="h" />
            <span className="text-xs text-text-muted">{`of ${hours(row.freeMinutes)} free`}</span>
          </div>
        ))}
        <TextArea label="Note for Sales (optional)" value={note} onChange={setNote} />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant="primary" isLoading={busy} isDisabled={busy || !chosen.length || total <= 0} onPress={async () => {
            setBusy(true); setError(null);
            try {
              await runBillingCommand(key, () => run(() => createRequest({ projectId: rows[0].projectId, contractLineId: rows[0].contractLineId, note: note || undefined, idempotencyKey: key,
                entries: rows.filter((row) => chosen.includes(row.entryId)).map((row) => ({ entryId: row.entryId, minutes: Math.round(Number(minutes[row.entryId] || 0) * 60) })) })));
              await onDone(`${hours(total)} reserved in a billing request. Someone who authorizes billing sends it to Sales.`);
              onClose();
            } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
          }}>Create request</Button>
        </div>
      </div>
    </Dialog>
  );
}

function RequestsTable({ rows }: { rows: Awaited<ReturnType<typeof listRequests>>["rows"] }) {
  return (
    <LinesTable empty="No billing requests yet." columns={["Request", "Project", "Line", { label: "Hours", numeric: true }, { label: "Estimated", numeric: true }, "Invoice", "Status", "Created"]}>
      {rows.map((row) => (
        <tr key={row.id}><Cell><Link className="text-brand underline" href={`${BILLING_BASE}/${row.id}`}>{row.number}</Link></Cell><Cell>{row.project}</Cell><Cell>{row.contractLine ?? "—"}</Cell>
          <Cell numeric>{`${row.total}${row.creditedMinutes ? ` (−${hours(row.creditedMinutes)})` : ""}`}</Cell><Cell numeric>{row.estimatedAmount ? `${row.estimatedAmount} ${row.currency ?? ""}` : "—"}</Cell>
          <Cell>{row.invoiceNumber ? `${row.invoiceNumber}${row.invoicedAmount ? ` · ${row.invoicedAmount}` : ""}` : "—"}</Cell>
          <Cell><StatusBadge tone={REQUEST_TONE[row.status]}>{row.statusLabel}</StatusBadge></Cell><Cell>{`${formatDateTime(row.createdAt)}${row.createdBy ? ` · ${row.createdBy}` : ""}`}</Cell></tr>
      ))}
    </LinesTable>
  );
}

// ------------------------------------------------------------------ a project's Financials
// The project's billing: invoices from approved time, the approved unbilled time by contract line, and the billing history. Cost, revenue and
// profitability have their own Financials sections.
export function ProjectBillingSection({ project }: { project: Project }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const unbilled = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-unbilled", project.id), queryFn: () => getUnbilled({ projectId: project.id, all: true }), retry: false });
  const requests = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-billing-requests", project.id), queryFn: () => listRequests({ projectId: project.id }), retry: false });
  const [message, setMessage] = useState<string | null>(null);
  const done = async (text: string) => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage(text); };
  return (
    <div className="flex flex-col gap-4">
      {message && <Notice tone="success">{message}</Notice>}
      <TimeInvoicingPanel projectId={project.id} />
      {unbilled.data && (
        <Panel title="Unbilled time" description="Approved time eligible for hourly billing, by contract line. Reserved minutes cannot be requested again.">
          <UnbilledTable rows={unbilled.data.rows} canRequest={Boolean(requests.data)} onRequested={done} />
        </Panel>
      )}
      {requests.data && <Panel title="Billing history"><RequestsTable rows={requests.data.rows} /></Panel>}
      {unbilled.isError && requests.isError && errorStatus(unbilled.error) === 403 && <PermissionState title="Billing is restricted" description="Billing needs the billing visibility permission." />}
    </div>
  );
}

// ------------------------------------------------------------------ Billable Hours
export function BillableHoursScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("ready");
  const [message, setMessage] = useState<string | null>(null);
  const unbilled = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-unbilled", "all"), queryFn: () => getUnbilled(), retry: false, enabled: tab === "ready" });
  const requests = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-billing-requests", "all"), queryFn: () => listRequests(), retry: false, enabled: tab === "requests" });
  const exceptions = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-billing-exceptions"), queryFn: getExceptions, retry: false, enabled: tab === "exceptions" });
  const failed = [unbilled, requests, exceptions].find((query) => query.isError);
  if (failed && errorStatus(failed.error) === 403) return <PermissionState title="Billable hours are restricted" description="Billing visibility is needed to see billable time." />;
  const done = async (text: string) => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage(text); };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Billable Hours" description="Approved time eligible for hourly billing, the requests that hand it to Sales, and what needs attention. Requests create no invoice or ledger entry." />
      {message && <Notice tone="success">{message}</Notice>}
      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(String(key))}>
        <TabList aria-label="Billable hours"><Tab id="ready">Ready to bill</Tab><Tab id="requests">Billing requests</Tab><Tab id="exceptions">Exceptions</Tab></TabList>
      </Tabs>
      {tab === "ready" && (unbilled.isLoading ? <LoadingState label="Loading unbilled time" rows={6} /> : unbilled.data && (
        <Panel description={`${hours(unbilled.data.totalFreeMinutes)} free to request.`}><UnbilledTable rows={unbilled.data.rows} canRequest onRequested={done} /></Panel>))}
      {tab === "requests" && (requests.isLoading ? <LoadingState label="Loading requests" rows={6} /> : requests.data && <Panel><RequestsTable rows={requests.data.rows} /></Panel>)}
      {tab === "exceptions" && (exceptions.isLoading ? <LoadingState label="Loading exceptions" rows={4} /> : exceptions.data && (exceptions.data.length === 0
        ? <EmptyState title="Nothing needs attention." description="Requests waiting on Sales, cancelled invoices and time without a contract line appear here." /> : (
        <Panel>
          <LinesTable columns={["What", "Where", "Detail"]}>
            {exceptions.data.map((row, index) => (
              <tr key={index}><Cell>{row.label}</Cell>
                <Cell>{row.request ? <Link className="text-brand underline" href={`${BILLING_BASE}/${row.request.id}`}>{`${row.request.number} · ${row.request.project ?? ""}`}</Link> : `${row.project ?? ""}${row.contractLine ? ` · ${row.contractLine}` : ""}`}</Cell>
                <Cell>{row.message}</Cell></tr>
            ))}
          </LinesTable>
        </Panel>)))}
    </div>
  );
}

// ------------------------------------------------------------------ one request
export function BillingRequestScreen({ requestId }: { requestId: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-billing-request", requestId), queryFn: () => getRequest(requestId), retry: false });
  const [dialog, setDialog] = useState<"submit" | "cancel" | "confirm" | "reconcile" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (query.isLoading) return <LoadingState label="Loading the billing request" rows={6} />;
  if (query.isError || !query.data) return <ErrorState title="This billing request could not be opened" description={errorStatus(query.error) === 404 ? "It does not exist, or you may not see it." : errorMessage(query.error)} />;
  const r = query.data;
  const done = async (text: string) => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage(text); };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${r.number} · ${r.project ?? ""}`} description={`${r.contractLine ?? ""} · prepared ${formatDateTime(r.createdAt)}${r.createdBy ? ` by ${r.createdBy}` : ""}`}
        breadcrumbs={<Link className="text-sm text-brand underline" href="/projects/timesheets/billable">Billable Hours</Link>}
        primaryAction={r.can.submit ? <Button variant="primary" onPress={() => setDialog("submit")}>Send to Sales</Button> : r.can.confirm ? <Button variant="primary" onPress={() => setDialog("confirm")}>Link invoice</Button> : undefined}
        secondaryActions={<>
          {r.can.reconcile && <Button variant="secondary" onPress={() => setDialog("reconcile")}>Reconcile credit or cancellation</Button>}
          {r.status === "SUBMITTED" && <Button variant="secondary" onPress={async () => {
            try { const made = await draftFromRequests([r.id], newKey()); await done(`${made.invoiceNumber} created as a Sales Invoice Draft.`); } catch (failure) { setMessage(errorMessage(failure)); }
          }}>Create Sales invoice draft</Button>}
          {r.can.cancel && <Button variant="ghost" onPress={() => setDialog("cancel")}>Cancel request</Button>}
        </>} />
      {message && <Notice tone="success">{message}</Notice>}
      <div className="flex flex-wrap gap-2"><StatusBadge tone={REQUEST_TONE[r.status]}>{r.statusLabel}</StatusBadge>{r.invoiceNumber && <StatusBadge tone="success">{`Invoice ${r.invoiceNumber}`}</StatusBadge>}</div>
      <MetricStrip metrics={[{ label: "Hours", value: r.total }, { label: "Credited", value: hours(r.creditedMinutes) }, { label: "Agreed rate", value: r.hourlyRate ? `${r.hourlyRate} ${r.currency ?? ""}/h` : "—" },
        { label: r.invoicedAmount ? "Invoiced (Sales)" : "Estimated value", value: r.invoicedAmount ?? r.estimatedAmount ?? "—" }]} />
      {r.cancelReason && <Notice tone="neutral">{`Cancelled: ${r.cancelReason}`}</Notice>}
      <Panel title="Time in this request" description="Each allocation names the approved time it bills; reversed lines keep their reason and reference.">
        <LinesTable columns={["Entry", "Employee", "Date", { label: "Minutes", numeric: true }, "Status", "Reversal"]}>
          {r.allocations.map((row) => (
            <tr key={row.id}><Cell>{row.entryNumber}</Cell><Cell>{row.employee ?? "—"}</Cell><Cell>{row.workDate}</Cell><Cell numeric>{hours(row.minutes)}</Cell><Cell>{row.status.toLowerCase()}</Cell>
              <Cell>{row.reversalKind ? `${row.reversalKind.toLowerCase().replace(/_/g, " ")}: ${row.reversalReason ?? ""}${row.reversalReference ? ` (${row.reversalReference})` : ""}` : "—"}</Cell></tr>
          ))}
        </LinesTable>
      </Panel>
      {dialog && <RequestActionDialog requestId={r.id} version={r.version} action={dialog} onClose={() => setDialog(null)} onDone={done} />}
    </div>
  );
}

const ACTION_TEXT = {
  submit: ["Send to Sales", "Sales applies the agreed rate and tax and prepares the invoice. The minutes stay reserved until it is linked or the request is cancelled."],
  cancel: ["Cancel the request", "Its minutes are released and can be requested again. Cancel a request with Sales only when no invoice was raised for it."],
  confirm: ["Link the invoice", "Choose the confirmed invoice line that bills exactly these hours. The invoice itself is Sales's; nothing is posted here."],
  reconcile: ["Reconcile with Sales", "After the invoice was cancelled or reversed, or a credit note was issued against it, decide whether its minutes may be billed again. A credit never frees them by itself."],
} as const;
function RequestActionDialog({ requestId, version, action, onClose, onDone }: { requestId: string; version: number; action: keyof typeof ACTION_TEXT; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const workspace = useWorkspaceContext();
  const candidates = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-billing-candidates", requestId), queryFn: () => getInvoiceCandidates(requestId), enabled: action === "confirm" || action === "reconcile" });
  const [reason, setReason] = useState("");
  const [line, setLine] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [part, setPart] = useState("");
  const [disposition, setDisposition] = useState<"REBILLABLE" | "NOT_REBILLABLE" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  const needsReason = action === "cancel" || action === "reconcile";
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await runBillingCommand(key, () => requestAction(requestId, action, { expectedVersion: action === "reconcile" ? undefined : version, reason: reason || undefined, customerInvoiceLineId: line ?? undefined,
        creditNoteId: note ?? undefined, minutes: part ? Math.round(Number(part) * 60) : undefined, disposition: disposition ?? undefined }));
      await onDone({ submit: "Sent to Sales.", cancel: "Cancelled; the minutes are released.", confirm: "Invoice linked: the time is invoiced.", reconcile: "Reconciled with Sales." }[action]);
      onClose();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={ACTION_TEXT[action][0]} description={ACTION_TEXT[action][1]}>
      <div className="flex flex-col gap-3">
        {action === "confirm" && <ComboBox label="Invoice line" placeholder="Choose the invoice line" selectedKey={line} onSelectionChange={(k) => setLine(k ? String(k) : null)} isLoading={candidates.isLoading}
          emptyMessage="No confirmed invoice line of this customer bills these hours yet." options={(candidates.data?.invoiceLines ?? []).map((row) => ({ value: row.id, label: row.label }))} />}
        {action === "reconcile" && <>
          <ComboBox label="Credit note (leave empty when the invoice was cancelled)" placeholder="Choose a credit note" selectedKey={note} onSelectionChange={(k) => setNote(k ? String(k) : null)}
            options={(candidates.data?.creditNotes ?? []).map((row) => ({ value: row.id, label: row.label }))} emptyMessage="No credit note against this invoice." />
          {note && <TextField label="Hours credited (all if empty)" inputMode="decimal" value={part} onChange={setPart} />}
          <ComboBox label="May these hours be billed again?" placeholder="Choose" selectedKey={disposition} onSelectionChange={(k) => setDisposition(k ? (String(k) as "REBILLABLE" | "NOT_REBILLABLE") : null)}
            options={[{ value: "REBILLABLE", label: "Yes — the billing was wrong; they return to unbilled time" }, { value: "NOT_REBILLABLE", label: "No — a price concession; they stay invoiced" }]} />
        </>}
        {needsReason && <TextArea label="Why" value={reason} onChange={setReason} isRequired />}
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Close</Button>
          <Button variant={action === "cancel" ? "danger" : "primary"} isLoading={busy} isDisabled={busy || (needsReason && reason.trim().length < 3) || (action === "confirm" && !line) || (action === "reconcile" && !disposition)} onPress={submit}>{ACTION_TEXT[action][0]}</Button>
        </div>
      </div>
    </Dialog>
  );
}
