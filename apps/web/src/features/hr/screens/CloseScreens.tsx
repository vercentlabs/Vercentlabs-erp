"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, MetricStrip, PageHeader, PermissionState, StatusBadge, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, HrApiError, readView, type Row } from "@/features/hr/shared/client";
import { amount, calendarDate, label, tone } from "@/features/hr/shared/format";
import { HrAlert, HrPanel, useCan } from "@/features/hr/shared/HrUi";

const errorText = (e: unknown) => (e instanceof HrApiError ? e.message : "This could not be completed.");

// F433: calculate, approve and pay a final settlement.
export function SettlementDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "hr", "final-settlement", id), queryFn: () => readView<{ settlement: Row }>("final-settlement", { id }).then((r) => r.settlement) });
  const go = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setError(null); queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "hr") }); },
    onError: (e) => setError(errorText(e)),
  });
  if (query.isError) return <PermissionState title="You don't have access to this settlement" description="Ask an administrator to grant hr_payroll.payroll.prepare." />;
  const s = query.data;
  if (!s) return <p className="text-sm text-text-muted">Loading…</p>;
  const st = String(s.status);
  const lines = s.lines as Array<{ code: string; label: string; kind: string; amount: number }>;
  const manage = can("hr_payroll.payroll.prepare");
  const approve = can("hr_payroll.payroll.approve");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={String(s.settlement_number)} description={`${s.employee_name} (${s.employee_number}) · last working day ${calendarDate(s.last_working_day)}`} />
      {notice && <HrAlert tone="success">{notice}</HrAlert>}
      {error && <HrAlert>{error}</HrAlert>}
      <MetricStrip metrics={[{ label: "Status", value: label(st) }, { label: "Earnings", value: amount(s.total_earnings) }, { label: "Recoveries", value: amount(s.total_recoveries) }, { label: "Net", value: amount(s.net_amount) }]} />
      <HrPanel title="Lines">
        <ul className="text-sm" aria-label="Settlement lines">
          {lines.map((l) => <li key={l.code}>{l.label} — {l.kind === "recovery" ? "recovery of " : ""}{amount(l.amount)}</li>)}
        </ul>
      </HrPanel>
      <div className="flex flex-wrap gap-2">
        {manage && st === "draft" && <Button variant="primary" onPress={() => go.mutate(async () => { await act("settlement-submit", { id }); setNotice("Submitted. A second person must approve it."); })} isLoading={go.isPending}>Submit for approval</Button>}
        {approve && st === "pending_approval" && <Button variant="primary" onPress={() => go.mutate(async () => { await act("settlement-decide", { id, approve: true }); setNotice("Approved. It can now be paid."); })} isLoading={go.isPending}>Approve</Button>}
        {approve && st === "pending_approval" && <Button variant="secondary" onPress={() => go.mutate(async () => { await act("settlement-decide", { id, approve: false, note: "Please review" }); setNotice("Sent back to draft."); })}>Send back</Button>}
        {manage && st === "approved" && <Button variant="primary" onPress={() => go.mutate(async () => { await act("settlement-pay", { id }); setNotice("Paid through a payroll run. Submit and approve it like any other payroll."); })} isLoading={go.isPending}>Pay settlement</Button>}
      </div>
      {s.payroll_run_id !== undefined && s.payroll_run_id !== null && (
        <p className="text-xs text-text-muted"><a className="text-brand hover:underline" href={`/hr/payroll-run/${String(s.payroll_run_id)}`}>Open the payroll run for this settlement</a></p>
      )}
    </div>
  );
}

// F433 trigger, from an employee's own page: calculate a settlement for a separated employee.
export function CalculateSettlementButton({ employeeId, status }: { employeeId: string; status: string }) {
  const can = useCan();
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const go = useMutation({
    mutationFn: () => act<{ record: Row }>("settlement-calculate", { employeeId }),
    onSuccess: (r) => { setError(null); queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "hr") }); window.location.href = `/hr/settlement/${r.record.id}`; },
    onError: (e) => setError(errorText(e)),
  });
  if (status !== "separated" || !can("hr_payroll.payroll.prepare")) return null;
  return (
    <div className="flex flex-col gap-2">
      {error && <HrAlert>{error}</HrAlert>}
      <Button variant="secondary" onPress={() => go.mutate()} isLoading={go.isPending}>Calculate final settlement</Button>
    </div>
  );
}

// F436/F437/F438: bank file, accounting posting and reconciliation, shown on the payroll run screen.
export function PayrollCloseoutPanel({ runId, status }: { runId: string; status: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [utr, setUtr] = useState<{ fileId: string } | null>(null);
  const [utrValue, setUtrValue] = useState("");
  const files = useQuery({ queryKey: scopedQueryKey(workspace, "hr", "bank-files", runId), queryFn: () => readView<{ rows: Row[] }>("bank-files", { runId }).then((r) => r.rows) });
  const rec = useQuery({ queryKey: scopedQueryKey(workspace, "hr", "payroll-reconciliation", runId), queryFn: () => readView<{ reconciliation: Row }>("payroll-reconciliation", { runId }).then((r) => r.reconciliation), enabled: ["approved", "posted", "paid"].includes(status) });
  const go = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setError(null); queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "hr") }); },
    onError: (e) => setError(errorText(e)),
  });
  if (!can("hr_payroll.payroll.post") || !["approved", "posted", "paid"].includes(status)) return null;
  const fileRows = files.data ?? [];
  const activeFile = fileRows.find((f) => f.status === "generated" || f.status === "acknowledged");
  return (
    <HrPanel title="Bank transfer and accounting" description="Generate the bank file, post the payroll to accounting, then check that everything ties out.">
      {notice && <HrAlert tone="success">{notice}</HrAlert>}
      {error && <HrAlert>{error}</HrAlert>}
      <div className="flex flex-wrap gap-2">
        {!activeFile && <Button variant="secondary" onPress={() => go.mutate(async () => { await act("bank-file-generate", { runId }); setNotice("Bank file generated."); })} isLoading={go.isPending}>Generate bank file</Button>}
        {activeFile && activeFile.status === "generated" && <Button variant="secondary" onPress={() => setUtr({ fileId: String(activeFile.id) })}>Acknowledge bank file</Button>}
        <Button variant="secondary" onPress={() => go.mutate(async () => { await act("payroll-post-accounting", { runId }); setNotice("Posted to accounting."); })} isLoading={go.isPending} isDisabled={status !== "approved"}>Post to accounting</Button>
        <Button variant="ghost" onPress={() => { window.location.href = `/hr/statutory-report/${runId}`; }}>Statutory report</Button>
      </div>
      {fileRows.length > 0 && (
        <ul className="text-sm" aria-label="Bank files">
          {fileRows.map((f) => <li key={String(f.id)}>{String(f.file_number)} — {String(f.record_count)} employee(s), {amount(f.total_amount)} <StatusBadge tone={tone(f.status)}>{label(f.status)}</StatusBadge>{f.utr_reference ? ` · UTR ${String(f.utr_reference)}` : ""}</li>)}
        </ul>
      )}
      {rec.data && (
        <div>
          <p className="text-sm font-medium text-text">{rec.data.reconciled ? "Reconciled: everything ties out." : "Not yet reconciled."}</p>
          <ul className="text-sm" aria-label="Reconciliation checks">
            {(rec.data.checks as Array<{ check: string; ok: boolean; detail: string }>).map((k) => <li key={k.check}>{k.ok ? "✓" : "✗"} {k.check} — {k.detail}</li>)}
          </ul>
        </div>
      )}
      {utr && (
        <Dialog isOpen onOpenChange={(o) => !o && setUtr(null)} title="Acknowledge bank file">
          <div className="flex flex-col gap-4">
            <TextField label="Bank UTR / batch reference" value={utrValue} onChange={setUtrValue} isRequired />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setUtr(null)}>Close</Button>
              <Button variant="primary" isDisabled={!utrValue.trim()} onPress={() => go.mutate(async () => { await act("bank-file-acknowledge", { id: utr.fileId, utrReference: utrValue }); setNotice("Acknowledged. The payroll is marked paid."); setUtr(null); setUtrValue(""); })} isLoading={go.isPending}>Acknowledge</Button>
            </div>
          </div>
        </Dialog>
      )}
    </HrPanel>
  );
}
