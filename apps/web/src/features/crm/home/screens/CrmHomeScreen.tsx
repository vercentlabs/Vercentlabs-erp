"use client";

// CRM Home answers one question: what do I do next? It is an operational
// workspace, not a BI dashboard. Top to bottom: the user's own agenda for
// today (each row can be completed, rescheduled or snoozed in place) beside
// what is slipping; the four headline figures as a slim strip; the deals
// closing soonest and this month's lead flow; the open pipeline by stage; and
// what just happened. Every figure and row opens the record or list behind it.
// A section the user may not see (no permission) is left out. With no records
// yet, one "Start here" panel takes their place.
import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowRight, Calendar, CheckCircle2, CheckSquare, Clock, Mail, MonitorPlay, Phone, Target, TrendingUp, Trophy, Users, UserPlus,
} from "lucide-react";
import { ErrorState, PageHeader } from "@vercentlabs/design-system";

import { CrmCreateMenu } from "@/features/crm/shared/CrmCreateMenu";
import { readableHistory } from "@/features/crm/shared/field-labels";
import { WorkRowActions } from "@/features/crm/shared/ui/WorkRowActions";
import { clockLabel } from "@/features/crm/shared/when";
import { formatDate, formatMoney } from "@/shared/format/human";
import { LoadingState } from "@/shared/ui/LoadingState";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

import { getCrmHome, type CrmHome } from "../api/home-api";

type Tone = "brand" | "success" | "warning" | "danger";
const TONE_CHIP: Record<Tone, string> = {
  brand: "bg-brand-soft text-brand",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

function greeting(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// "just now", "12 min ago", "3 h ago", "Yesterday", or the date.
function relativeTime(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return "Yesterday";
  return formatDate(value);
}

const sum = (...values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);

export function CrmHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "home"), queryFn: getCrmHome, refetchOnWindowFocus: true });
  const home = query.data;
  const firstName = workspace.fullName.split(" ")[0] || workspace.fullName;
  const now = new Date();
  const today = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="flex flex-1 flex-col gap-6">
      {/* The greeting and date use the browser clock, so they appear once data has loaded on the client (never in server HTML). */}
      <PageHeader title={home ? `${greeting(now.getHours())}, ${firstName}` : `Welcome back, ${firstName}`} description={home ? todayLine(today, home) : "Your CRM at a glance."} primaryAction={<CrmCreateMenu />} />
      {query.isLoading ? <LoadingState label="Loading your CRM" rows={5} />
        : query.isError || !home ? <ErrorState title="Could not load CRM Home" description="Refresh to try again." action={{ label: "Try again", onPress: () => void query.refetch() }} />
        : <HomeBody home={home} />}
    </div>
  );
}

function todayLine(today: string, home: CrmHome) {
  const due = sum(home.myWork.tasksDueToday, home.myWork.followUpsToday);
  const overdue = sum(home.myWork.overdueTasks, home.myWork.overdueFollowUps);
  if (!home.sees.tasks && !home.sees.followUps) return today;
  if (!due && !overdue) return `${today} · nothing due today`;
  return `${today} · ${due} due today${overdue ? `, ${overdue} overdue` : ""}`;
}

const ymd = (date: Date) => date.toLocaleDateString("en-CA");
// The last day of the "closing soon" window, counted from today.
function closingBy(days: number) {
  const until = new Date();
  until.setDate(until.getDate() + days);
  return ymd(until);
}

function HomeBody({ home }: { home: CrmHome }) {
  const workspace = useWorkspaceContext();
  const money = (value: number | null, compact = false) => (value === null ? "" : formatMoney(home.baseCurrency, value, { compact }));
  const now = new Date();
  const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const dueToday = home.sees.tasks || home.sees.followUps ? sum(home.myWork.tasksDueToday, home.myWork.followUpsToday) : null;
  const overdue = sum(home.myWork.overdueTasks, home.myWork.overdueFollowUps);
  const dueTodayHref = home.sees.tasks ? "/crm/activities?tab=tasks&view=due_today" : "/crm/activities?tab=follow-ups&view=due_today";
  // A company with nothing in its CRM yet sees one panel: where to start.
  const empty = !home.agenda.length && !home.recentActivity.length && !home.closingSoon.length && !(home.totals.openLeads ?? 0) && !(home.totals.openOpportunities ?? 0)
    && !(home.leadFlow?.newThisMonth ?? 0);
  if (empty) return <StartHere admin={workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes("crm.settings.manage")} />;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          {(home.sees.tasks || home.sees.followUps) && <TodayPanel home={home} dueTodayHref={dueTodayHref} />}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          <AttentionPanel home={home} />
        </div>
      </div>

      <section aria-label="Headline figures" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {home.totals.openLeads !== null && (
          <Kpi icon={<UserPlus />} tone="brand" label="Open leads" value={home.totals.openLeads} href="/crm/leads?status=open"
            caption={home.leadFlow ? `${home.leadFlow.newThisMonth} new this month` : undefined} />
        )}
        {home.totals.pipelineValue !== null && (
          <Kpi icon={<Target />} tone="brand" label="Open pipeline" value={money(home.totals.pipelineValue, true)} title={money(home.totals.pipelineValue)} href="/crm/pipeline"
            caption={`${home.totals.openOpportunities ?? 0} open · ${money(home.totals.weightedPipelineValue, true)} weighted`} />
        )}
        {home.outcomes && (
          // The figure counts this month's wins, so its list shows this month's wins too.
          <Kpi icon={<Trophy />} tone="success" label="Won this month" value={money(home.outcomes.wonValueThisMonth, true)} title={money(home.outcomes.wonValueThisMonth)}
            href={`/crm/opportunities?view=won&closedFrom=${monthStart}&closedTo=${monthEnd}`}
            caption={`${home.outcomes.wonThisMonth} ${home.outcomes.wonThisMonth === 1 ? "deal" : "deals"}${home.outcomes.winRate !== null ? ` · ${home.outcomes.winRate}% win rate` : ""}`} />
        )}
        {dueToday !== null && (
          <Kpi icon={<Clock />} tone={overdue ? "danger" : "warning"} label="Due today" value={dueToday} href={dueTodayHref}
            caption={overdue ? `${overdue} overdue` : "Nothing overdue"} captionTone={overdue ? "danger" : undefined} />
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          {home.sees.opportunities && <ClosingSoonPanel home={home} money={money} />}
        </div>
        <div className="flex min-w-0 flex-col gap-6">
          {home.leadFlow && <LeadFlowPanel flow={home.leadFlow} monthStart={monthStart} />}
        </div>
      </div>

      {home.sees.opportunities && <PipelinePanel home={home} money={money} />}
      <ActivityPanel home={home} />
    </>
  );
}

function StartHere({ admin }: { admin: boolean }) {
  const steps = [
    { title: "Add or import your leads", description: "Type a lead in, or bring a list in from a file.", links: [{ label: "New lead", href: "/crm/leads/new" }, { label: "Import data", href: "/crm/data/import-export?type=leads" }] },
    ...(admin ? [{ title: "Set up assignment", description: "Decide who gets each new lead.", links: [{ label: "Assignment", href: "/crm/settings/leads/assignment" }] }] : []),
    { title: "Log your first activity", description: "Open a lead and log a call, a meeting or an email.", links: [{ label: "Leads", href: "/crm/leads" }] },
  ];
  return (
    <Panel title="Start here" description="Your CRM is empty. Three steps get it going.">
      <ol className="flex flex-col gap-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex items-start gap-3 rounded-[var(--radius-control)] bg-surface-muted p-3">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand" aria-hidden="true">{index + 1}</span>
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-sm font-medium">{step.title}</p>
              <p className="text-xs text-text-muted">{step.description}</p>
              <div className="flex flex-wrap gap-3">{step.links.map((link) => <PanelLink key={link.href} href={link.href}>{link.label}</PanelLink>)}</div>
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}

function Kpi({ icon, tone, label, value, title, caption, captionTone, href }: {
  icon: ReactNode; tone: Tone; label: string; value: ReactNode; title?: string; caption?: string; captionTone?: "danger"; href: string;
}) {
  return (
    <Link href={href} className="group flex min-w-0 flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface p-3 outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand sm:p-4">
      <span className="flex items-center justify-between gap-2">
        <span className="truncate text-xs font-medium text-text-muted sm:text-sm">{label}</span>
        <span className={`flex size-7 shrink-0 items-center justify-center rounded-full [&>svg]:size-4 ${TONE_CHIP[tone]}`} aria-hidden="true">{icon}</span>
      </span>
      <span className="truncate text-xl font-semibold tabular-nums text-text sm:text-2xl" title={title}>{value}</span>
      {caption && <span className={`truncate text-xs ${captionTone === "danger" ? "font-medium text-danger" : "text-text-muted"}`}>{caption}</span>}
    </Link>
  );
}

function Panel({ title, description, action, children }: { title: string; description?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{title}</h2>
          {description && <p className="text-xs text-text-muted">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PanelLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-sm font-medium text-brand hover:underline">
      {children}<ArrowRight className="size-3.5" aria-hidden="true" />
    </Link>
  );
}

function Empty({ icon, title, description }: { icon: ReactNode; title: string; description?: string }) {
  return (
    <div className="flex items-center gap-3 rounded-[var(--radius-control)] bg-surface-muted px-3 py-4">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-success-soft text-success [&>svg]:size-4" aria-hidden="true">{icon}</span>
      <div className="min-w-0">
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="text-xs text-text-muted">{description}</p>}
      </div>
    </div>
  );
}

const FOLLOW_UP_ICON: Record<string, ReactNode> = { call: <Phone />, email: <Mail />, meeting: <Users />, demo: <MonitorPlay /> };

function TodayPanel({ home, dueTodayHref }: { home: CrmHome; dueTodayHref: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const counts = [
    home.sees.tasks && `${sum(home.myWork.tasksDueToday)} ${home.myWork.tasksDueToday === 1 ? "task" : "tasks"}`,
    home.sees.followUps && `${sum(home.myWork.followUpsToday)} ${home.myWork.followUpsToday === 1 ? "follow-up" : "follow-ups"}`,
  ].filter(Boolean).join(" · ");
  return (
    <Panel title="Today" description={`${counts} due today, plus anything overdue`}
      action={<PanelLink href={dueTodayHref}>To-dos</PanelLink>}>
      {message && <p role="status" className="text-sm text-text-secondary">{message}</p>}
      {home.agenda.length === 0 ? (
        <Empty icon={<CheckCircle2 />} title="You're all caught up" description="Nothing overdue and nothing due today." />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {home.agenda.map((item) => {
            const href = item.kind === "task" ? `/crm/tasks/${item.id}` : `/crm/follow-ups/${item.id}`;
            const icon = item.kind === "task" ? <CheckSquare /> : FOLLOW_UP_ICON[item.type ?? ""] ?? <Calendar />;
            return (
              <li key={item.kind + item.id} className="group flex items-center gap-3 py-2.5">
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-full [&>svg]:size-4 ${item.isOverdue ? TONE_CHIP.danger : TONE_CHIP.brand}`} aria-hidden="true">{icon}</span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link href={href} className="truncate text-sm font-medium hover:text-brand hover:underline">{item.title}</Link>
                  <span className="truncate text-xs text-text-muted">
                    {item.kind === "task" ? "Task" : "Follow-up"}
                    {item.relatedName && <> · {item.relatedHref ? <Link href={item.relatedHref} className="hover:underline">{item.relatedName}</Link> : item.relatedName}</>}
                  </span>
                </div>
                <span className={`shrink-0 text-right text-xs ${item.isOverdue ? "font-medium text-danger" : "text-text-secondary"}`}>
                  {item.isOverdue ? <span className="inline-flex items-center gap-1"><AlertTriangle className="size-3.5" aria-hidden="true" />{formatDate(item.dueAt)}</span>
                    : item.dueTime ? clockLabel(item.dueTime) : "Today"}
                </span>
                {/* Complete, Reschedule and Snooze in place: the agenda is the user's own, so a follow-up's reminder is theirs to snooze. */}
                <WorkRowActions kind={item.kind} id={item.id} onMessage={setMessage} />
              </li>
            );
          })}
        </ul>
      )}
      {home.agendaTotal > home.agenda.length && (
        <Link href={dueTodayHref} className="text-xs font-medium text-brand hover:underline">and {home.agendaTotal - home.agenda.length} more in To-dos</Link>
      )}
    </Panel>
  );
}

function ClosingSoonPanel({ home, money }: { home: CrmHome; money: (value: number | null) => string }) {
  return (
    <Panel title="Closing soon" description={`Open deals due to close in the next ${home.needsAttention.closingSoonDays} days, or already past their date`}
      action={<PanelLink href={`/crm/opportunities?view=open&expectedCloseTo=${closingBy(home.needsAttention.closingSoonDays)}`}>All deals</PanelLink>}>
      {home.closingSoon.length === 0 ? (
        <Empty icon={<CheckCircle2 />} title="No deals closing soon" description={`Nothing is due to close in the next ${home.needsAttention.closingSoonDays} days.`} />
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {home.closingSoon.map((deal) => (
            <li key={deal.id}>
              <Link href={`/crm/opportunities/${deal.id}`} className="-mx-2 flex flex-col gap-1 rounded-[var(--radius-control)] px-2 py-2.5 hover:bg-surface-muted sm:flex-row sm:items-center sm:gap-4">
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{deal.name}</span>
                  <span className="truncate text-xs text-text-muted">{[deal.accountName, deal.stageName, deal.ownerName].filter(Boolean).join(" · ")}</span>
                </span>
                <span className="flex items-center justify-between gap-4 sm:justify-end">
                  <span className="text-sm font-semibold tabular-nums">{money(deal.amount)}</span>
                  <span className={`w-28 text-right text-xs ${deal.overdue ? "font-medium text-danger" : "text-text-secondary"}`}>
                    {deal.overdue ? "Was due " : ""}{formatDate(deal.expectedCloseDate)}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function AttentionPanel({ home }: { home: CrmHome }) {
  const attention = home.needsAttention;
  const rows = [
    { label: "Unassigned leads", value: attention.unassignedLeads, href: "/crm/leads?view=unassigned", tone: "warning" as const },
    { label: "Leads with no activity", value: attention.leadsWithNoActivity, href: "/crm/leads?view=no_activity", tone: "warning" as const },
    { label: `Deals idle ${attention.opportunityStaleDays}+ days`, value: attention.staleOpportunities, href: "/crm/opportunities?view=stale", tone: "warning" as const },
    { label: "Deals past their close date", value: attention.overdueOpportunities, href: "/crm/opportunities?view=overdue", tone: "danger" as const },
  ].filter((row): row is { label: string; value: number; href: string; tone: "warning" | "danger" } => row.value !== null);
  if (!rows.length) return null;
  const flagged = rows.filter((row) => row.value > 0);
  return (
    <Panel title="Needs attention">
      {flagged.length === 0 ? <Empty icon={<CheckCircle2 />} title="All clear" description="No unassigned, idle or overdue records." /> : (
        <ul className="flex flex-col gap-1.5">
          {rows.map((row) => (
            <li key={row.label}>
              <Link href={row.href} className={`flex items-center justify-between gap-3 rounded-[var(--radius-control)] px-3 py-2 text-sm hover:ring-1 hover:ring-border-strong ${row.value > 0 ? (row.tone === "danger" ? "bg-danger-soft" : "bg-warning-soft") : "bg-surface-muted text-text-muted"}`}>
                <span className="min-w-0 truncate">{row.label}</span>
                <span className={`font-semibold tabular-nums ${row.value > 0 ? (row.tone === "danger" ? "text-danger" : "text-warning") : ""}`}>{row.value}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function LeadFlowPanel({ flow, monthStart }: { flow: NonNullable<CrmHome["leadFlow"]>; monthStart: string }) {
  const steps = [
    { label: "New", value: flow.newThisMonth, href: `/crm/leads?createdFrom=${monthStart}` },
    { label: "Qualified", value: flow.qualifiedThisMonth, href: `/crm/leads?view=all&qualifiedFrom=${monthStart}` },
    { label: "Converted", value: flow.convertedThisMonth, href: `/crm/leads?view=all&convertedFrom=${monthStart}` },
  ];
  const top = Math.max(1, ...steps.map((step) => step.value));
  return (
    <Panel title="Leads this month" action={<TrendingUp className="size-4 text-text-muted" aria-hidden="true" />}>
      <ul className="flex flex-col gap-3">
        {steps.map((step) => (
          <li key={step.label}>
            <Link href={step.href} className="flex flex-col gap-1 hover:text-brand">
              <span className="flex items-center justify-between text-sm"><span>{step.label}</span><span className="font-semibold tabular-nums">{step.value}</span></span>
              <span className="h-2 overflow-hidden rounded-full bg-surface-muted">
                <span className="block h-full rounded-full bg-brand" style={{ width: `${(step.value / top) * 100}%` }} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function PipelinePanel({ home, money }: { home: CrmHome; money: (value: number | null, compact?: boolean) => string }) {
  const total = home.pipeline.reduce((value, stage) => value + stage.value, 0);
  return (
    <Panel title="Pipeline" description={total ? `${money(total)} open across ${home.pipeline.length} stages` : "No open deal value yet"}
      action={<PanelLink href="/crm/pipeline">Open the board</PanelLink>}>
      {home.pipeline.length === 0 ? <p className="text-sm text-text-muted">No sales stages yet.</p> : (
        <>
          <div className="flex h-3 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
            {total > 0 && home.pipeline.map((stage, index) => stage.value > 0 && (
              <span key={stage.stageId} className="h-full bg-brand" title={`${stage.name}: ${money(stage.value)}`}
                style={{ width: `${(stage.value / total) * 100}%`, opacity: 1 - (index / Math.max(home.pipeline.length, 2)) * 0.7 }} />
            ))}
          </div>
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {home.pipeline.map((stage, index) => (
              <li key={stage.stageId}>
                <Link href={`/crm/opportunities?view=open&stageId=${stage.stageId}`} className="flex h-full flex-col gap-0.5 rounded-[var(--radius-control)] border border-border p-3 hover:border-border-strong hover:bg-surface-muted">
                  <span className="flex items-center gap-1.5 text-xs text-text-secondary">
                    <span className="size-2 shrink-0 rounded-full bg-brand" style={{ opacity: 1 - (index / Math.max(home.pipeline.length, 2)) * 0.7 }} aria-hidden="true" />
                    <span className="truncate">{stage.name}</span>
                  </span>
                  <span className="truncate text-base font-semibold tabular-nums" title={money(stage.value)}>{money(stage.value, true)}</span>
                  <span className="text-xs text-text-muted">{stage.total} {stage.total === 1 ? "deal" : "deals"}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function ActivityPanel({ home }: { home: CrmHome }) {
  return (
    <Panel title="Recent activity" description="The latest changes on leads and deals you can see">
      {home.recentActivity.length === 0 ? <p className="text-sm text-text-muted">Nothing has happened in the last 30 days.</p> : (
        <ol className="flex flex-col">
          {home.recentActivity.map((entry, index) => (
            <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
              {index < home.recentActivity.length - 1 && <span className="absolute top-6 bottom-0 left-[11px] w-px bg-border" aria-hidden="true" />}
              <span className={`flex size-6 shrink-0 items-center justify-center rounded-full [&>svg]:size-3.5 ${entry.recordType === "lead" ? TONE_CHIP.brand : TONE_CHIP.success}`} aria-hidden="true">
                {entry.recordType === "lead" ? <UserPlus /> : <Target />}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                <p className="min-w-0 text-sm">
                  <Link href={`/crm/${entry.recordType === "lead" ? "leads" : "opportunities"}/${entry.recordId}`} className="font-medium hover:underline">{entry.recordName}</Link>
                  <span className="text-text-secondary"> · {readableHistory(entry.summary)}</span>
                </p>
                <span className="shrink-0 text-xs text-text-muted">{[entry.actorName, relativeTime(entry.at)].filter(Boolean).join(" · ")}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </Panel>
  );
}
