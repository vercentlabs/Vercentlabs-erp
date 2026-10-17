"use client";

// Projects — My Timesheets: one week at a time (switchable), its hours by day, the daily view (one day's entries by project and task) and
// the weekly view (every entry), logging and changing unsubmitted time, submitting the week, its submissions with their decisions, and
// asking for a correction of approved time.
import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, ErrorState, LinkButton, MetricStrip, PageHeader, PermissionState, StatusBadge, Tab, TabList, Tabs } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { errorMessage, errorStatus } from "../api/projects-api";
import { TimeEntryDialog } from "./TimeEntryDialog";
import { CorrectionDialog, EntryTable, RemoveEntryDialog, SubmitWeekDialog, WeekBars } from "./TimeViews";
import { SUBMISSION_TONE, TIMESHEETS_BASE, getWeek, hours, removeEntry, timeExportHref, weekLabel, type TimeEntry, type Warning } from "./timesheets-api";

const STATUS_TEXT = { DRAFT: "Draft", SUBMITTED: "Submitted", APPROVED: "Approved", MIXED: "In review", EMPTY: "No time yet" } as const;
const STATUS_TONE = { DRAFT: "neutral", SUBMITTED: "info", APPROVED: "success", MIXED: "info", EMPTY: "neutral" } as const;

export function MyTimesheetScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const [weekParam, setWeekParam] = useState(params.get("week") ?? undefined);
  const [mode, setMode] = useState<"week" | "day" | "billable">("week");
  const [day, setDay] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{ kind: "log" | "edit" | "remove" | "correct" | "submit"; entry?: TimeEntry } | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "warning" | "danger"; text: string } | null>(null);
  const week = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "time-week", weekParam ?? "current"), queryFn: () => getWeek(weekParam) });
  if (week.isLoading) return <LoadingState label="Loading your timesheet" rows={8} />;
  if (week.error && errorStatus(week.error) === 403) return <PermissionState title="You don't record project time" description="Ask an administrator for access to project timesheets." />;
  if (week.isError || !week.data) return <ErrorState title="Could not load your timesheet" description={errorMessage(week.error)} action={{ label: "Try again", onPress: () => void week.refetch() }} />;
  const data = week.data;
  const go = (next: string) => { setWeekParam(next); setDay(null); router.replace(`${pathname}?week=${next}`); };
  const refresh = async (text: string, warnings: Warning[] = []) => {
    await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") });
    setMessage({ tone: warnings.length ? "warning" : "success", text: warnings.length ? `${text} ${warnings.map((row) => row.message).join(" ")}` : text });
  };
  const selectedDay = day ?? (data.days.find((row) => row.today)?.date ?? data.weekStart);
  const dayEntries = data.entries.filter((entry) => entry.workDate === selectedDay);
  const live = data.entries.filter((entry) => entry.status !== "VOIDED");
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="My Timesheets" description="The time you worked on projects. Save drafts through the week, review the totals, then submit it for approval."
        primaryAction={data.can.record ? <Button variant="primary" onPress={() => setDialog({ kind: "log" })}>Log time</Button> : undefined}
        secondaryActions={<>
          {data.can.submit && <Button variant="secondary" onPress={() => setDialog({ kind: "submit" })}>Submit week</Button>}
          {data.can.export && <LinkButton variant="ghost" href={timeExportHref({ from: data.weekStart, to: data.weekEnd, status: "ALL" })}>Export</LinkButton>}
        </>} />
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2">
          <Button variant="ghost" size="compact" onPress={() => go(data.previousWeek)} aria-label="Previous week">‹</Button>
          <span className="font-medium">{`Week of ${weekLabel(data.weekStart, data.weekEnd)}`}</span>
          <Button variant="ghost" size="compact" onPress={() => go(data.nextWeek)} aria-label="Next week" isDisabled={data.nextWeek > data.today}>›</Button>
          {weekParam && <Button variant="ghost" size="compact" onPress={() => go(data.today)}>This week</Button>}
        </span>
        <StatusBadge tone={STATUS_TONE[data.status]}>{STATUS_TEXT[data.status]}</StatusBadge>
      </div>
      {data.late && <Notice tone="warning">{`This week was due by ${data.deadline}. ${data.summary}`}</Notice>}
      <MetricStrip metrics={[{ label: "Total recorded", value: data.totals.total }, { label: "Billable", value: data.totals.billable }, { label: "Non-billable", value: data.totals.nonBillable },
        { label: "Not yet submitted", value: hours(data.totals.unsubmittedMinutes) }]} />
      <Panel title="Hours by day" description={`Days above ${hours(data.policy.dailyReviewMinutes)} are checked by your reviewer. A short week is fine: hours differ by role and schedule.`}>
        <WeekBars week={data} selected={mode === "day" ? selectedDay : null} onDay={(date) => { setDay(date); setMode("day"); }} />
      </Panel>
      <Tabs selectedKey={mode} onSelectionChange={(value) => setMode(String(value) as "week" | "day" | "billable")}>
        <TabList aria-label="View"><Tab id="week">Weekly</Tab><Tab id="day">Daily</Tab><Tab id="billable">Billable / Non-billable</Tab></TabList>
      </Tabs>
      {mode === "billable" ? (
        <Panel title="Billable and non-billable time" description="Classified billable is not yet approved, and approved is not invoiced; the classification is checked against each project's billing policy.">
          <LinesTable columns={["Classification", { label: "Recorded", numeric: true }, { label: "Awaiting approval", numeric: true }, { label: "Approved", numeric: true }]}>
            {["TIME_AND_MATERIALS_ELIGIBLE", "ELIGIBILITY_PENDING", "INCLUDED_IN_FIXED_FEE", "NON_BILLABLE"].map((code) => {
              const rows = live.filter((entry) => entry.classification === code);
              if (!rows.length) return null;
              const sum = (list: TimeEntry[]) => hours(list.reduce((total, entry) => total + entry.durationMinutes, 0));
              return <tr key={code}><Cell>{rows[0].classificationLabel}</Cell><Cell numeric>{sum(rows)}</Cell><Cell numeric>{sum(rows.filter((entry) => entry.status !== "APPROVED"))}</Cell>
                <Cell numeric>{sum(rows.filter((entry) => entry.status === "APPROVED"))}</Cell></tr>;
            })}
          </LinesTable>
        </Panel>
      ) : mode === "week" ? (
        <Panel title="This week's time" description={data.summary}>
          <EntryTable entries={data.entries} empty="No time recorded this week."
            onEdit={(entry) => setDialog({ kind: "edit", entry })} onRemove={(entry) => setDialog({ kind: "remove", entry })} onCorrect={(entry) => setDialog({ kind: "correct", entry })} />
        </Panel>
      ) : (
        <Panel title={`${data.days.find((row) => row.date === selectedDay)?.weekday ?? ""} ${selectedDay}`} description={`${hours(dayEntries.filter((e) => e.status !== "VOIDED").reduce((s, e) => s + e.durationMinutes, 0))} recorded`}
          actions={data.can.record ? <Button variant="secondary" size="compact" onPress={() => setDialog({ kind: "log" })}>Log time for this day</Button> : undefined}>
          <EntryTable entries={dayEntries} showDate={false} empty="No time recorded on this day."
            onEdit={(entry) => setDialog({ kind: "edit", entry })} onRemove={(entry) => setDialog({ kind: "remove", entry })} onCorrect={(entry) => setDialog({ kind: "correct", entry })} />
        </Panel>
      )}
      {data.projects.length > 0 && (
        <Panel title="By project" description="Each project's time is reviewed by its manager.">
          <LinesTable columns={["Project", { label: "Recorded", numeric: true }, { label: "Billable", numeric: true }, { label: "Unsubmitted", numeric: true }, "Review"]}>
            {data.projects.map((row) => (
              <tr key={row.projectId}>
                <Cell>{row.project}</Cell><Cell numeric>{row.total}</Cell><Cell numeric>{row.billable}</Cell><Cell numeric>{hours(row.unsubmittedMinutes)}</Cell>
                <Cell>{row.submission ? <Link className="text-brand underline" href={`${TIMESHEETS_BASE}/${row.submission.id}`}>
                  <StatusBadge tone={SUBMISSION_TONE[row.submission.status]}>{`${row.submission.statusLabel}${row.submission.version > 1 ? ` (v${row.submission.version})` : ""}`}</StatusBadge></Link> : "Not submitted"}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
      )}
      {data.submissions.length > 0 && (
        <Panel title="Submission history" description="Every version of this week's submissions, with the reviewer's decision.">
          <LinesTable columns={["Submission", "Project", "Version", "Submitted", "Decision", "Comment"]}>
            {data.submissions.map((row) => (
              <tr key={row.id}>
                <Cell><Link className="text-brand underline" href={`${TIMESHEETS_BASE}/${row.id}`}>{row.number}</Link></Cell><Cell>{row.project}</Cell><Cell>{row.version}</Cell>
                <Cell>{formatDateTime(row.submittedAt)}</Cell>
                <Cell><StatusBadge tone={SUBMISSION_TONE[row.status]}>{row.statusLabel}</StatusBadge>{row.decidedBy && <span className="block text-xs text-text-muted">{row.decidedBy}</span>}</Cell>
                <Cell>{row.comment ?? "—"}</Cell>
              </tr>
            ))}
          </LinesTable>
        </Panel>
      )}
      {live.length === 0 && !data.submissions.length && <p className="text-sm text-text-muted">Nothing is recorded this week. Missing time is never filled in for you.</p>}
      {(dialog?.kind === "log" || dialog?.kind === "edit") && (
        <TimeEntryDialog entry={dialog.kind === "edit" ? dialog.entry : null} date={mode === "day" ? selectedDay : undefined} onClose={() => setDialog(null)} onSaved={refresh} />
      )}
      {dialog?.kind === "remove" && dialog.entry && <RemoveEntryDialog entry={dialog.entry} onClose={() => setDialog(null)}
        onConfirm={async () => { await removeEntry(dialog.entry!.id, { expectedVersion: dialog.entry!.version }); await refresh("Removed."); }} />}
      {dialog?.kind === "correct" && dialog.entry && <CorrectionDialog entry={dialog.entry} onClose={() => setDialog(null)} onDone={(text) => refresh(text)} />}
      {dialog?.kind === "submit" && <SubmitWeekDialog week={data} onClose={() => setDialog(null)} onDone={(text) => refresh(text)} />}
    </div>
  );
}
