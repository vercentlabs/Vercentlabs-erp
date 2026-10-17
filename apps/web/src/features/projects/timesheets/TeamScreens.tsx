"use client";

// Projects — Timesheets for managers and finance: the team's week (who recorded what, what waits for submission or review, and who recorded
// nothing — shown as missing, never as zero hours), reminders, corrections of approved time and their decisions, and the internal labor
// rates (effective-dated; history never rewritten).
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ComboBox, Dialog, EmptyState, ErrorState, MetricStrip, PageHeader, PermissionState, StatusBadge, Tab, TabList, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus, getOptions, newKey } from "../api/projects-api";
import {
  SUBMISSION_TONE, TIMESHEETS_BASE, decideCorrection, getCorrections, getRates, getTeamWeek, hours, recoverCosting, remind, runTimeCommand, setRate, weekLabel, type Correction, type TeamRow,
} from "./timesheets-api";

const STATE = { NO_TIME: ["neutral", "No time recorded"], LATE: ["danger", "Late"], PENDING_SUBMISSION: ["warning", "Submission pending"], AWAITING_REVIEW: ["info", "Awaiting review"],
  APPROVED: ["success", "Approved"] } as const;

export function TeamTimesheetsScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [week, setWeek] = useState(params.get("week") ?? undefined);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const team = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-team", week ?? "current"), queryFn: () => getTeamWeek(week), retry: false });
  if (team.error && errorStatus(team.error) === 403) return <PermissionState title="You don't see team time" description="Project managers see the time recorded on the projects they lead." />;
  if (team.isLoading) return <LoadingState label="Loading the team's week" rows={8} />;
  if (team.isError || !team.data) return <ErrorState title="Could not load the team's week" description={errorMessage(team.error)} />;
  const data = team.data;
  const go = (next: string) => { setWeek(next); router.replace(`${pathname}?week=${next}`); };
  const nudge = async (row: TeamRow) => {
    try {
      const result = await remind({ employeeUserId: row.employeeUserId, projectId: row.projectId, weekStart: data.weekStart });
      setMessage({ tone: "success", text: result.sent ? `${row.employee} was reminded.` : `${row.employee} was already reminded today.` });
    } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Team Timesheets" description="The time your teams recorded this week. Fewer hours is not underperformance: schedules, leave and roles differ."
        secondaryActions={<Button variant="secondary" onPress={() => router.push(`${TIMESHEETS_BASE}/approvals`)}>Pending approvals</Button>} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <span className="flex items-center gap-2">
        <Button variant="ghost" size="compact" onPress={() => go(data.previousWeek)} aria-label="Previous week">‹</Button>
        <span className="font-medium">{`Week of ${weekLabel(data.weekStart, data.weekEnd)}`}</span>
        <Button variant="ghost" size="compact" onPress={() => go(data.nextWeek)} aria-label="Next week">›</Button>
        <span className="text-xs text-text-muted">{`Due by ${data.deadline}`}</span>
      </span>
      <MetricStrip metrics={[{ label: "Recorded", value: hours(data.totals.recordedMinutes) }, { label: "Submission pending", value: hours(data.totals.unsubmittedMinutes) },
        { label: "Awaiting review", value: hours(data.totals.submittedMinutes) }, { label: "Approved", value: hours(data.totals.approvedMinutes) }]} />
      {data.rows.length === 0 ? <EmptyState title="No team time this week" description="Time appears here for the running projects you lead." /> : (
        <Panel>
          <LinesTable columns={["Employee", "Project", "This week", "State", "Submission", ""]}>
            {data.rows.map((row) => (
              <tr key={`${row.projectId}:${row.employeeUserId}`}>
                <Cell>{row.employee ?? "—"}</Cell><Cell>{row.project}</Cell><Cell>{row.summary}</Cell>
                <Cell><StatusBadge tone={STATE[row.state][0]}>{STATE[row.state][1]}</StatusBadge></Cell>
                <Cell>{row.submission ? <Link className="text-brand underline" href={`${TIMESHEETS_BASE}/${row.submission.id}`}><StatusBadge tone={SUBMISSION_TONE[row.submission.status]}>{row.submission.statusLabel}</StatusBadge></Link> : "—"}</Cell>
                <Cell>{(row.state === "NO_TIME" || row.state === "PENDING_SUBMISSION" || row.state === "LATE") && <Button size="compact" variant="ghost" onPress={() => nudge(row)}>Remind</Button>}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
      )}
    </div>
  );
}

const CORRECTION_TONE = { REQUESTED: "info", APPLIED: "success", REJECTED: "neutral" } as const;
const value = (values: Record<string, unknown>, field: string) => (field === "durationMinutes" ? hours(Number(values[field] ?? 0)) : field === "billable" ? (values[field] ? "Billable" : "Non-billable") : String(values[field] ?? "—"));

export function CorrectionsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState("REQUESTED");
  const [deciding, setDeciding] = useState<{ row: Correction; action: "approve" | "reject" } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const list = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-corrections", status), queryFn: () => getCorrections(status === "ALL" ? undefined : status) });
  const rows = list.data?.rows ?? [];
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Time Corrections" description="Approved time is never edited: a correction is requested with the reason, decided by someone else, and appended — the original stays." />
      {message && <Notice tone="success">{message}</Notice>}
      <Tabs selectedKey={status} onSelectionChange={(key) => setStatus(String(key))}>
        <TabList aria-label="Corrections"><Tab id="REQUESTED">Waiting</Tab><Tab id="APPLIED">Applied</Tab><Tab id="REJECTED">Rejected</Tab><Tab id="ALL">All</Tab></TabList>
      </Tabs>
      {list.isLoading && <LoadingState label="Loading corrections" rows={5} />}
      {list.isError && <ErrorState title="Could not load corrections" description={errorMessage(list.error)} />}
      {list.data && (rows.length === 0 ? <EmptyState title="No corrections here." description="Corrections of approved time appear here." /> : (
        <Panel>
          <LinesTable columns={["Correction", "Employee", "Project", "Change", "Reason", "Status", ""]}>
            {rows.map((row) => (
              <tr key={row.id}>
                <Cell><span className="flex flex-col"><span>{row.number}</span><span className="text-xs text-text-muted">{`${row.entryNumber} · ${formatDateTime(row.requestedAt)}`}</span></span></Cell>
                <Cell>{row.employee ?? "—"}</Cell><Cell>{row.project}</Cell>
                <Cell>{row.kind === "VOID" ? "Void the time" : (
                  <span className="flex flex-col text-xs">{["durationMinutes", "workDate", "billable", "projectId"].filter((field) => String(row.original[field] ?? "") !== String(row.proposed[field] ?? ""))
                    .map((field) => <span key={field}>{field === "projectId" ? "Moved to another project" : `${value(row.original, field)} → ${value(row.proposed, field)}`}</span>)}</span>)}
                  {row.billingAdjustmentRequired && <span className="block text-xs text-warning">{row.billingAdjustmentReference ? `Billing adjusted: ${row.billingAdjustmentReference}` : "Billed: needs Sales's adjustment"}</span>}
                  {row.costAdjustment?.delta && <span className="block text-xs text-text-muted">{`Cost change ${row.costAdjustment.delta} ${row.costAdjustment.currency ?? ""}`}</span>}</Cell>
                <Cell>{row.reason}{row.decisionNote && <span className="block text-xs text-text-muted">{`${row.decidedBy}: ${row.decisionNote}`}</span>}</Cell>
                <Cell><StatusBadge tone={CORRECTION_TONE[row.status]}>{row.status === "REQUESTED" ? "Waiting" : row.status === "APPLIED" ? "Applied" : "Rejected"}</StatusBadge></Cell>
                <Cell>{row.can.decide && <span className="flex gap-1"><Button size="compact" variant="secondary" onPress={() => setDeciding({ row, action: "approve" })}>Approve</Button>
                  <Button size="compact" variant="ghost" onPress={() => setDeciding({ row, action: "reject" })}>Reject</Button></span>}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
      ))}
      {deciding && <CorrectionDecision {...deciding} onClose={() => setDeciding(null)} onDone={async (text) => { await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") }); setMessage(text); }} />}
    </div>
  );
}

function CorrectionDecision({ row, action, onClose, onDone }: { row: Correction; action: "approve" | "reject"; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [note, setNote] = useState("");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  const approve = action === "approve";
  const submit = async () => {
    setBusy(true); setError(null);
    try {
      await runTimeCommand(key, () => decideCorrection(row.id, action, { note: note || undefined, billingAdjustmentReference: reference || undefined, expectedVersion: row.version, idempotencyKey: key }));
      await onDone(approve ? "The correction is applied; the original is kept as voided." : "The correction was rejected.");
      onClose();
    } catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(open) => { if (!open) onClose(); }} title={`${approve ? "Approve" : "Reject"} ${row.number}`} description={row.reason}>
      <div className="flex flex-col gap-3">
        {approve && row.billingAdjustmentRequired && (
          <TextField label="Sales adjustment reference" value={reference} onChange={setReference} isRequired
            description="This time was invoiced. Name the credit note or invoice correction that adjusts it; the billing is reversed with that reference." />
        )}
        <TextArea label={approve ? "Note (optional)" : "Why not?"} value={note} onChange={setNote} isRequired={!approve} />
        {error && <Notice tone="danger">{error}</Notice>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onPress={onClose}>Cancel</Button>
          <Button variant={approve ? "primary" : "danger"} isLoading={busy} isDisabled={busy || (!approve && note.trim().length < 3) || (approve && row.billingAdjustmentRequired && !reference.trim())} onPress={submit}>
            {approve ? "Apply correction" : "Reject"}</Button>
        </div>
      </div>
    </Dialog>
  );
}

export function LaborRatesScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const rates = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-rates"), queryFn: () => getRates(), retry: false });
  const options = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "options"), queryFn: getOptions, staleTime: 60_000 });
  const [form, setForm] = useState({ userId: null as string | null, hourlyRate: "", effectiveFrom: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (rates.error && errorStatus(rates.error) === 403) return <PermissionState title="Labor rates are confidential" description="Finance keeps the internal cost rates; ask for cost visibility if you need them." />;
  const manage = rates.data?.can.manage ?? false;
  const save = async () => {
    setBusy(true); setMessage(null);
    try {
      const result = await setRate({ userId: form.userId, hourlyRate: Number(form.hourlyRate), effectiveFrom: form.effectiveFrom, reason: form.reason || undefined });
      await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects", "time-rates") });
      setMessage({ tone: "success", text: `Rate version ${result.version} saved. Approved time keeps the rate it was costed at.` });
      setForm({ userId: null, hourlyRate: "", effectiveFrom: "", reason: "" });
    } catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  const recover = async () => {
    try { const result = await recoverCosting(); setMessage({ tone: "success", text: `${result.costed} approved entr${result.costed === 1 ? "y" : "ies"} costed; ${result.stillMissing} still without a rate.` }); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Labor Rates" description="Internal hourly cost rates for project time — not salaries, and nothing is paid from them. A new rate applies from its date; earlier approved time keeps its rate."
        secondaryActions={manage ? <Button variant="secondary" onPress={recover}>Cost time approved without a rate</Button> : undefined} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {manage && (
        <Panel title="New rate" description="The previous open rate of the same person ends the day before.">
          <div className="grid gap-3 sm:grid-cols-4">
            <ComboBox label="Employee" placeholder="Search people" selectedKey={form.userId} onSelectionChange={(key) => setForm({ ...form, userId: key ? String(key) : null })}
              options={(options.data?.users ?? []).map((user) => ({ value: user.id, label: user.name }))} />
            <TextField label="Hourly rate" inputMode="decimal" value={form.hourlyRate} onChange={(next) => setForm({ ...form, hourlyRate: next })} />
            <TextField label="Effective from" type="date" value={form.effectiveFrom} onChange={(next) => setForm({ ...form, effectiveFrom: next })} />
            <TextField label="Reason" value={form.reason} onChange={(next) => setForm({ ...form, reason: next })} />
          </div>
          <div className="flex justify-end"><Button variant="primary" isLoading={busy} isDisabled={busy || !form.userId || !form.hourlyRate || !form.effectiveFrom} onPress={save}>Save rate</Button></div>
        </Panel>
      )}
      {rates.isLoading ? <LoadingState label="Loading rates" rows={5} /> : (
        <Panel title="Rates">
          <LinesTable empty="No rates yet. Approved time without a rate is costed once one is added." columns={["Employee", "Project", { label: "Hourly rate", numeric: true }, "From", "To", "Version", "Reason"]}>
            {(rates.data?.rows ?? []).map((row) => (
              <tr key={row.id}><Cell>{row.employee}</Cell><Cell>{row.project ?? "All projects"}</Cell><Cell numeric>{`${row.hourlyRate} ${row.currency}`}</Cell><Cell>{row.effectiveFrom}</Cell>
                <Cell>{row.effectiveTo ?? "Open"}</Cell><Cell>{row.version}</Cell><Cell>{row.reason ?? "—"}</Cell></tr>
            ))}
          </LinesTable>
        </Panel>
      )}
    </div>
  );
}
