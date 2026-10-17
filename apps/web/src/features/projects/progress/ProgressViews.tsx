"use client";

// Projects — Progress Tracking on screen. Every number says what it measures and opens the records behind it: task completion (done over
// all but the cancelled), required milestones accepted, the schedule, health with its reasons, effort used against estimate and scope
// against its baseline — never averaged into one figure. The trend and the change list explain why progress moved, including backwards.
// A colour is never the only signal: every bar carries its number and every state its word.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Checkbox, Dialog, EmptyState, ErrorState, LinkButton, PageHeader, PermissionState, Select, StatusBadge, Tab, TabList, Tabs, TextArea, TextField } from "@vercentlabs/design-system";

import { formatDateTime } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { Notice, Panel } from "@/shared/ui/Panel";
import { Cell, LinesTable } from "@/shared/ui/record";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { HEALTH_TONE, PROJECTS_BASE, dateLabel, errorMessage, errorStatus, newKey, type Health } from "../api/projects-api";
import {
  PROGRESS_BASE, captureBaseline, getPortfolio, getProgress, getProgressChanges, getProgressHistory, getProgressSettings, hoursLabel, percentLabel, progressExportHref, recordProgress,
  saveProgressSettings, type HistoryPoint, type PortfolioRow, type ProgressSummary,
} from "./progress-api";

const SCHEDULE_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  NOT_STARTED: "neutral", ON_SCHEDULE: "success", DUE_SOON: "warning", OVERDUE: "danger", ON_HOLD: "warning", COMPLETED_ON_TIME: "success", COMPLETED_LATE: "warning", CANCELLED: "neutral", NO_TARGET: "neutral",
};
const healthTone = (state: string) => HEALTH_TONE[state as Health] ?? "neutral";

// ------------------------------------------------------------------ small pieces
export function ProgressBar({ percent, label, size = "md" }: { percent: number | null; label: string; size?: "sm" | "md" }) {
  const value = percent ?? 0;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={percent === null ? "Not available" : percentLabel(percent)}
      className={`w-full overflow-hidden rounded-full bg-surface-muted ${size === "sm" ? "h-1.5" : "h-2.5"}`}>
      {percent !== null && <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${Math.max(value, value > 0 ? 2 : 0)}%` }} />}
    </div>
  );
}
function Stat({ label, value, note, href, tone }: { label: string; value: ReactNode; note?: ReactNode; href?: string; tone?: "danger" | "warning" }) {
  const body = (
    <>
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <span className={`text-lg font-semibold tabular-nums ${tone === "danger" ? "text-danger" : tone === "warning" ? "text-warning" : "text-text"}`}>{value}</span>
      {note && <span className="text-xs text-text-muted">{note}</span>}
    </>
  );
  const cls = "flex min-w-0 flex-col gap-0.5 rounded-lg border border-border bg-surface px-3 py-2.5";
  return href ? <Link href={href} className={`${cls} hover:border-brand-border hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-focus`}>{body}</Link> : <div className={cls}>{body}</div>;
}
// The trend as a small line chart: recorded figures solid, reconstructed (where nothing was recorded then) dashed.
export function TrendChart({ points }: { points: HistoryPoint[] }) {
  const usable = points.filter((point) => point.available && (point.recorded?.percent ?? point.reconstructed?.percent) !== null && (point.recorded?.percent ?? point.reconstructed?.percent) !== undefined);
  if (usable.length < 2) return <p className="text-sm text-text-muted">Not enough history yet — the trend appears as the work moves.</p>;
  const width = 600;
  const height = 140;
  const pad = 24;
  const x = (index: number) => pad + (index * (width - pad * 2)) / Math.max(points.length - 1, 1);
  const y = (value: number) => height - pad - (value * (height - pad * 2)) / 100;
  const series = (pick: (point: HistoryPoint) => number | null | undefined) => points.map((point, index) => ({ point, index, value: point.available ? pick(point) : null }))
    .filter((row) => row.value !== null && row.value !== undefined) as Array<{ point: HistoryPoint; index: number; value: number }>;
  const line = (rows: Array<{ index: number; value: number }>) => rows.map((row, i) => `${i ? "L" : "M"}${x(row.index).toFixed(1)},${y(row.value).toFixed(1)}`).join(" ");
  const recorded = series((point) => point.recorded?.percent);
  const rebuilt = series((point) => point.reconstructed?.percent);
  const last = usable[usable.length - 1]!;
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-36 w-full" role="img" aria-label={`Task completion trend, now ${percentLabel(last.recorded?.percent ?? last.reconstructed?.percent ?? null)}`}>
        {[0, 50, 100].map((tick) => (
          <g key={tick}><line x1={pad} x2={width - pad} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeDasharray="3 3" />
            <text x={2} y={y(tick) + 4} className="fill-text-muted text-[10px]">{tick}%</text></g>
        ))}
        <path d={line(rebuilt)} fill="none" className="stroke-text-subtle" strokeWidth={1.5} strokeDasharray="4 4" />
        <path d={line(recorded)} fill="none" className="stroke-brand" strokeWidth={2.5} />
        {recorded.map((row) => <circle key={row.index} cx={x(row.index)} cy={y(row.value)} r={3} className="fill-brand"><title>{`${row.point.date}: ${percentLabel(row.value)}`}</title></circle>)}
      </svg>
      <figcaption className="flex flex-wrap justify-between gap-2 text-xs text-text-muted">
        <span>{points[0]?.date}</span>
        <span className="flex gap-3"><span><span className="mr-1 inline-block h-0.5 w-4 bg-brand align-middle" />As recorded</span><span><span className="mr-1 inline-block h-0.5 w-4 border-t border-dashed border-text-subtle align-middle" />Rebuilt from task history</span></span>
        <span>{points[points.length - 1]?.date}</span>
      </figcaption>
    </figure>
  );
}

// ------------------------------------------------------------------ one project's progress (the Overview tab)
export function ProjectProgress({ projectId, onTab, healthNote }: { projectId: string; onTab: (tab: string) => void; healthNote?: ReactNode }) {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "progress", projectId), queryFn: () => getProgress(projectId), retry: false });
  const [interval, setInterval] = useState<"week" | "day">("week");
  const history = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "progress-history", projectId, interval), queryFn: () => getProgressHistory(projectId, interval, interval === "week" ? 12 : 30), retry: false });
  const changes = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "progress-changes", projectId), queryFn: () => getProgressChanges(projectId, new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)), retry: false });
  const [dialog, setDialog] = useState<"baseline" | null>(null);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "warning"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (query.isLoading) return <LoadingState label="Calculating progress" rows={4} />;
  if (query.isError || !query.data) return <Notice tone="danger">{errorMessage(query.error)}</Notice>;
  const p: ProgressSummary = query.data;
  const t = p.tasks;
  const m = p.milestones;
  const s = p.schedule;
  const refresh = () => queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects") });
  const record = async () => {
    setBusy(true);
    try { const result = await recordProgress(projectId); setMessage({ tone: result.consistent ? "success" : "warning", text: result.message }); await refresh(); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-4">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      {/* the headline: task completion, with the separate measures beside it */}
      <section aria-label="Progress summary" className="grid gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{t.measure}</p>
              <p className="text-3xl font-semibold tabular-nums sm:text-4xl">{t.percent === null ? "Not available" : percentLabel(t.percent)}</p>
              <p className="text-sm text-text-secondary">{t.state === "NO_TASKS" ? <>No tasks yet. <button type="button" className="text-brand underline" onClick={() => onTab("tasks")}>Add tasks</button> to measure progress.</> : t.text}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge tone={healthTone(p.health.state)}>{p.health.label}</StatusBadge>
              <StatusBadge tone={SCHEDULE_TONE[s.indicator] ?? "neutral"}>{s.label}</StatusBadge>
            </div>
          </div>
          <ProgressBar percent={t.percent} label={t.measure} />
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
            {([["To do", t.toDo, t.links.toDo], ["In progress", t.inProgress, t.links.inProgress], ["In review", t.inReview, t.links.inReview], ["Blocked", t.blocked, t.links.blocked],
              ["Overdue", t.overdue, t.links.overdue], ["Done", t.done, t.links.done]] as Array<[string, number, string]>).map(([label, value, href]) => (
              <Link key={label} href={href} className="flex flex-col rounded-md bg-surface-muted px-2 py-1.5 hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-focus">
                <span className="text-[11px] text-text-muted">{label}</span>
                <span className={`text-base font-semibold tabular-nums ${label === "Overdue" && value ? "text-danger" : label === "Blocked" && value ? "text-warning" : ""}`}>{value}</span>
              </Link>
            ))}
          </div>
          {(t.cancelled > 0 || t.openUrgent > 0 || t.openHigh > 0) && (
            <p className="text-xs text-text-muted">{[t.openUrgent ? `${t.openUrgent} urgent open` : "", t.openHigh ? `${t.openHigh} high priority open` : "", t.cancelled ? `${t.cancelled} cancelled (not counted)` : ""].filter(Boolean).join(" · ")}</p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <Stat label={m.measure} value={m.requiredTotal ? `${m.requiredCompleted} / ${m.requiredTotal}` : "—"} note={m.requiredTotal ? percentLabel(m.percent) : "No required milestones"} />
          <Stat label="Target date" value={dateLabel(s.currentTarget)} note={s.remainingText ?? s.label} tone={s.indicator === "OVERDUE" ? "danger" : s.indicator === "DUE_SOON" ? "warning" : undefined} />
          <Stat label="Overdue tasks" value={t.overdue} href={t.links.overdue} tone={t.overdue ? "danger" : undefined} note={m.overdue ? `${m.overdue} milestone(s) overdue` : undefined} />
          <Stat label="Blocked tasks" value={t.blocked} href={t.links.blocked} tone={t.blocked ? "warning" : undefined} note={m.pendingApproval ? `${m.pendingApproval} milestone(s) awaiting approval` : undefined} />
        </div>
      </section>

      {p.outcome && (
        <Notice tone="neutral">{p.outcome.recorded
          ? `Final at ${p.statusLabel.toLowerCase()} (${p.outcome.at ? formatDateTime(p.outcome.at) : ""}): ${percentLabel(p.outcome.percent ?? null)} task completion, ${p.outcome.requiredCompleted} of ${p.outcome.requiredMilestones} required milestones accepted${p.outcome.waived ? `, ${p.outcome.waived} waived` : ""}. The percentage is never forced to 100%.`
          : p.outcome.message}</Notice>
      )}
      {p.completion && (p.completion.ready
        ? <Notice tone="success">Every completion check passes. Completing the project is still your decision — use Complete in the status panel.</Notice>
        : t.percent === 100 ? <Notice tone="info">{`All tasks are done, but ${p.completion.blockers.length} completion check(s) remain: ${p.completion.blockers.map((row) => row.label).join(", ")}.`}</Notice> : null)}

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Health" description="A warning with its reasons — never a forecast, and it never changes the project's status.">
          <ul className="flex flex-col gap-1.5 text-sm">{p.health.reasons.map((reason) => <li key={reason} className="flex gap-2"><span aria-hidden className="text-text-muted">•</span><span>{reason}</span></li>)}</ul>
          {healthNote}
        </Panel>
        <Panel title="Schedule" description="Elapsed time is shown as schedule, not as work done.">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            {([["Planned start", dateLabel(s.plannedStart)], ["Actual start", dateLabel(s.actualStart)], ["Original target", dateLabel(s.originalTarget)], ["Current target", dateLabel(s.currentTarget)],
              ["Completed", dateLabel(s.completedAt)], ["On hold", s.holds ? `${s.holdDays} day(s) over ${s.holds} hold(s)` : "Never"]] as Array<[string, string]>).map(([label, value]) => (
              <div key={label} className="min-w-0"><dt className="text-xs text-text-muted">{label}</dt><dd className="truncate">{value}</dd></div>
            ))}
          </dl>
          {s.elapsedPercent !== null && <div className="flex flex-col gap-1"><span className="text-xs text-text-muted">{`Schedule elapsed: ${s.elapsedPercent}% of the time to the target`}</span><ProgressBar percent={s.elapsedPercent} label="Schedule elapsed" size="sm" /></div>}
          {s.revisions.length > 0 && (
            <details className="text-sm"><summary className="cursor-pointer text-brand">{`Target moved ${s.revisions.length} time(s)`}</summary>
              <ul className="mt-2 flex flex-col gap-1">{s.revisions.map((row) => <li key={row.at}>{`${dateLabel(row.from)} → ${dateLabel(row.to)}${row.reason ? ` — ${row.reason}` : ""}${row.by ? ` (${row.by})` : ""}`}</li>)}</ul></details>
          )}
        </Panel>
      </div>

      <Panel title="Progress trend" description="Task completion over time. A drop is explained below — scope added or work reopened."
        actions={<span className="flex gap-1"><Button size="compact" variant={interval === "week" ? "secondary" : "ghost"} onPress={() => setInterval("week")}>Weekly</Button>
          <Button size="compact" variant={interval === "day" ? "secondary" : "ghost"} onPress={() => setInterval("day")}>Daily</Button></span>}>
        {history.isLoading ? <LoadingState label="Loading the trend" rows={2} /> : history.data ? <TrendChart points={history.data.points} /> : <p className="text-sm text-text-muted">Historical progress is unavailable for this period.</p>}
      </Panel>

      <Panel title="What changed" description="Each move of the percentage and what caused it, from the last 30 days.">
        {changes.data?.summary && <p className="text-sm font-medium">{changes.data.summary}</p>}
        {(changes.data?.changes ?? p.changes).length === 0 ? <p className="text-sm text-text-muted">No changes recorded yet.</p> : (
          <ol className="flex flex-col divide-y divide-border">
            {(changes.data?.changes ?? p.changes).slice(0, 12).map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 py-2 text-sm">
                <span className="min-w-0"><span className="font-medium">{row.kindLabel}</span>{row.subject && <> · {row.href ? <Link className="text-brand hover:underline" href={row.href}>{row.subject}</Link> : row.subject}</>}
                  <span className="block text-xs text-text-muted">{row.text}</span></span>
                <span className="text-xs text-text-muted">{`${formatDateTime(row.at)} · ${row.actor}`}</span>
              </li>
            ))}
          </ol>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Milestones" description="Accepted outcomes. Linked tasks show supporting work; all of them done never completes a milestone by itself."
          actions={<Button size="compact" variant="ghost" onPress={() => onTab("milestones")}>All milestones</Button>}>
          {m.rows.length === 0 ? <p className="text-sm text-text-muted">No milestones planned.</p> : (
            <ul className="flex flex-col gap-3">
              {m.rows.filter((row) => row.status !== "CANCELLED").slice(0, 8).map((row) => (
                <li key={row.id} className="flex flex-col gap-1">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <Link className="min-w-0 truncate font-medium text-brand hover:underline" href={row.href}>{`${row.code} · ${row.name}`}</Link>
                    <span className="flex flex-wrap gap-1">
                      {row.waived ? <StatusBadge tone="neutral">Waived</StatusBadge> : <StatusBadge tone={row.status === "COMPLETED" ? "success" : row.status === "BLOCKED" ? "danger" : row.status === "SUBMITTED" ? "info" : "neutral"}>{row.status === "SUBMITTED" ? "Awaiting approval" : row.status.replace(/_/g, " ").toLowerCase().replace(/^\w/, (ch) => ch.toUpperCase())}</StatusBadge>}
                      {row.overdue && <StatusBadge tone="danger">Overdue</StatusBadge>}
                      {!row.required && <StatusBadge tone="neutral">Optional</StatusBadge>}
                    </span>
                  </div>
                  <div className="flex items-center gap-2"><ProgressBar percent={row.tasks.percent} label={`${row.name} linked tasks`} size="sm" />
                    <span className="shrink-0 text-xs tabular-nums text-text-muted">{row.tasks.total ? `${row.tasks.done}/${row.tasks.total} tasks` : "No tasks"}</span></div>
                  <span className="text-xs text-text-muted">{`Due ${dateLabel(row.due)}${row.owner ? ` · ${row.owner}` : ""}${row.blockers ? ` · ${row.blockers} blocker(s)` : ""}`}</span>
                </li>
              ))}
            </ul>
          )}
          {m.waived > 0 && <p className="text-xs text-text-muted">{`${m.waived} required milestone(s) waived — reported apart, not counted as completed.`}</p>}
        </Panel>
        <Panel title="Team progress" description="Current owners of the work — for coordinating, not a performance score.">
          {p.assignees.length === 0 ? <p className="text-sm text-text-muted">No tasks assigned yet.</p> : (
            <LinesTable columns={["Assignee", { label: "Open", numeric: true }, { label: "Overdue", numeric: true }, { label: "Done", numeric: true }, ""]}>
              {p.assignees.map((row) => (
                <tr key={row.assigneeId ?? "none"}>
                  <Cell><Link className="text-brand hover:underline" href={row.href}>{row.assignee}</Link>{row.needsReassignment && <span className="ml-2"><StatusBadge tone="warning">Needs a new owner</StatusBadge></span>}</Cell>
                  <Cell numeric>{row.open}</Cell><Cell numeric>{row.overdue || "—"}</Cell><Cell numeric>{`${row.done}/${row.total}`}</Cell>
                  <Cell><span className="block w-16"><ProgressBar percent={row.percent} label={`${row.assignee} done`} size="sm" /></span></Cell>
                </tr>
              ))}
            </LinesTable>
          )}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Effort used against estimate" description="Approved hours against the task estimates — a separate measure, never task completion.">
          {!p.effort.available ? <p className="text-sm text-text-muted">{p.effort.reason}</p> : (
            <>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                {([["Estimated", p.effort.estimateMinutes === null ? "No estimates" : hoursLabel(p.effort.estimateMinutes)], ["Approved time", hoursLabel(p.effort.approvedMinutes)],
                  ["Awaiting approval", hoursLabel(p.effort.submittedMinutes)], ["Estimate coverage", `${p.effort.estimatedTasks} of ${p.effort.activeTasks} task(s)`],
                  ["Billable (approved)", hoursLabel(p.effort.approvedBillableMinutes)], ["Non-billable (approved)", hoursLabel(p.effort.approvedNonBillableMinutes)]] as Array<[string, string]>).map(([label, value]) => (
                  <div key={label}><dt className="text-xs text-text-muted">{label}</dt><dd className="tabular-nums">{value}</dd></div>
                ))}
              </dl>
              {p.effort.note && <p className="text-xs text-text-muted">{p.effort.note}</p>}
              <Button size="compact" variant="ghost" onPress={() => onTab("time")}>Time & expenses</Button>
            </>
          )}
        </Panel>
        <Panel title="Scope against baseline" description="The scope the project committed to, and how it changed since."
          actions={p.can.baseline ? <Button size="compact" variant="secondary" onPress={() => setDialog("baseline")}>Re-baseline</Button> : undefined}>
          {!p.baseline.set ? <p className="text-sm text-text-muted">{p.baseline.message}</p> : (
            <>
              <dl className="grid grid-cols-3 gap-2 text-sm">
                <div><dt className="text-xs text-text-muted">Baseline</dt><dd className="font-semibold tabular-nums">{`${p.baseline.baselineTasks} tasks`}</dd></div>
                <div><dt className="text-xs text-text-muted">Now</dt><dd className="font-semibold tabular-nums">{`${p.baseline.currentTasks} tasks`}</dd></div>
                <div><dt className="text-xs text-text-muted">Net change</dt><dd className="font-semibold tabular-nums">{`${(p.baseline.netTasks ?? 0) > 0 ? "+" : ""}${p.baseline.netTasks}`}</dd></div>
              </dl>
              <p className="text-xs text-text-muted">{`${p.baseline.addedTasks} added and ${p.baseline.removedTasks} cancelled since v${p.baseline.version} (${p.baseline.source === "PROJECT_START" ? "taken when the project started" : p.baseline.reason ?? "re-baselined"}, ${p.baseline.capturedAt ? formatDateTime(p.baseline.capturedAt) : ""}). Target then: ${dateLabel(p.baseline.baselineTarget ?? null)}.`}</p>
            </>
          )}
        </Panel>
      </div>

      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-muted">
        <span>{`Calculated ${formatDateTime(p.calculatedAt)} from the tasks and milestones (rules v${p.calculationVersion}).`}</span>
        {!p.freshness.inSync && <span className="text-warning">{p.freshness.message}</span>}
        {!p.freshness.inSync && p.can.record && <Button size="compact" variant="ghost" isLoading={busy} onPress={record}>Record now</Button>}
      </p>
      {dialog === "baseline" && <BaselineDialog projectId={projectId} onClose={() => setDialog(null)} onDone={async (text) => { setDialog(null); setMessage({ tone: "success", text }); await refresh(); }} />}
    </div>
  );
}
function BaselineDialog({ projectId, onClose, onDone }: { projectId: string; onClose: () => void; onDone: (text: string) => Promise<void> }) {
  const [reason, setReason] = useState("");
  const [key] = useState(newKey);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setBusy(true); setError(null);
    try { const made = await captureBaseline(projectId, { reason, idempotencyKey: key }); await onDone(`Baseline v${made.version} recorded with ${made.taskCount} task(s).`); }
    catch (failure) { setError(errorMessage(failure)); } finally { setBusy(false); }
  };
  return (
    <Dialog isOpen isDismissable onOpenChange={(next) => { if (!next) onClose(); }} title="Re-baseline the scope"
      description="Records today's tasks, required milestones and target as the new comparison point. Earlier baselines stay on record.">
      <div className="flex flex-col gap-3">
        {error && <Notice tone="danger">{error}</Notice>}
        <TextArea label="Why" value={reason} onChange={setReason} isRequired maxLength={1000} description="For example, the approved change request." />
        <div className="flex justify-end gap-2"><Button variant="secondary" onPress={onClose}>Cancel</Button><Button variant="primary" isLoading={busy} isDisabled={busy || !reason.trim()} onPress={run}>Record baseline</Button></div>
      </div>
    </Dialog>
  );
}

// ------------------------------------------------------------------ the portfolio
const SORTS = [{ value: "", label: "Recently updated" }, { value: "health", label: "Health (worst first)" }, { value: "progress", label: "Progress (lowest first)" }, { value: "target", label: "Target date" }, { value: "code", label: "Project code" }];
export function PortfolioProgressScreen() {
  const workspace = useWorkspaceContext();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = params.get("view") === "attention" ? "attention" : "all";
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("");
  const filters = { attention: view === "attention" ? "1" : undefined, search: search.trim() || undefined, sort: sort || undefined };
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "portfolio-progress", filters), queryFn: () => getPortfolio(filters), retry: false });
  if (query.isError && errorStatus(query.error) === 403) return <PermissionState title="You don't have access to projects" description="Ask an administrator for access to Projects." />;
  const data = query.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={view === "attention" ? "Projects Needing Attention" : "Portfolio Progress"}
        description="Task completion and delivery health across the projects you can see. Each figure is calculated from the projects' own tasks and milestones."
        secondaryActions={data?.can.export ? <LinkButton variant="secondary" href={progressExportHref(filters)}>Export</LinkButton> : undefined} />
      <Tabs selectedKey={view} onSelectionChange={(key) => router.replace(`${pathname}${String(key) === "attention" ? "?view=attention" : ""}`)}>
        <TabList aria-label="Portfolio views"><Tab id="all">All projects</Tab><Tab id="attention">{`Needing attention${data ? ` (${data.totals.attention})` : ""}`}</Tab></TabList>
      </Tabs>
      {data && (
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-6">
          <Stat label={data.measures.aggregate.label} value={percentLabel(data.measures.aggregate.percent)} note={`${data.measures.aggregate.done} of ${data.measures.aggregate.total} tasks`} />
          <Stat label={data.measures.average.label} value={percentLabel(data.measures.average.percent)} note={`${data.measures.average.projects} project(s) with tasks`} />
          <Stat label="Active projects" value={data.totals.projects} note={`${data.totals.onTrack} on track`} />
          <Stat label="At risk or blocked" value={data.totals.atRisk + data.totals.blocked} tone={data.totals.atRisk + data.totals.blocked ? "warning" : undefined} note={`${data.totals.blocked} blocked`} />
          <Stat label="Past their target" value={data.totals.overdue} tone={data.totals.overdue ? "danger" : undefined} note={`${data.totals.dueSoon} due soon`} />
          <Stat label="No tasks yet" value={data.totals.noTasks} note="Progress not available" />
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1"><TextField label="Search" value={search} onChange={setSearch} placeholder="Project, customer or tag" /></div>
        <div className="sm:w-60"><Select label="Sort by" selectedKey={sort} onSelectionChange={(key) => setSort(String(key ?? ""))} options={SORTS} /></div>
      </div>
      {query.isLoading ? <LoadingState label="Calculating the portfolio" rows={6} />
        : query.isError || !data ? <ErrorState title="Could not load the portfolio" description={errorMessage(query.error)} />
        : data.projects.length === 0 ? <EmptyState title={view === "attention" ? "Nothing needs attention" : "No projects"} description={view === "attention" ? "No visible project is at risk, blocked or past its target." : "Projects you can see appear here."} />
        : (
          <>
            {/* phones: cards */}
            <ul className="flex flex-col gap-2 md:hidden">{data.projects.map((row) => <li key={row.id}><PortfolioCard row={row} /></li>)}</ul>
            {/* tablets and up: a table */}
            <div className="hidden md:block">
              <Panel>
                <LinesTable columns={["Project", "Health", { label: "Task completion", numeric: false }, { label: "Milestones", numeric: true }, { label: "Blocked", numeric: true }, { label: "Overdue", numeric: true }, "Target"]}>
                  {data.projects.map((row) => (
                    <tr key={row.id}>
                      <Cell><Link className="font-medium text-brand hover:underline" href={`${PROJECTS_BASE}/${row.id}`}>{row.name || "Untitled"}</Link><span className="block text-xs text-text-muted">{`${row.code}${row.manager ? ` · ${row.manager}` : ""}`}</span></Cell>
                      <Cell><StatusBadge tone={healthTone(row.health)}>{row.healthLabel}</StatusBadge>{row.healthReasons[0] && row.health !== "ON_TRACK" && <span className="block max-w-56 truncate text-xs text-text-muted" title={row.healthReasons.join(" ")}>{row.healthReasons[0]}</span>}</Cell>
                      <Cell><span className="flex items-center gap-2"><span className="w-24"><ProgressBar percent={row.percent} label={`${row.code} task completion`} size="sm" /></span>
                        <span className="text-xs tabular-nums">{row.total ? `${percentLabel(row.percent)} · ${row.done}/${row.total}` : "No tasks"}</span></span></Cell>
                      <Cell numeric>{row.milestonesRequired ? `${row.milestonesCompleted}/${row.milestonesRequired}` : "—"}</Cell>
                      <Cell numeric>{row.blocked || "—"}</Cell><Cell numeric>{row.overdue || "—"}</Cell>
                      <Cell>{dateLabel(row.target)}<span className={`block text-xs ${row.schedule === "OVERDUE" ? "text-danger" : "text-text-muted"}`}>{row.scheduleLabel}</span></Cell>
                    </tr>
                  ))}
                </LinesTable>
              </Panel>
            </div>
            <p className="text-xs text-text-muted">{`Calculated ${formatDateTime(data.calculatedAt)}. Projects are not ranked by people; percentages count tasks, not effort.`}</p>
          </>
        )}
    </div>
  );
}
function PortfolioCard({ row }: { row: PortfolioRow }) {
  return (
    <Link href={`${PROJECTS_BASE}/${row.id}`} className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-3 hover:border-brand-border focus-visible:outline-2 focus-visible:outline-focus">
      <span className="flex items-start justify-between gap-2">
        <span className="min-w-0"><span className="block truncate font-medium">{row.name || "Untitled"}</span><span className="block text-xs text-text-muted">{`${row.code}${row.manager ? ` · ${row.manager}` : ""}`}</span></span>
        <StatusBadge tone={healthTone(row.health)}>{row.healthLabel}</StatusBadge>
      </span>
      <ProgressBar percent={row.percent} label={`${row.code} task completion`} size="sm" />
      <span className="flex flex-wrap justify-between gap-x-3 text-xs text-text-muted">
        <span className="tabular-nums">{row.total ? `${percentLabel(row.percent)} · ${row.done}/${row.total} tasks` : "No tasks yet"}</span>
        <span className={row.schedule === "OVERDUE" ? "text-danger" : ""}>{`${row.scheduleLabel}${row.target ? ` · ${dateLabel(row.target)}` : ""}`}</span>
      </span>
    </Link>
  );
}

// ------------------------------------------------------------------ reports (a set of Project Reports)
export const PROGRESS_REPORT_TABS = [{ id: "pg-overview", label: "Project progress" }, { id: "pg-by-manager", label: "By project manager" }, { id: "pg-task-status", label: "Task status" },
  { id: "pg-milestones", label: "Milestone completion" }, { id: "pg-by-assignee", label: "By assignee" }, { id: "pg-overdue-blocked", label: "Overdue & blocked" }, { id: "pg-trend", label: "Progress trend" },
  { id: "pg-baseline", label: "Baseline vs current" }, { id: "pg-near-deadline", label: "Near deadline" }, { id: "pg-on-hold", label: "On hold" }, { id: "pg-completed-outcomes", label: "Completed outcomes" },
  { id: "pg-reopened", label: "Reopened" }, { id: "pg-estimate-vs-approved", label: "Estimate vs approved" }, { id: "pg-exceptions", label: "Data exceptions" }];
type Row = Record<string, unknown>;
const v = (value: unknown) => (value === null || value === undefined || value === "" ? "—" : String(value));
const pct = (value: unknown) => percentLabel(value === null || value === undefined ? null : Number(value));
const projectCell = (row: Row) => <Link className="text-brand underline" href={`${PROJECTS_BASE}/${v(row.id)}`}>{v(row.name) === "—" ? v(row.code) : v(row.name)} <span className="text-text-muted">{v(row.code)}</span></Link>;
export function ProgressReport({ kind, rows }: { kind: string; rows: Row[] }) {
  switch (kind) {
    case "pg-overview": case "pg-overdue-blocked": case "pg-near-deadline": case "pg-on-hold": return (
      <LinesTable columns={["Project", "Health", { label: "Task completion", numeric: true }, { label: "Done / active", numeric: true }, { label: "Blocked", numeric: true }, { label: "Overdue", numeric: true }, { label: "Milestones", numeric: true }, "Target"]}>
        {rows.map((row) => <tr key={v(row.id)}><Cell>{projectCell(row)}</Cell><Cell>{v(row.healthLabel)}</Cell><Cell numeric>{pct(row.percent)}</Cell><Cell numeric>{`${v(row.done)}/${v(row.total)}`}</Cell>
          <Cell numeric>{v(row.blocked)}</Cell><Cell numeric>{v(row.overdue)}</Cell><Cell numeric>{Number(row.milestonesRequired) ? `${v(row.milestonesCompleted)}/${v(row.milestonesRequired)}` : "—"}</Cell>
          <Cell>{`${v(row.target)} · ${v(row.scheduleLabel)}`}</Cell></tr>)}
      </LinesTable>
    );
    case "pg-by-manager": return (
      <LinesTable columns={["Project Manager", { label: "Projects", numeric: true }, { label: "Tasks done", numeric: true }, { label: "Task completion", numeric: true }, { label: "At risk", numeric: true }, { label: "Overdue", numeric: true }]}>
        {rows.map((row) => <tr key={v(row.managerId)}><Cell>{v(row.manager)}</Cell><Cell numeric>{v(row.projects)}</Cell><Cell numeric>{`${v(row.done)}/${v(row.total)}`}</Cell><Cell numeric>{pct(row.percent)}</Cell>
          <Cell numeric>{v(row.atRisk)}</Cell><Cell numeric>{v(row.overdue)}</Cell></tr>)}
      </LinesTable>
    );
    case "pg-task-status": return (
      <LinesTable columns={["Project", { label: "To do", numeric: true }, { label: "In progress", numeric: true }, { label: "Blocked", numeric: true }, { label: "In review", numeric: true }, { label: "Done", numeric: true }, { label: "Cancelled", numeric: true }, { label: "Completion", numeric: true }]}>
        {rows.map((row) => <tr key={v(row.id)}><Cell>{projectCell(row)}</Cell><Cell numeric>{v(row.toDo)}</Cell><Cell numeric>{v(row.inProgress)}</Cell><Cell numeric>{v(row.blocked)}</Cell><Cell numeric>{v(row.inReview)}</Cell>
          <Cell numeric>{v(row.done)}</Cell><Cell numeric>{v(row.cancelled)}</Cell><Cell numeric>{pct(row.percent)}</Cell></tr>)}
      </LinesTable>
    );
    case "pg-milestones": return (
      <LinesTable columns={["Project", { label: "Required accepted", numeric: true }, { label: "Completion", numeric: true }, { label: "Awaiting approval", numeric: true }, { label: "Overdue", numeric: true }, { label: "Waived", numeric: true }]}>
        {rows.map((row) => <tr key={v(row.id)}><Cell>{projectCell(row)}</Cell><Cell numeric>{`${v(row.accepted)}/${v(row.required)}`}</Cell><Cell numeric>{pct(row.percent)}</Cell><Cell numeric>{v(row.pendingApproval)}</Cell>
          <Cell numeric>{v(row.overdue)}</Cell><Cell numeric>{v(row.waived)}</Cell></tr>)}
      </LinesTable>
    );
    case "pg-by-assignee": return (
      <LinesTable columns={["Assignee", { label: "Open", numeric: true }, { label: "Blocked", numeric: true }, { label: "Overdue", numeric: true }, { label: "Done", numeric: true }, ""]}>
        {rows.map((row) => <tr key={v(row.assigneeId)}><Cell><Link className="text-brand underline" href={v(row.href)}>{v(row.assignee)}</Link>{row.needsReassignment ? <span className="ml-2 text-xs text-warning">needs a new owner</span> : null}</Cell>
          <Cell numeric>{v(row.open)}</Cell><Cell numeric>{v(row.blocked)}</Cell><Cell numeric>{v(row.overdue)}</Cell><Cell numeric>{`${v(row.done)}/${v(row.total)}`}</Cell><Cell>{pct(row.percent)}</Cell></tr>)}
      </LinesTable>
    );
    case "pg-trend": return (
      <LinesTable columns={["Week ending", { label: "Projects", numeric: true }, { label: "Tasks done", numeric: true }, { label: "Task completion", numeric: true }]}>
        {rows.map((row) => <tr key={v(row.date)}><Cell>{dateLabel(v(row.date))}</Cell><Cell numeric>{v(row.projects)}</Cell><Cell numeric>{`${v(row.done)}/${v(row.total)}`}</Cell><Cell numeric>{pct(row.percent)}</Cell></tr>)}
      </LinesTable>
    );
    case "pg-baseline": return (
      <LinesTable columns={["Project", "Baseline", { label: "Baseline tasks", numeric: true }, { label: "Now", numeric: true }, { label: "Added", numeric: true }, { label: "Cancelled", numeric: true }, "Target then → now"]}>
        {rows.map((row) => <tr key={v(row.id)}><Cell>{projectCell(row)}</Cell><Cell>{row.set ? `v${v(row.version)}` : "Not set"}</Cell><Cell numeric>{v(row.baselineTasks)}</Cell><Cell numeric>{v(row.currentTasks)}</Cell>
          <Cell numeric>{v(row.added)}</Cell><Cell numeric>{v(row.removed)}</Cell><Cell>{`${v(row.baselineTarget)} → ${v(row.currentTarget)}`}</Cell></tr>)}
      </LinesTable>
    );
    case "pg-completed-outcomes": return (
      <LinesTable columns={["Project", "Outcome", "Completed", "Target", "Schedule", { label: "Final task completion", numeric: true }, { label: "Waived milestones", numeric: true }]}>
        {rows.map((row) => <tr key={v(row.id)}><Cell>{projectCell(row)}</Cell><Cell>{v(row.statusLabel)}</Cell><Cell>{v(row.completedAt)}</Cell><Cell>{v(row.target)}</Cell><Cell>{v(row.schedule)}</Cell>
          <Cell numeric>{`${pct(row.finalPercent)}${row.recorded ? "" : " (now)"}`}</Cell><Cell numeric>{v(row.waived)}</Cell></tr>)}
      </LinesTable>
    );
    case "pg-reopened": return (
      <LinesTable columns={["Project", "Status", { label: "Times reopened", numeric: true }, "Last reopened", { label: "Task completion", numeric: true }]}>
        {rows.map((row) => <tr key={v(row.id)}><Cell>{projectCell(row)}</Cell><Cell>{v(row.status)}</Cell><Cell numeric>{v(row.times)}</Cell><Cell>{formatDateTime(v(row.lastAt))}</Cell><Cell numeric>{pct(row.percent)}</Cell></tr>)}
      </LinesTable>
    );
    case "pg-estimate-vs-approved": return (
      <LinesTable columns={["Project", { label: "Estimated", numeric: true }, { label: "Estimate coverage", numeric: true }, { label: "Approved time", numeric: true }, { label: "Variance", numeric: true }]}>
        {rows.map((row) => <tr key={v(row.id)}><Cell>{projectCell(row)}</Cell><Cell numeric>{row.estimateMinutes === null ? "No estimates" : hoursLabel(Number(row.estimateMinutes))}</Cell>
          <Cell numeric>{`${v(row.estimatedTasks)} of ${v(row.tasks)}`}</Cell><Cell numeric>{hoursLabel(Number(row.approvedMinutes))}</Cell><Cell numeric>{row.varianceMinutes === null ? "—" : `${Number(row.varianceMinutes) > 0 ? "+" : ""}${hoursLabel(Math.abs(Number(row.varianceMinutes))).replace(/^/, Number(row.varianceMinutes) < 0 ? "−" : "")}`}</Cell></tr>)}
      </LinesTable>
    );
    case "pg-exceptions": return (
      <LinesTable columns={["Project", "Status", "What needs attention"]}>
        {rows.map((row) => <tr key={v(row.id)}><Cell>{projectCell(row)}</Cell><Cell>{v(row.status)}</Cell><Cell>{((row.reasons as string[]) ?? []).join(" · ")}</Cell></tr>)}
      </LinesTable>
    );
    default: return null;
  }
}

// ------------------------------------------------------------------ settings
export function ProgressSettingsPanel() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const settings = useQuery({ queryKey: scopedQueryKey(workspace, "projects", "progress-settings"), queryFn: getProgressSettings, retry: false });
  const [message, setMessage] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (!settings.data) return null;
  const toggle = async (on: boolean) => {
    try { await saveProgressSettings(on); await queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "projects", "progress-settings") }); setMessage({ tone: "success", text: on ? "Weekly summaries on." : "Weekly summaries off." }); }
    catch (failure) { setMessage({ tone: "danger", text: errorMessage(failure) }); }
  };
  return (
    <Panel title="Progress" description="Progress is always calculated from the tasks and milestones; it cannot be typed in. Project managers are told when a project turns at risk or is ready to complete.">
      {message && <Notice tone={message.tone}>{message.text}</Notice>}
      <Checkbox isDisabled={!settings.data.can.manage} isSelected={settings.data.weeklySummary} onChange={toggle}>Send project managers a weekly progress summary (Mondays)</Checkbox>
    </Panel>
  );
}
export const portfolioHref = (attention = false) => `${PROGRESS_BASE}${attention ? "?view=attention" : ""}`;
