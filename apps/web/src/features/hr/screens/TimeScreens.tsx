"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, MetricStrip, NumberField, PageHeader, PermissionState, TextField } from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { REGISTERS } from "@/features/hr/configs-all";
import { act, HrApiError, readView, type Row } from "@/features/hr/shared/client";
import { dateTime, label } from "@/features/hr/shared/format";
import { HrAlert, HrPanel, useCan } from "@/features/hr/shared/HrUi";
import { Register } from "@/features/hr/shared/Register";

// Check in / check out for the signed-in employee, then their own recent days. The punch is taken
// at the server's time -- an employee cannot supply a past one.
export function MyAttendanceScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const state = useQuery({ queryKey: scopedQueryKey(workspace, "hr", "punch-state"), queryFn: () => readView<{ state: { checkedIn: boolean; lastPunch: Row | null; today: Row | null } }>("punch-state").then((r) => r.state), retry: false });
  const punch = useMutation({
    mutationFn: (direction: "in" | "out") => act("punch", { direction, source: "web" }),
    onSuccess: (_r, direction) => {
      setError(null);
      setNotice(direction === "in" ? "Checked in." : "Checked out.");
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "hr") });
    },
    onError: (e) => { setNotice(null); setError(e instanceof HrApiError ? e.message : "Could not record that."); },
  });
  if (state.isError) return <HrPanel title="My attendance"><HrAlert tone="info">{state.error instanceof HrApiError ? state.error.message : "Your attendance could not be loaded."}</HrAlert></HrPanel>;
  const s = state.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Check in and out" description="Check in when you start and out when you finish. Your manager or HR can correct a missed punch after the fact." />
      {notice && <HrAlert tone="success">{notice}</HrAlert>}
      {error && <HrAlert>{error}</HrAlert>}
      <MetricStrip metrics={[{ label: "Right now", value: s ? (s.checkedIn ? "Checked in" : "Checked out") : "…" }, { label: "Last punch", value: s?.lastPunch ? `${label(String(s.lastPunch.direction))} ${dateTime(s.lastPunch.punched_at)}` : "—" }, { label: "Today", value: s?.today ? label(String(s.today.status)) : "Nothing recorded" }]} />
      <div className="flex gap-2">
        <Button variant="primary" onPress={() => punch.mutate("in")} isLoading={punch.isPending && punch.variables === "in"} isDisabled={!s || s.checkedIn}>Check in</Button>
        <Button variant="secondary" onPress={() => punch.mutate("out")} isLoading={punch.isPending && punch.variables === "out"} isDisabled={!s || !s.checkedIn}>Check out</Button>
      </div>
      <Register config={REGISTERS["my-attendance"]} />
    </div>
  );
}

// Leave administration: run the monthly accrual, run the year-end carry forward.
export function LeaveAdminScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const can = useCan();
  const [asOf, setAsOf] = useState("");
  const [year, setYear] = useState(new Date().getFullYear() - 1);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const done = (message: string) => { setError(null); setResult(message); queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "hr") }); };
  const fail = (e: unknown) => { setResult(null); setError(e instanceof HrApiError ? e.message : "This could not be run."); };
  const accrual = useMutation({
    mutationFn: () => act<{ record: Record<string, number> }>("leave-accrual-run", asOf ? { asOf } : {}),
    onSuccess: (r) => done(`Accrual for ${r.record.leaveYear}: ${r.record.credits} credit(s), ${r.record.totalDays} day(s), ${r.record.employeesProcessed} employee(s) looked at. Running it again credits nothing new.`),
    onError: fail,
  });
  const carry = useMutation({
    mutationFn: () => act<{ record: Record<string, number> }>("leave-carry-forward-run", { leaveYear: year }),
    onSuccess: (r) => done(`Leave year ${r.record.leaveYear}: ${r.record.carriedForward} day(s) carried forward, ${r.record.lapsed} lapsed, ${r.record.balancesProcessed} balance(s) processed.`),
    onError: fail,
  });
  if (!can("hr_payroll.leave.manage")) return <PermissionState title="You don't have access to leave administration" description="Ask an administrator to grant hr_payroll.leave.manage." />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Leave administration" description="Credit leave under each policy and close a leave year. Both are safe to repeat: each credit is recorded once per period." />
      {result && <HrAlert tone="success">{result}</HrAlert>}
      {error && <HrAlert>{error}</HrAlert>}
      <HrPanel title="Accrue leave" description="Credits every current employee's policy entitlements up to the date (monthly, quarterly, yearly or upfront), pro-rated for joiners and capped at the policy maximum.">
        <div className="flex flex-wrap items-end gap-3">
          <TextField label="As of (blank for today)" type="date" value={asOf} onChange={setAsOf} />
          <Button variant="primary" onPress={() => accrual.mutate()} isLoading={accrual.isPending}>Run accrual</Button>
        </div>
      </HrPanel>
      <HrPanel title="Year-end carry forward" description="After a leave year ends: what a leave type allows (up to its limit) moves to the next year; the rest lapses. Leave types that do not carry forward lapse entirely.">
        <div className="flex flex-wrap items-end gap-3">
          <NumberField label="Leave year" value={year} minValue={2000} step={1} onChange={(n) => setYear(Number.isNaN(n) ? year : n)} />
          <Button variant="secondary" onPress={() => carry.mutate()} isLoading={carry.isPending}>Run carry forward</Button>
        </div>
      </HrPanel>
    </div>
  );
}
