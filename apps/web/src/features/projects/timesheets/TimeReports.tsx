"use client";

// Projects — Timesheets reports, as a set of Project Reports: hours by employee, project, task and manager, billable and non-billable, the
// approval pipeline, unsubmitted and missing time (missing is never zero hours), exceptions, late submissions, labor cost, unbilled and
// invoiced time, corrections, and one's own summary. They read the same approved records the timesheets hold.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Select, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage } from "../api/projects-api";
import { getTimeSettings, hours, saveTimeSettings, type TimeSettings } from "./timesheets-api";

export const TIME_REPORT_TABS = [{ id: "tm-project-hours", label: "Project time" }, { id: "tm-employee-hours", label: "Employee hours" }, { id: "tm-task-hours", label: "Task hours" },
  { id: "tm-approval-status", label: "Approved vs pending" }, { id: "tm-unsubmitted", label: "Unsubmitted" }, { id: "tm-exceptions", label: "Timesheet exceptions" },
  { id: "tm-late", label: "Late submissions" }, { id: "tm-labor-cost", label: "Labor cost" },
  { id: "tm-corrections", label: "Corrections" }, { id: "tm-by-manager", label: "By project manager" }, { id: "tm-my-summary", label: "My summary" }];

type Row = Record<string, unknown>;
const s = (value: unknown) => (value === null || value === undefined ? "" : String(value));
const h = (value: unknown) => (value === null || value === undefined ? "—" : hours(Number(value)));
const project = (row: Row) => `${s(row.project_code)}${row.project_name ? ` · ${s(row.project_name)}` : ""}`;
const STATUS = { DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested" } as Record<string, string>;
const FLAG = { DAILY_TOTAL_REVIEW: "Long day", BOUNDARY_DAY_REVIEW: "Hold or close day", POSSIBLE_DUPLICATE: "Possible duplicate", LATE: "Late", TASK_CANCELLED: "Cancelled task", NO_RATE: "No labor rate" } as Record<string, string>;

export function TimeReport({ kind, rows }: { kind: string; rows: Row[] }) {
  switch (kind) {
    case "tm-project-hours": return (
      <LinesTable columns={["Project", { label: "Recorded", numeric: true }, { label: "Approved", numeric: true }, { label: "Billable", numeric: true }, { label: "Non-billable", numeric: true }, { label: "People", numeric: true }]}>
        {rows.map((row) => <tr key={s(row.project_id)}><Cell>{project(row)}</Cell><Cell numeric>{h(row.total)}</Cell><Cell numeric>{h(row.approved)}</Cell>
          <Cell numeric>{h(row.billable)}</Cell><Cell numeric>{h(row.non_billable)}</Cell><Cell numeric>{s(row.people)}</Cell></tr>)}
      </LinesTable>
    );
    case "tm-employee-hours": return (
      <LinesTable columns={["Employee", { label: "Recorded", numeric: true }, { label: "Approved", numeric: true }, { label: "Awaiting review", numeric: true }, { label: "Unsubmitted", numeric: true }, { label: "Billable", numeric: true }, { label: "Projects", numeric: true }]}>
        {rows.map((row) => <tr key={s(row.employee_user_id)}><Cell>{s(row.employee_user_id_name)}</Cell><Cell numeric>{h(row.total)}</Cell><Cell numeric>{h(row.approved)}</Cell><Cell numeric>{h(row.pending)}</Cell>
          <Cell numeric>{h(row.unsubmitted)}</Cell><Cell numeric>{h(row.billable)}</Cell><Cell numeric>{s(row.projects)}</Cell></tr>)}
      </LinesTable>
    );
    case "tm-task-hours": return (
      <LinesTable columns={["Project", "Task", { label: "Estimate", numeric: true }, { label: "Recorded", numeric: true }, { label: "Approved", numeric: true }]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.project_code)}</Cell><Cell>{`${s(row.task_code)} ${s(row.task_title)}`.trim()}</Cell><Cell numeric>{h(row.estimate_minutes)}</Cell>
          <Cell numeric>{h(row.total)}</Cell><Cell numeric>{h(row.approved)}</Cell></tr>)}
      </LinesTable>
    );
    case "tm-approval-status": return (
      <LinesTable columns={["Status", { label: "Hours", numeric: true }, { label: "Entries", numeric: true }]}>
        {rows.map((row) => <tr key={s(row.status)}><Cell>{STATUS[s(row.status)] ?? s(row.status)}</Cell><Cell numeric>{h(row.total)}</Cell><Cell numeric>{s(row.entries)}</Cell></tr>)}
      </LinesTable>
    );
    case "tm-unsubmitted": return (
      <LinesTable columns={["Employee", "Project", "Week", "Time"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{s(row.employee_user_id_name)}</Cell><Cell>{project(row)}</Cell><Cell>{s(row.week)}</Cell>
          <Cell>{row.state === "NO_TIME" ? "No time recorded" : `${h(row.unsubmitted)} recorded — submission pending${row.stale ? " (stale draft)" : ""}`}</Cell></tr>)}
      </LinesTable>
    );
    case "tm-exceptions": return (
      <LinesTable columns={["Entry", "Employee", "Project", "Date", { label: "Duration", numeric: true }, "Status", "Why"]}>
        {rows.map((row) => <tr key={s(row.id)}><Cell>{`TE-${s(row.entry_number)}`}</Cell><Cell>{s(row.employee_user_id_name)}</Cell><Cell>{s(row.project_code)}</Cell><Cell>{s(row.work_date)}</Cell>
          <Cell numeric>{h(row.duration_minutes)}</Cell><Cell>{STATUS[s(row.entry_status)] ?? s(row.entry_status)}</Cell>
          <Cell>{((row.review_flags as string[]) ?? []).filter((flag) => flag !== "DELEGATED").map((flag) => FLAG[flag] ?? flag).join(", ")}</Cell></tr>)}
      </LinesTable>
    );
    case "tm-late": return (
      <LinesTable columns={["Employee", "Project", "Week", { label: "Hours", numeric: true }, "Submitted", "Reason", "Status"]}>
        {rows.map((row) => <tr key={s(row.id)}><Cell>{s(row.employee_user_id_name)}</Cell><Cell>{s(row.project_code)}</Cell><Cell>{s(row.week)}</Cell><Cell numeric>{h(row.total_minutes)}</Cell>
          <Cell>{formatDateTime(s(row.submitted_at))}</Cell><Cell>{s(row.late_reason)}</Cell><Cell>{STATUS[s(row.status)] ?? s(row.status)}</Cell></tr>)}
      </LinesTable>
    );
    case "tm-labor-cost": return (
      <LinesTable columns={["Project", "Employee", { label: "Approved", numeric: true }, { label: "Cost", numeric: true }, "Without a rate"]}>
        {rows.map((row, index) => <tr key={index}><Cell>{project(row)}</Cell><Cell>{s(row.employee_user_id_name)}</Cell><Cell numeric>{h(row.approved)}</Cell>
          <Cell numeric>{row.cost === null ? "—" : `${s(row.cost)} ${s(row.currency)}`}</Cell><Cell>{Number(row.without_rate) ? `${s(row.without_rate)} entr${Number(row.without_rate) === 1 ? "y" : "ies"}` : "—"}</Cell></tr>)}
      </LinesTable>
    );
    case "tm-corrections": return (
      <LinesTable columns={["Correction", "Employee", "Project", "Kind", "Reason", "Status", "Requested by", "Decided by"]}>
        {rows.map((row) => <tr key={s(row.id)}><Cell>{`TC-${s(row.correction_number)}`}</Cell><Cell>{s(row.employee_user_id_name)}</Cell><Cell>{s(row.project_code)}</Cell><Cell>{s(row.kind).toLowerCase()}</Cell>
          <Cell>{s(row.reason)}</Cell><Cell>{s(row.status).toLowerCase()}</Cell><Cell>{s(row.requested_by_name)}</Cell><Cell>{s(row.decided_by_name) || "—"}</Cell></tr>)}
      </LinesTable>
    );
    case "tm-by-manager": return (
      <LinesTable columns={["Project Manager", { label: "Projects", numeric: true }, { label: "Recorded", numeric: true }, { label: "Approved", numeric: true }, { label: "Awaiting review", numeric: true }]}>
        {rows.map((row) => <tr key={s(row.manager_user_id)}><Cell>{s(row.manager_user_id_name) || "No manager"}</Cell><Cell numeric>{s(row.projects)}</Cell><Cell numeric>{h(row.total)}</Cell>
          <Cell numeric>{h(row.approved)}</Cell><Cell numeric>{h(row.pending)}</Cell></tr>)}
      </LinesTable>
    );
    case "tm-my-summary": return (
      <LinesTable columns={["Week", { label: "Recorded", numeric: true }, { label: "Billable", numeric: true }, { label: "Approved", numeric: true }, { label: "Awaiting review", numeric: true }, { label: "Unsubmitted", numeric: true }]}>
        {rows.map((row) => <tr key={s(row.week)}><Cell>{s(row.week)}</Cell><Cell numeric>{h(row.total)}</Cell><Cell numeric>{h(row.billable)}</Cell><Cell numeric>{h(row.approved)}</Cell>
          <Cell numeric>{h(row.pending)}</Cell><Cell numeric>{h(row.unsubmitted)}</Cell></tr>)}
      </LinesTable>
    );
    default: return null;
  }
}

const WEEKDAYS = [["1", "Monday"], ["2", "Tuesday"], ["3", "Wednesday"], ["4", "Thursday"], ["5", "Friday"], ["6", "Saturday"], ["7", "Sunday"]].map(([value, label]) => ({ value, label }));
// The company's time policy, in Project Settings.
export function TimeSettingsPanel() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-settings"), queryFn: getTimeSettings });
  const [draft, setDraft] = useState<Partial<TimeSettings> | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (settings.isLoading) return <LoadingState label="Loading the time policy" rows={3} />;
  if (!settings.data) return <Notice tone="danger">{errorMessage(settings.error)}</Notice>;
  const value = { ...settings.data, ...draft };
  const set = (patch: Partial<TimeSettings>) => setDraft({ ...draft, ...patch });
  const manage = settings.data.can.manage;
  const save = async () => {
    setBusy(true); setMessage(null);
    try { await saveTimeSettings(draft ?? {}); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setDraft(null); setMessage({ tone: "success", text: "Time policy saved." }); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  return (
    <Panel title="Timesheets" description={`Weeks, daily limits, rounding and deadlines for project time (company time zone ${settings.data.timezone}).`}>
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Select label="Week starts on" isDisabled={!manage} selectedKey={String(value.weekStart)} onSelectionChange={(key) => set({ weekStart: Number(key) })} options={WEEKDAYS} />
        <TextField label="Review a day above (hours)" isDisabled={!manage} inputMode="decimal" value={String(value.dailyReviewMinutes / 60)} onChange={(next) => set({ dailyReviewMinutes: Math.round(Number(next) * 60) })}
          description="A warning for the reviewer, never a refusal." />
        <TextField label="Refuse a day above (hours)" isDisabled={!manage} inputMode="decimal" value={String(value.dailyLimitMinutes / 60)} onChange={(next) => set({ dailyLimitMinutes: Math.round(Number(next) * 60) })} />
        <Select label="Record in steps of" isDisabled={!manage} selectedKey={String(value.incrementMinutes)} onSelectionChange={(key) => set({ incrementMinutes: Number(key) })}
          options={["1", "5", "6", "10", "15", "30"].map((n) => ({ value: n, label: `${n} minute${n === "1" ? "" : "s"}` }))} description="Nothing is rounded: other values are refused." />
        <TextField label="Submission due (days after the week)" isDisabled={!manage} inputMode="numeric" value={String(value.deadlineDays)} onChange={(next) => set({ deadlineDays: Number(next) })} />
        <Select label="Date-only time on a hold or close day" isDisabled={!manage} selectedKey={value.boundaryDayPolicy} onSelectionChange={(key) => set({ boundaryDayPolicy: String(key) as "REVIEW" | "BLOCK" })}
          options={[{ value: "REVIEW", label: "Accept, flagged for review" }, { value: "BLOCK", label: "Require start and end times" }]} />
      </div>
      <div className="flex flex-col gap-2">
        <Checkbox isDisabled={!manage} isSelected={value.lateAllowed} onChange={(on) => set({ lateAllowed: on })}>Allow late submissions (with the reason)</Checkbox>
        <Checkbox isDisabled={!manage} isSelected={value.collaboratorsAllowed} onChange={(on) => set({ collaboratorsAllowed: on })}>Team members other than the assignee record time on a task</Checkbox>
      </div>
      {manage && <div className="flex justify-end"><Button variant="primary" isLoading={busy} isDisabled={busy || !draft} onPress={save}>Save time policy</Button></div>}
    </Panel>
  );
}
