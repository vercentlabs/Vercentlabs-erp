"use client";

// HR — employee exit / relieving (the panel on the employee record and the Exits list) and attendance corrections. An exit is accepted
// with a last working day, cleared through the offboarding checklist, completed, then settled once the final payslip and every settlement
// item are paid. A correction is decided by the employee's manager or HR, never by whoever asked for it.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, PageHeader, StatusBadge } from "@vercentlabs/design-system";

import { errorMessage } from "@/features/quality/specifications/spec-api";
import { AskDialog, type Ask } from "@/shared/ui/AskDialog";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Option = { value: string; label: string };
type Task = { id: string; title: string; owner_label: string | null; mandatory: boolean; status: string; note: string | null };
type Exit = { id: string; employee: { id: string; number: string; name: string; status: string }; type: string; typeLabel: string; status: string; noticeDate: string;
  requestedLastDay: string | null; lastWorkingDay: string | null; reason: string; decisionNote: string | null; settlementStatus: string; settlementNote: string | null;
  withdrawnReason: string | null; tasks?: Task[];
  settlement?: { finalPayslip: { payslip_number: string; payment_status: string; net_pay: string; payroll_number: string } | null; items: Array<{ id: string; input_type: string; amount: string; description: string; status: string }>; blockers: string[] } };
type ExitPanelData = { payrollEligible: boolean; noticePeriodDays: number; types: Option[]; exit: Exit | null };
type Correction = { id: string; employee_number: string; employee_name: string; attendance_date: string; check_in: string | null; check_out: string | null; reason: string; status: string;
  requested_by_name: string | null; decided_by_name: string | null; decision_note: string | null; day_status: string | null; canDecide: boolean; canCancel: boolean };

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/hr${path}`, { credentials: "same-origin", headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}) }, ...init });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new Error(payload.message || "The request could not be completed.");
  return payload as T;
}
const post = (path: string, body: Record<string, unknown>) => call(path, { method: "POST", body: JSON.stringify(body) });
const words = (s: string) => s.replace(/_/g, " ").toLowerCase();
const TONE: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = { submitted: "warning", accepted: "info", completed: "success", rejected: "danger", withdrawn: "neutral",
  pending: "warning", settled: "success", not_required: "neutral", approved: "success", cancelled: "neutral", open: "warning", done: "success", waived: "neutral" };

function useRunner(keys: ReadonlyArray<readonly unknown[]>) {
  const client = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const run = async (path: string, body: Record<string, unknown>) => {
    setError(null);
    try { await post(path, body); for (const k of keys) await client.invalidateQueries({ queryKey: k }); } catch (e) { setError(errorMessage(e)); throw e; }
  };
  return { run, error };
}

export function EmployeeExitPanel({ employeeId }: { employeeId: string }) {
  const workspace = useWorkspaceContext();
  const key = scopedQueryKey(workspace, "hr", "exit", employeeId);
  const { run, error } = useRunner([scopedQueryKey(workspace, "hr")]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: key, queryFn: () => call<ExitPanelData>(`/exit?employeeId=${employeeId}`), retry: false });
  if (q.isLoading) return <LoadingState label="Loading the exit" rows={1} />;
  if (q.isError) return null;
  const d = q.data!;
  const x = d.exit;
  const open = x && ["submitted", "accepted"].includes(x.status);
  const act = (action: string, extra: Record<string, unknown> = {}) => run("/exit", { action, id: x?.id, ...extra });
  const startAsk: Ask = { title: "Record an exit", confirm: "Record",
    description: `The notice period on file is ${d.noticePeriodDays} day(s); the requested last day defaults to the notice date plus that.`,
    fields: [{ name: "type", label: "Kind", kind: "select", required: true, initial: "resignation", options: d.types }, { name: "noticeDate", label: "Notice given on", kind: "date" },
      { name: "requestedLastDay", label: "Requested last day", kind: "date" }, { name: "reason", label: "Reason", kind: "textarea", required: true }],
    run: async (v) => { await run("/exit", { action: "start", employeeId, ...v, noticeDate: v.noticeDate || undefined, requestedLastDay: v.requestedLastDay || undefined }); } };
  return (
    <Panel title="Exit and payroll eligibility"
      description={`${d.payrollEligible ? "Paid through payroll." : "Not paid through payroll: left out of payroll runs."}${x ? ` Latest exit: ${x.typeLabel.toLowerCase()}, ${words(x.status)}.` : ""}`}
      actions={<span className="flex flex-wrap gap-2">
        {!open && x?.status !== "completed" && <Button size="compact" variant="secondary" onPress={() => setAsk(startAsk)}>Record exit</Button>}
        {x?.status === "submitted" && <>
          <Button size="compact" variant="primary" onPress={() => setAsk({ title: "Accept the exit", confirm: "Accept", description: "The employee goes on notice, payroll prorates to the last working day, and the clearance checklist is raised.",
            fields: [{ name: "lastWorkingDay", label: "Last working day", kind: "date", initial: x.requestedLastDay ?? "", required: true }, { name: "note", label: "Note", kind: "textarea" }], run: async (v) => { await act("accept", v); } })}>Accept</Button>
          <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Reject the exit", confirm: "Reject", tone: "danger", fields: [{ name: "note", label: "Reason", kind: "textarea", required: true }], run: async (v) => { await act("reject", v); } })}>Reject</Button></>}
        {x?.status === "accepted" && <Button size="compact" variant="primary" onPress={() => setAsk({ title: "Complete the exit", confirm: "Complete", description: "Allowed on or after the last working day, once every mandatory clearance task is done or waived. Attendance, leave and payslips stay on record.",
          fields: [{ name: "exitInterview", label: "Exit interview notes", kind: "textarea" }], run: async (v) => { await act("complete", { exitInterview: v.exitInterview || undefined }); } })}>Complete exit</Button>}
        {open && <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Withdraw the exit", confirm: "Withdraw", description: "The employee is current again and the open clearance tasks are waived.",
          fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }], run: async (v) => { await act("withdraw", v); } })}>Withdraw</Button>}
        {x?.status === "completed" && x.settlementStatus === "pending" && <>
          <Button size="compact" variant="primary" onPress={() => setAsk({ title: "Mark the final settlement settled", confirm: "Settled", fields: [{ name: "note", label: "Note", kind: "textarea" }], run: async (v) => { await act("settle", v); } })}>Settle</Button>
          <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "No final settlement needed", confirm: "Confirm", fields: [{ name: "note", label: "Why nothing is owed", kind: "textarea", required: true }], run: async (v) => { await act("settle", { ...v, notRequired: true }); } })}>Not required</Button></>}
        <Button size="compact" variant="ghost" onPress={() => setAsk({ title: d.payrollEligible ? "Stop paying through payroll" : "Pay through payroll", confirm: "Change", fields: [{ name: "reason", label: "Reason", kind: "textarea", required: true }],
          run: async (v) => { await run("/exit", { action: "eligibility", employeeId, eligible: !d.payrollEligible, ...v }); } })}>{d.payrollEligible ? "Mark not payroll-eligible" : "Mark payroll-eligible"}</Button>
      </span>}>
      {error && <Notice tone="danger">{error}</Notice>}
      {x && <dl className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
        <div><dt className="text-text-muted">Kind</dt><dd>{x.typeLabel} <StatusBadge tone={TONE[x.status] ?? "neutral"}>{words(x.status)}</StatusBadge></dd></div>
        <div><dt className="text-text-muted">Notice given</dt><dd>{x.noticeDate}</dd></div>
        <div><dt className="text-text-muted">Last working day</dt><dd>{x.lastWorkingDay ?? `${x.requestedLastDay ?? "—"} (requested)`}</dd></div>
        <div><dt className="text-text-muted">Final settlement</dt><dd>{x.status === "completed" ? <StatusBadge tone={TONE[x.settlementStatus] ?? "neutral"}>{words(x.settlementStatus)}</StatusBadge> : "—"}</dd></div>
        <div className="col-span-2 md:col-span-4"><dt className="text-text-muted">Reason</dt><dd>{x.reason}{x.withdrawnReason ? ` · Withdrawn: ${x.withdrawnReason}` : ""}</dd></div>
      </dl>}
      {x?.tasks && x.tasks.length > 0 && <LinesTable columns={["Clearance", "Owner", "Status"]}>
        {x.tasks.map((t) => <tr key={t.id}><Cell>{t.title}{!t.mandatory && <span className="text-xs text-text-muted"> (optional)</span>}</Cell><Cell>{t.owner_label ?? "—"}</Cell>
          <Cell><StatusBadge tone={TONE[t.status] ?? "neutral"}>{t.status}</StatusBadge></Cell></tr>)}
      </LinesTable>}
      {x?.status === "completed" && x.settlementStatus === "pending" && x.settlement && (x.settlement.blockers.length
        ? <Notice tone="warning">Before settling: {x.settlement.blockers.join(" ")}</Notice>
        : <Notice tone="success">The final payslip{x.settlement.finalPayslip ? ` ${x.settlement.finalPayslip.payslip_number}` : ""} and every settlement item are paid.</Notice>)}
      {x?.settlement && x.settlement.items.length > 0 && <LinesTable columns={["Settlement item", "Kind", { label: "Amount", numeric: true }, "Status"]}>
        {x.settlement.items.map((i) => <tr key={i.id}><Cell>{i.description}</Cell><Cell>{i.input_type === "settlement_earning" ? "Earning" : "Deduction"}</Cell>
          <Cell numeric>{`₹${Number(i.amount).toLocaleString("en-IN")}`}</Cell><Cell>{words(i.status)}</Cell></tr>)}
      </LinesTable>}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </Panel>
  );
}

export function ExitsScreen() {
  const workspace = useWorkspaceContext();
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: scopedQueryKey(workspace, "hr", "exits", status), queryFn: () => call<{ rows: Exit[] }>(`/exit${status ? `?status=${status}` : ""}`), retry: false });
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Exits" description="Resignations, terminations and other exits: notice, last working day, clearance and final settlement. Open an employee to act on their exit; settlement waits for the final payslip and every settlement item to be paid." />
      <div className="flex flex-wrap gap-2">
        {[["", "All"], ["submitted", "Awaiting acceptance"], ["accepted", "On notice"], ["completed", "Completed"], ["withdrawn", "Withdrawn"]].map(([v, l]) =>
          <Button key={v} size="compact" variant={status === v ? "primary" : "secondary"} onPress={() => setStatus(v)}>{l}</Button>)}
      </div>
      {q.isLoading ? <LoadingState label="Loading exits" rows={3} /> : q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice> : (
        <LinesTable columns={["Employee", "Kind", "Status", "Notice given", "Last working day", "Settlement"]} empty={q.data!.rows.length ? undefined : "No exits."}>
          {q.data!.rows.map((x) => <tr key={x.id}><Cell><a className="text-brand hover:underline" href={`/hr/employee/${x.employee.id}`}>{`${x.employee.number} · ${x.employee.name}`}</a></Cell>
            <Cell>{x.typeLabel}</Cell><Cell><StatusBadge tone={TONE[x.status] ?? "neutral"}>{words(x.status)}</StatusBadge></Cell><Cell>{x.noticeDate}</Cell>
            <Cell>{x.lastWorkingDay ?? `${x.requestedLastDay ?? "—"} (requested)`}</Cell><Cell>{x.status === "completed" ? words(x.settlementStatus) : "—"}</Cell></tr>)}
        </LinesTable>)}
    </div>
  );
}

export function AttendanceCorrectionsScreen() {
  const workspace = useWorkspaceContext();
  const key = scopedQueryKey(workspace, "hr", "attendance-corrections");
  const { run, error } = useRunner([scopedQueryKey(workspace, "hr")]);
  const [ask, setAsk] = useState<Ask | null>(null);
  const q = useQuery({ queryKey: key, queryFn: () => call<{ rows: Correction[]; employees: Option[] }>("/attendance-corrections"), retry: false });
  const employees = q.data?.employees ?? [];
  const requestAsk: Ask = { title: "Ask for an attendance correction", confirm: "Ask",
    description: "For a missing or wrong check-in / check-out. The day shows pending correction until the manager or HR decides; the original punches are kept.",
    fields: [...(employees.length ? [{ name: "employeeId", label: "Employee (empty: yourself)", kind: "select" as const, options: employees }] : []),
      { name: "date", label: "Day", kind: "date", required: true }, { name: "checkIn", label: "Check-in (HH:MM)", kind: "text" }, { name: "checkOut", label: "Check-out (HH:MM)", kind: "text" },
      { name: "reason", label: "Reason", kind: "textarea", required: true }],
    run: async (v) => { await run("/attendance-corrections", { action: "request", ...v, checkIn: v.checkIn || undefined, checkOut: v.checkOut || undefined }); } };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Attendance Corrections" description="Missing punches and wrong times, corrected with a reason and decided by the employee's manager or HR — never by whoever asked. A day in an approved payroll is locked."
        primaryAction={<Button variant="primary" onPress={() => setAsk(requestAsk)}>Ask for a correction</Button>} />
      {error && <Notice tone="danger">{error}</Notice>}
      {q.isLoading ? <LoadingState label="Loading corrections" rows={3} /> : q.isError ? <Notice tone="danger">{errorMessage(q.error)}</Notice> : (
        <LinesTable columns={["Employee", "Day", "In", "Out", "Reason", "Status", ""]} empty={q.data!.rows.length ? undefined : "No corrections."}>
          {q.data!.rows.map((r) => <tr key={r.id}><Cell>{`${r.employee_number} · ${r.employee_name}`}</Cell><Cell>{r.attendance_date}</Cell><Cell>{r.check_in ?? "—"}</Cell><Cell>{r.check_out ?? "—"}</Cell>
            <Cell>{r.reason}{r.requested_by_name && <span className="block text-xs text-text-muted">Asked by {r.requested_by_name}</span>}</Cell>
            <Cell><StatusBadge tone={TONE[r.status] ?? "neutral"}>{r.status}</StatusBadge>{r.decision_note && <span className="block text-xs text-text-muted">{r.decision_note}</span>}</Cell>
            <Cell><span className="flex gap-1">
              {r.canDecide && <><Button size="compact" variant="primary" onPress={() => { run("/attendance-corrections", { action: "approve", id: r.id }).catch(() => undefined); }}>Approve</Button>
                <Button size="compact" variant="ghost" onPress={() => setAsk({ title: "Reject the correction", confirm: "Reject", tone: "danger", fields: [{ name: "note", label: "Reason", kind: "textarea", required: true }],
                  run: async (v) => { await run("/attendance-corrections", { action: "reject", id: r.id, ...v }); } })}>Reject</Button></>}
              {r.canCancel && <Button size="compact" variant="ghost" onPress={() => { run("/attendance-corrections", { action: "cancel", id: r.id }).catch(() => undefined); }}>Cancel</Button>}
            </span></Cell></tr>)}
        </LinesTable>)}
      {ask && <AskDialog ask={ask} onClose={() => setAsk(null)} />}
    </div>
  );
}
