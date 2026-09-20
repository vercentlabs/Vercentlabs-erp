"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, MetricStrip, NumberField, PageHeader, PermissionState, Select, StatusBadge, TextArea, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { act, HrApiError, readView, useHrOptions, type Row } from "@/features/hr/shared/client";
import { amount, calendarDate, label, quantity, tone } from "@/features/hr/shared/format";
import { HrAlert, HrPanel, useCan } from "@/features/hr/shared/HrUi";
import { PayrollCloseoutPanel } from "@/features/hr/screens/CloseScreens";

const errorText = (e: unknown) => (e instanceof HrApiError ? e.message : "This could not be completed.");

// ---------------------------------------------------------------- structure builder (F421)
type LineDraft = { componentId: string; basis: "percentage" | "amount" | "formula" | "balance"; value: string; percentOf: string; min: string; max: string };
const blank = (): LineDraft => ({ componentId: "", basis: "percentage", value: "", percentOf: "CTC", min: "", max: "" });

export function StructureBuilderScreen() {
  const router = useRouter();
  const options = useHrOptions();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([blank()]);
  const [error, setError] = useState<string | null>(null);
  const components = options.data?.salaryComponents ?? [];
  const codeOf = (id: string) => components.find((c) => c.id === id)?.code ?? "";
  const save = useMutation({
    mutationFn: () =>
      act<{ record: Row }>("structure-create", {
        code,
        name,
        lines: lines.map((l) => ({
          componentId: l.componentId,
          isBalance: l.basis === "balance",
          ...(l.basis === "percentage" ? { percentage: Number(l.value), percentOf: l.percentOf || "CTC" } : {}),
          ...(l.basis === "amount" ? { amount: Number(l.value) } : {}),
          ...(l.basis === "formula" ? { formula: l.value } : {}),
          minimumAmount: l.min === "" ? undefined : Number(l.min),
          maximumAmount: l.max === "" ? undefined : Number(l.max),
        })),
      }),
    onSuccess: (r) => router.push(`/hr/structure/${r.record.id}`),
    onError: (e) => setError(errorText(e)),
  });
  const set = (i: number, patch: Partial<LineDraft>) => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const earlier = (i: number) => ["CTC", ...lines.slice(0, i).map((l) => codeOf(l.componentId)).filter(Boolean)];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="New salary structure" description="Lines are worked out in order; each line can refer to CTC or an earlier line. Put the balancing allowance last: it takes whatever is left of the CTC." />
      {error && <HrAlert>{error}</HrAlert>}
      <HrPanel>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <TextField label="Code" value={code} onChange={setCode} isRequired />
          <TextField label="Name" value={name} onChange={setName} isRequired />
        </div>
      </HrPanel>
      <HrPanel title="Components">
        <div className="flex flex-col gap-3">
          {lines.map((l, i) => (
            <div key={i} className="grid grid-cols-2 items-end gap-2 rounded-[var(--radius-control)] border border-border p-2 md:grid-cols-7">
              <Select label={`Component ${i + 1}`} options={components.map((c) => ({ value: c.id, label: `${c.name} (${c.code})` }))} selectedKey={l.componentId || null} onSelectionChange={(k) => set(i, { componentId: String(k ?? "") })} placeholder="Select component" />
              <Select label={`Basis ${i + 1}`} options={[{ value: "percentage", label: "Percentage" }, { value: "amount", label: "Fixed amount" }, { value: "formula", label: "Formula" }, { value: "balance", label: "Balance of CTC" }]} selectedKey={l.basis} onSelectionChange={(k) => set(i, { basis: String(k) as LineDraft["basis"], value: "" })} />
              {l.basis !== "balance" && <TextField label={`Value ${i + 1}`} value={l.value} onChange={(v) => set(i, { value: v })} placeholder={l.basis === "formula" ? "min(BASIC * 0.4, 20000)" : l.basis === "percentage" ? "50" : "1600"} />}
              {l.basis === "percentage" && <Select label={`Of ${i + 1}`} options={earlier(i).map((c) => ({ value: c, label: c }))} selectedKey={l.percentOf} onSelectionChange={(k) => set(i, { percentOf: String(k) })} />}
              {l.basis !== "balance" && <TextField label={`Minimum ${i + 1}`} value={l.min} onChange={(v) => set(i, { min: v })} />}
              {l.basis !== "balance" && <TextField label={`Maximum ${i + 1}`} value={l.max} onChange={(v) => set(i, { max: v })} />}
              <Button variant="ghost" onPress={() => setLines((cur) => cur.filter((_, j) => j !== i))} isDisabled={lines.length === 1}>Remove</Button>
            </div>
          ))}
          <div><Button variant="secondary" onPress={() => setLines((cur) => [...cur, blank()])}>Add component</Button></div>
        </div>
      </HrPanel>
      <div className="flex gap-2">
        <Button variant="primary" onPress={() => save.mutate()} isLoading={save.isPending} isDisabled={!code.trim() || !name.trim() || lines.some((l) => !l.componentId)}>Create structure</Button>
        <Button variant="secondary" onPress={() => router.push("/hr/salary-structures")}>Cancel</Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- structure detail with a live preview
type Breakup = { monthlyCtc: number; monthlyGross: number; monthlyEmployerContributions: number; monthlyFixedDeductions: number; components: Array<{ code: string; name: string; type: string; amount: number; statutory?: boolean }> };

export function StructureDetailScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const [ctc, setCtc] = useState(1200000);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "hr", "salary-structure", id), queryFn: () => readView<{ structure: Row }>("salary-structure", { id }).then((r) => r.structure) });
  const preview = useMutation({ mutationFn: () => readView<{ preview: Breakup }>("structure-preview", { structureId: id, annualCtc: String(ctc) }).then((r) => r.preview), onError: (e) => setError(errorText(e)) });
  const run = useMutation({
    mutationFn: (fn: () => Promise<unknown>) => fn(),
    onSuccess: () => { setError(null); queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "hr") }); },
    onError: (e) => setError(errorText(e)),
  });
  if (query.isError) return <PermissionState title="You don't have access to salary structures" description="Ask an administrator to grant hr_payroll.compensation.manage." />;
  const s = query.data;
  if (!s) return <p className="text-sm text-text-muted">Loading…</p>;
  const lines = s.lines as Row[];
  const manage = can("hr_payroll.compensation.manage");
  const b = preview.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`${s.name}`} description={`${s.code} version ${s.version}`}
        primaryAction={manage && s.status === "draft" ? <Button variant="primary" onPress={() => run.mutate(async () => { await act("structure-submit", { id }); setNotice("Submitted. A second person must approve it."); })}>Submit for approval</Button> : undefined} />
      {notice && <HrAlert tone="success">{notice}</HrAlert>}
      {error && <HrAlert>{error}</HrAlert>}
      <MetricStrip metrics={[{ label: "Status", value: label(s.status) }, { label: "Components", value: String(lines.length) }, { label: "Pay frequency", value: label(s.pay_frequency) }, { label: "Currency", value: String(s.currency_code) }]} />
      {manage && s.status === "pending_approval" && (
        <HrPanel title="Decision" description="Someone other than the people who prepared and submitted it approves a structure.">
          <div className="flex gap-2">
            <Button variant="primary" onPress={() => run.mutate(async () => { await act("structure-decide", { id, approve: true }); setNotice("Approved. New pay can now be set on it."); })}>Approve</Button>
            <Button variant="secondary" onPress={() => run.mutate(async () => { await act("structure-decide", { id, approve: false, note: "Please revise" }); setNotice("Sent back to draft."); })}>Send back</Button>
          </div>
        </HrPanel>
      )}
      {manage && ["active", "inactive"].includes(String(s.status)) && (
        <div><Button variant="secondary" onPress={() => run.mutate(async () => { const r = await act<{ record: Row }>("structure-revise", { id }); window.location.href = `/hr/structure/${r.record.id}`; })}>Revise (new version)</Button></div>
      )}
      <HrPanel title="Lines">
        <ol className="text-sm" aria-label="Structure lines">
          {lines.map((l) => (
            <li key={String(l.id)}>
              {String(l.sequence)}. {String(l.component_name)} ({String(l.component_code)}) — {label(l.component_type)}:{" "}
              {l.is_balance ? "balance of CTC" : l.formula ? `formula ${String(l.formula)}` : l.percentage !== null ? `${quantity(l.percentage)}% of ${String(l.percent_of ?? "CTC")}` : l.calculation_type === "statutory" ? "statutory (calculated at payroll)" : `fixed ${amount(l.amount)}`}
              {l.minimum_amount !== null ? ` · min ${amount(l.minimum_amount)}` : ""}{l.maximum_amount !== null ? ` · max ${amount(l.maximum_amount)}` : ""}
            </li>
          ))}
        </ol>
      </HrPanel>
      <HrPanel title="Try a CTC" description="Works out the monthly breakup exactly as it would be frozen onto an employee.">
        <div className="flex flex-wrap items-end gap-3">
          <NumberField label="Annual CTC" value={ctc} minValue={1} step={10000} onChange={(n) => setCtc(Number.isNaN(n) ? 0 : n)} />
          <Button variant="secondary" onPress={() => { setError(null); preview.mutate(); }} isLoading={preview.isPending} isDisabled={ctc <= 0}>Calculate</Button>
        </div>
        {b && (
          <>
            <MetricStrip metrics={[{ label: "Monthly CTC", value: amount(b.monthlyCtc) }, { label: "Monthly gross", value: amount(b.monthlyGross) }, { label: "Employer contributions", value: amount(b.monthlyEmployerContributions) }, { label: "Fixed deductions", value: amount(b.monthlyFixedDeductions) }]} />
            <ul className="text-sm" aria-label="Monthly breakup">
              {b.components.map((c) => <li key={c.code}>{c.name} ({c.code}) — {label(c.type)}: {c.statutory ? "calculated at payroll" : amount(c.amount)}</li>)}
            </ul>
          </>
        )}
      </HrPanel>
    </div>
  );
}

// ---------------------------------------------------------------- payroll run workspace (F423-F427, F434)
export function PayrollRunScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ title: string; required: boolean; run: (note: string) => Promise<unknown>; success: string } | null>(null);
  const [note, setNote] = useState("");
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "hr", "payroll-run", id), queryFn: () => readView<{ run: Row }>("payroll-run", { id }).then((r) => r.run) });
  const go = useMutation({
    mutationFn: async ({ fn, success }: { fn: (note: string) => Promise<unknown>; success: string; note: string }) => { await fn(note); return success; },
    onSuccess: (success) => { setError(null); setNotice(success); setAsk(null); setNote(""); queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "hr") }); },
    onError: (e) => { setNotice(null); setError(errorText(e)); },
  });
  const verify = useMutation({
    mutationFn: () => readView<{ result: { checked: number; matches: boolean; mismatches: string[] } }>("payroll-determinism", { id }).then((r) => r.result),
    onSuccess: (r) => { setError(null); setNotice(r.matches ? `Recalculated ${r.checked} payslip(s) from the same inputs: every one is identical.` : `${r.mismatches.length} payslip(s) differ from a fresh calculation: ${r.mismatches.join(", ")}.`); },
    onError: (e) => setError(errorText(e)),
  });
  if (query.isError) return <PermissionState title="You don't have access to this payroll" description="Ask an administrator to grant hr_payroll.payroll.prepare." />;
  const r = query.data;
  if (!r) return <p className="text-sm text-text-muted">Loading…</p>;
  const payslips = r.payslips as Row[];
  const exceptions = r.exceptions as Row[];
  const totals = r.byComponent as Row[];
  const st = String(r.status);
  const prepare = can("hr_payroll.payroll.prepare");
  const approve = can("hr_payroll.payroll.approve");
  const open = (a: NonNullable<typeof ask>) => { setNotice(null); setError(null); setNote(""); setAsk(a); };
  const blocking = exceptions.filter((e) => e.severity === "error" && !e.resolved).length;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={String(r.payroll_number)} description={`${calendarDate(r.period_start)} to ${calendarDate(r.period_end)} · payment ${calendarDate(r.payment_date)}`} />
      {notice && <HrAlert tone="success">{notice}</HrAlert>}
      {error && <HrAlert>{error}</HrAlert>}
      {r.returned_reason && st === "calculated" && <HrAlert tone="warning">Sent back: {String(r.returned_reason)}</HrAlert>}
      <MetricStrip metrics={[{ label: "Status", value: label(st) }, { label: "Employees", value: String(r.employee_count) }, { label: "Gross", value: amount(r.gross_pay) }, { label: "Deductions", value: amount(r.total_deductions) }, { label: "Net pay", value: amount(r.net_pay) }, { label: "Employer contributions", value: amount(r.employer_contributions) }, { label: "Blocking exceptions", value: String(blocking) }]} />
      <div className="flex flex-wrap gap-2">
        {prepare && ["draft", "calculated"].includes(st) && <Button variant="primary" onPress={() => go.mutate({ fn: () => act("payroll-calculate", { id }), success: "Calculated from attendance, leave and pay.", note: "" })} isLoading={go.isPending}>{st === "draft" ? "Calculate" : "Recalculate"}</Button>}
        {prepare && st === "calculated" && <Button variant="secondary" onPress={() => go.mutate({ fn: () => act("payroll-submit", { id }), success: "Submitted for approval.", note: "" })}>Submit for approval</Button>}
        {approve && st === "pending_approval" && <Button variant="primary" onPress={() => open({ title: "Approve", required: false, run: (n) => act("payroll-decide", { id, approve: true, note: n }), success: "Approved. Payslips are released to employees per your settings." })}>Approve</Button>}
        {(prepare || approve) && st === "pending_approval" && <Button variant="secondary" onPress={() => open({ title: "Send back", required: true, run: (n) => act("payroll-return", { id, reason: n }), success: "Sent back for correction." })}>Send back</Button>}
        {prepare && ["draft", "calculated", "pending_approval", "approved"].includes(st) && <Button variant="ghost" onPress={() => open({ title: "Cancel payroll", required: true, run: (n) => act("payroll-cancel", { id, reason: n }), success: "Payroll cancelled." })}>Cancel payroll</Button>}
        {["calculated", "pending_approval", "approved"].includes(st) && <Button variant="ghost" onPress={() => verify.mutate()} isLoading={verify.isPending}>Verify against a fresh calculation</Button>}
      </div>
      {exceptions.length > 0 && (
        <HrPanel title="Exceptions" description="Errors block submission. A warning is acknowledged with a note (Payroll exceptions).">
          <ul className="text-sm" aria-label="Payroll exceptions">
            {exceptions.map((e) => (
              <li key={String(e.id)}>
                <StatusBadge tone={e.resolved ? "success" : e.severity === "error" ? "danger" : "warning"}>{e.resolved ? "Resolved" : label(e.severity)}</StatusBadge> {e.employee_number ? `${String(e.employee_number)} · ` : ""}{String(e.message)}
              </li>
            ))}
          </ul>
        </HrPanel>
      )}
      <HrPanel title="Totals by component">
        {totals.length === 0 ? <p className="text-sm text-text-muted">Nothing calculated yet.</p> : (
          <ul className="text-sm" aria-label="Totals by component">
            {totals.map((t) => <li key={String(t.component_code)}>{String(t.component_name)} ({String(t.component_code)}) — {label(t.component_type)}: {amount(t.component_type === "employer_contribution" ? t.employer : t.amount)}</li>)}
          </ul>
        )}
      </HrPanel>
      <HrPanel title="Payslips">
        {payslips.length === 0 ? <p className="text-sm text-text-muted">No payslips yet.</p> : (
          <ul className="text-sm" aria-label="Run payslips">
            {payslips.map((p) => (
              <li key={String(p.id)}>
                <Link className="text-brand hover:underline" href={`/hr/payslip/${String(p.id)}`}>{String(p.employee_name)} ({String(p.employee_number)})</Link> — gross {amount(p.gross_pay)}, deductions {amount(p.total_deductions)}, net {amount(p.net_pay)} <StatusBadge tone={tone(p.status)}>{label(p.status)}</StatusBadge>
              </li>
            ))}
          </ul>
        )}
      </HrPanel>
      {["approved", "posted", "paid"].includes(st) && <PayrollCloseoutPanel runId={id} status={st} />}
      {ask && (
        <Dialog isOpen onOpenChange={(o) => !o && setAsk(null)} title={ask.title}>
          <div className="flex flex-col gap-4">
            {error && <HrAlert>{error}</HrAlert>}
            <TextArea label={ask.required ? "Reason" : "Note (optional)"} isRequired={ask.required} value={note} onChange={setNote} />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onPress={() => setAsk(null)}>Close</Button>
              <Button variant="primary" onPress={() => go.mutate({ fn: ask.run, success: ask.success, note: note.trim() })} isLoading={go.isPending} isDisabled={ask.required && !note.trim()}>{ask.title}</Button>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- payslip (F435 view)
export function PayslipScreen({ id }: { id: string }) {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "hr", "payslip", id), queryFn: () => readView<{ payslip: Row }>("payslip", { id }).then((r) => r.payslip), retry: false });
  if (query.isError) return <HrPanel title="Payslip"><HrAlert tone="info">{query.error instanceof HrApiError ? query.error.message : "This payslip could not be loaded."}</HrAlert></HrPanel>;
  const p = query.data;
  if (!p) return <p className="text-sm text-text-muted">Loading…</p>;
  const lines = p.lines as Row[];
  const earnings = lines.filter((l) => l.component_type === "earning");
  const deductions = lines.filter((l) => l.component_type === "deduction");
  const employer = lines.filter((l) => Number(l.employer_amount) > 0);
  const bank = p.bank_details as Record<string, string> | null;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={`Payslip ${String(p.payslip_number)}`} description={`${String(p.employee_name)} (${String(p.employee_number)}) · ${calendarDate(p.period_start)} to ${calendarDate(p.period_end)}`} />
      <MetricStrip metrics={[{ label: "Gross", value: amount(p.gross_pay) }, { label: "Deductions", value: amount(p.total_deductions) }, { label: "Net pay", value: amount(p.net_pay) }, { label: "Paid days", value: `${quantity(p.paid_days)} of ${quantity(p.working_days)}` }, { label: "Loss of pay", value: quantity(p.lop_days) }, { label: "Overtime", value: `${Math.round(Number(p.overtime_minutes) / 6) / 10} h` }]} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <HrPanel title="Earnings">
          <ul className="text-sm" aria-label="Earnings">{earnings.map((l) => <li key={String(l.component_code)}>{String(l.component_name)} — {amount(l.amount)}</li>)}</ul>
        </HrPanel>
        <HrPanel title="Deductions">
          {deductions.length === 0 ? <p className="text-sm text-text-muted">None.</p> : <ul className="text-sm" aria-label="Deductions">{deductions.map((l) => <li key={String(l.component_code)}>{String(l.component_name)} — {amount(l.amount)}</li>)}</ul>}
        </HrPanel>
      </div>
      {employer.length > 0 && <HrPanel title="Employer contributions (not deducted from you)"><ul className="text-sm" aria-label="Employer contributions">{employer.map((l) => <li key={String(l.component_code)}>{String(l.component_name)} — {amount(l.employer_amount)}</li>)}</ul></HrPanel>}
      <HrPanel title="Payment">
        <p className="text-sm">{bank?.account_number ? `To ${bank.bank_name ?? "bank account"} ${bank.account_number} (${bank.ifsc})` : "No bank account on file."} · payment date {calendarDate(p.payment_date)}</p>
      </HrPanel>
    </div>
  );
}

// ---------------------------------------------------------------- payroll home
export function PayrollHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "hr", "payroll-dashboard"), queryFn: () => readView<{ dashboard: Row }>("payroll-dashboard").then((r) => r.dashboard) });
  if (query.isError && query.error instanceof HrApiError && query.error.status === 403) return <PermissionState title="You don't have access to payroll" description="Ask an administrator to grant hr_payroll.payroll.prepare." />;
  const d = query.data;
  const latest = d?.latestRun as Row | null | undefined;
  const next = d?.nextPeriodToRun as Row | null | undefined;
  const by = (d?.runsByStatus ?? {}) as Record<string, number>;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Payroll" description="Where payroll stands, and what to do next." />
      <MetricStrip metrics={[{ label: "Latest payroll", value: latest ? `${String(latest.payroll_number)} · ${label(latest.status)}` : "None yet" }, { label: "Awaiting approval", value: String(by.pending_approval ?? 0) }, { label: "Approved", value: String(by.approved ?? 0) }, { label: "Open exceptions", value: String(d?.openExceptions ?? "…") }, { label: "Next period to run", value: next ? String(next.period_code) : "—" }]} />
      <HrPanel title="Go to">
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {[["Payroll runs", "/hr/payroll-runs", "Calculate, review, approve"], ["Payroll periods", "/hr/payroll-periods", "The pay calendar and locks"], ["Payslips", "/hr/payslips", "Every payslip"], ["Exceptions", "/hr/payroll-exceptions", "What needs attention"], ["Compensation", "/hr/compensation", "Employees' pay"], ["Salary structures", "/hr/salary-structures", "How CTC breaks up"], ["Pay components", "/hr/pay-components", "Earnings and deductions"], ["My payslips", "/hr/my-payslips", "Your own"]].map(([title, href, description]) => (
            <li key={href}>
              <Link href={href} className="flex flex-col rounded-[var(--radius-control)] border border-border p-3 hover:bg-surface-hover">
                <span className="font-medium text-text">{title}</span>
                <span className="text-xs text-text-muted">{description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </HrPanel>
    </div>
  );
}
