"use client";

// CRM Home answers one question: what do I do next? It is an operational
// workspace, not a BI dashboard. Top to bottom: the four headline figures as a
// slim strip; the user's own agenda for today (each row can be completed,
// rescheduled or snoozed in place) beside what is slipping and this month's
// lead flow; the deals closing soonest; the open pipeline by stage; and what
// just happened. Phones get one column (the pipeline stages scroll sideways),
// tablets pair the side panels, desktops keep the agenda beside them, and very
// wide screens stop growing at a readable width. Every figure and row opens the record or list behind it.
// A section the user may not see (no permission) is left out.
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

const sum = (...values: Array<number | null>) => values.reduce<number>((total, value) => total + (value ?? 0), 0);

export function CrmHomeScreen() {
  const workspace = useWorkspaceContext();
  const query = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "home"), queryFn: getCrmHome, refetchOnWindowFocus: true });
  const home = query.data;
  const firstName = workspace.fullName.split(" ")[0] || workspace.fullName;
  const now = new Date();
  const today = now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });

  return (
    <div className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 md:gap-6">
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
  const money = (value: number | null, compact = false) => (value === null ? "" : formatMoney(home.baseCurrency, value, { compact }));
  const now = new Date();
  const monthStart = ymd(new Date(now.getFullYear(), now.getMonth(), 1));
  const monthEnd = ymd(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  const dueToday = home.sees.tasks || home.sees.followUps ? sum(home.myWork.tasksDueToday, home.myWork.followUpsToday) : null;
  const overdue = sum(home.myWork.overdueTasks, home.myWork.overdueFollowUps);
  const dueTodayHref = home.sees.tasks ? "/crm/activities?tab=tasks&view=due_today" : "/crm/activities?tab=follow-ups&view=due_today";

  return (
    <>
      <section aria-label="Headline figures" className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {home.totals.openLeads !== null && (
          <Kpi icon={<UserPlus />} tone="brand" label="Open leads" value={home.totals.openLeads} href="/crm/leads?status=open"
            caption={home.leadFlow ? `${home.leadFlow.newThisMonth} new this month` : undefined} />
        )}
        {home.totals.pipelineValue !== null && (
          <Kpi icon={<Target />} tone="brand" label="Open pipeline" value={money(home.totals.pipelineValue, true)} title={money(home.totals.pipelineValue)} href="/crm/pipeline"
            caption={home.totals.openOpportunities ? `${home.totals.openOpportunities} open · ${money(home.totals.weightedPipelineValue, true)} weighted` : "No open deals"} />
        )}
        {home.outcomes && (
          // The figure counts this month's wins, so its list shows this month's wins too.
          <Kpi icon={<Trophy />} tone="success" label="Won this month" value={money(home.outcomes.wonValueThisMonth, true)} title={money(home.outcomes.wonValueThisMonth)}
            href={`/crm/opportunities?view=won&closedFrom=${monthStart}&closedTo=${monthEnd}`}
            caption={home.outcomes.wonThisMonth ? `${home.outcomes.wonThisMonth} ${home.outcomes.wonThisMonth === 1 ? "deal" : "deals"}${home.outcomes.winRate !== null ? ` · ${home.outcomes.winRate}% win rate` : ""}` : "No deals won yet"} />
        )}
        {dueToday !== null && (
          <Kpi icon={<Clock />} tone={overdue ? "danger" : "warning"} label="Due today" value={dueToday} href={dueTodayHref}
            caption={overdue ? `${overdue} overdue` : "Nothing overdue"} captionTone={overdue ? "danger" : undefined} />
        )}
      </section>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 md:gap-6 lg:col-span-2">
          {(home.sees.tasks || home.sees.followUps) && <TodayPanel home={home} dueTodayHref={dueTodayHref} />}
          {home.sees.opportunities && <ClosingSoonPanel home={home} money={money} grow />}
        </div>
        {/* Tablets pair the side panels under the agenda; desktops stack them beside it. */}
        <div className="grid min-w-0 content-start gap-4 md:grid-cols-2 md:gap-6 lg:grid-cols-1">
          <AttentionPanel home={home} />
          {home.leadFlow && <LeadFlowPanel flow={home.leadFlow} monthStart={monthStart} />}
        </div>
      </div>

      {home.sees.opportunities && <PipelinePanel home={home} money={money} />}
      <ActivityPanel home={home} />
    </>
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

function Panel({ title, description, action, children, grow = false }: { title: string; description?: string; action?: ReactNode; children: ReactNode; grow?: boolean }) {
  return (
    <section className={`flex min-w-0 flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 md:p-5 ${grow ? "lg:flex-1" : ""}`}>
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

function Empty({ icon, title, description, fill = false }: { icon: ReactNode; title: string; description?: string; fill?: boolean }) {
  return (
    <div className={`flex items-center gap-3 py-2 ${fill ? "lg:flex-1 lg:justify-center lg:py-6" : ""}`}>
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
  const tasks = home.sees.tasks ? sum(home.myWork.tasksDueToday) : 0;
  const followUps = home.sees.followUps ? sum(home.myWork.followUpsToday) : 0;
  const overdue = sum(home.myWork.overdueTasks, home.myWork.overdueFollowUps);
  const due = [tasks && `${tasks} ${tasks === 1 ? "task" : "tasks"}`, followUps && `${followUps} ${followUps === 1 ? "follow-up" : "follow-ups"}`].filter(Boolean).join(" and ");
  const description = due ? `${due} due today${overdue ? `, ${overdue} overdue` : ""}` : overdue ? `${overdue} overdue, nothing else due today` : "Your tasks and follow-ups for today";
  return (
    <Panel title="Today" description={description}
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
              <li key={item.kind + item.id} className="group flex items-center gap-3 py-3 sm:py-2.5">
                <span className={`flex size-8 shrink-0 items-center justify-center rounded-full [&>svg]:size-4 ${item.isOverdue ? TONE_CHIP.danger : TONE_CHIP.brand}`} aria-hidden="true">{icon}</span>
                <div className="flex min-w-0 flex-1 flex-col">
                  <Link href={href} className="truncate text-sm font-medium hover:text-brand hover:underline">{item.title}</Link>
                  <span className="truncate text-xs text-text-muted">
                    <span className={`sm:hidden ${item.isOverdue ? "font-medium text-danger" : ""}`}>{item.isOverdue ? `Overdue · ${formatDate(item.dueAt)}` : item.dueTime ? clockLabel(item.dueTime) : "Today"} · </span>
                    {item.kind === "task" ? "Task" : "Follow-up"}
                    {item.relatedName && <> · {item.relatedHref ? <Link href={item.relatedHref} className="hover:underline">{item.relatedName}</Link> : item.relatedName}</>}
                  </span>
                </div>
                <span className={`hidden shrink-0 text-right text-xs sm:inline ${item.isOverdue ? "font-medium text-danger" : "text-text-secondary"}`}>
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

function ClosingSoonPanel({ home, money, grow = false }: { home: CrmHome; money: (value: number | null) => string; grow?: boolean }) {
  return (
    <Panel grow={grow} title="Closing soon" description={`Open deals due to close in the next ${home.needsAttention.closingSoonDays} days, or already past their date`}
      action={<PanelLink href={`/crm/opportunities?view=open&expectedCloseTo=${closingBy(home.needsAttention.closingSoonDays)}`}>All deals</PanelLink>}>
      {home.closingSoon.length === 0 ? (
        <Empty fill={grow} icon={<CheckCircle2 />} title="No deals closing soon" description={`Nothing is due to close in the next ${home.needsAttention.closingSoonDays} days.`} />
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
                  <span className={`text-right text-xs sm:w-28 ${deal.overdue ? "font-medium text-danger" : "text-text-secondary"}`}>
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
  const items = flagged.reduce((total, row) => total + row.value, 0);
  return (
    <Panel title="Needs attention" description={flagged.length ? `${items} ${items === 1 ? "record" : "records"} to review` : "Nothing is slipping"}>
      <ul className="flex flex-col gap-1">
        {[...flagged, ...rows.filter((row) => row.value === 0)].map((row) => (
          <li key={row.label}>
            {row.value > 0 ? (
              <Link href={row.href} className={`group flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-2.5 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-brand ${row.tone === "danger" ? "bg-danger-soft" : "bg-warning-soft"}`}>
                <AlertTriangle className={`size-4 shrink-0 ${row.tone === "danger" ? "text-danger" : "text-warning"}`} aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                <span className={`font-semibold tabular-nums ${row.tone === "danger" ? "text-danger" : "text-warning"}`}>{row.value}</span>
                <ArrowRight className="size-3.5 shrink-0 text-text-muted transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </Link>
            ) : (
              <Link href={row.href} className="flex items-center gap-3 rounded-[var(--radius-control)] px-3 py-1.5 text-sm text-text-muted hover:bg-surface-muted">
                <CheckCircle2 className="size-4 shrink-0 text-success" aria-hidden="true" />
                <span className="min-w-0 flex-1 truncate">{row.label}</span>
                <span className="text-xs">None</span>
              </Link>
            )}
          </li>
        ))}
      </ul>
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
  const rate = (value: number) => (flow.newThisMonth ? `${Math.round((value / flow.newThisMonth) * 100)}%` : null);
  return (
    <Panel title="Leads this month" description={flow.newThisMonth ? `${flow.newThisMonth} new · ${rate(flow.convertedThisMonth)} converted so far` : "No new leads yet this month"}
      action={<TrendingUp className="size-4 text-text-muted" aria-hidden="true" />}>
      <ul className="flex flex-col gap-3">
        {steps.map((step, index) => (
          <li key={step.label}>
            <Link href={step.href} className="group flex flex-col gap-1.5 rounded-[var(--radius-control)] outline-none focus-visible:ring-2 focus-visible:ring-brand">
              <span className="flex items-baseline justify-between gap-2 text-sm">
                <span className="group-hover:text-brand">{step.label}</span>
                <span className="flex items-baseline gap-2">
                  {index > 0 && rate(step.value) && <span className="text-xs text-text-muted">{rate(step.value)}</span>}
                  <span className="font-semibold tabular-nums">{step.value}</span>
                </span>
              </span>
              <span className="h-2 overflow-hidden rounded-full bg-surface-muted">
                <span className="block h-full rounded-full bg-brand transition-[width]" style={{ width: `${(step.value / top) * 100}%`, opacity: 1 - index * 0.25, minWidth: step.value ? "0.5rem" : 0 }} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// The open pipeline as one row of stages, in order: each stage's value, its deal count and its share of the open value (a bar, so the
// heaviest stage reads at a glance). Stages fill the row on any screen; phones scroll them sideways. With no open deals yet, the stages
// stay visible but quiet, and one line says how to start.
function PipelinePanel({ home, money }: { home: CrmHome; money: (value: number | null, compact?: boolean) => string }) {
  const total = home.pipeline.reduce((value, stage) => value + stage.value, 0);
  const deals = home.pipeline.reduce((count, stage) => count + stage.total, 0);
  const shade = (index: number) => 1 - (index / Math.max(home.pipeline.length, 2)) * 0.65;
  return (
    <Panel title="Pipeline" description={deals ? `${money(total)} open in ${deals} ${deals === 1 ? "deal" : "deals"} across ${home.pipeline.length} stages` : "No open deals yet"}
      action={<PanelLink href="/crm/pipeline">Open the board</PanelLink>}>
      {home.pipeline.length === 0 ? <p className="text-sm text-text-muted">No sales stages yet.</p> : (
        <>
          {total > 0 && (
            <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
              {home.pipeline.map((stage, index) => stage.value > 0 && (
                <span key={stage.stageId} className="h-full bg-brand first:rounded-l-full last:rounded-r-full" title={`${stage.name}: ${money(stage.value)}`}
                  style={{ width: `${(stage.value / total) * 100}%`, opacity: shade(index) }} />
              ))}
            </div>
          )}
          <ol className="-mx-4 flex snap-x snap-mandatory gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:overflow-visible sm:px-0 sm:pb-0"
            style={{ gridTemplateColumns: `repeat(auto-fit, minmax(${home.pipeline.length > 6 ? 8.5 : 9.5}rem, 1fr))` }}>
            {home.pipeline.map((stage, index) => {
              const share = total > 0 ? Math.round((stage.value / total) * 100) : 0;
              const empty = stage.total === 0;
              return (
                <li key={stage.stageId} className="w-40 shrink-0 snap-start sm:w-auto">
                  <Link href={`/crm/opportunities?view=open&stageId=${stage.stageId}`}
                    className={`group flex h-full flex-col gap-1.5 rounded-[var(--radius-control)] border p-3 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-brand ${empty
                      ? "border-dashed border-border bg-surface hover:bg-surface-muted" : "border-border bg-surface hover:border-border-strong hover:bg-surface-muted"}`}>
                    <span className="flex items-center gap-1.5 text-xs font-medium text-text-secondary">
                      <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-brand text-[10px] font-semibold text-white" style={{ opacity: shade(index) }} aria-hidden="true">{index + 1}</span>
                      <span className="truncate" title={stage.name}>{stage.name}</span>
                    </span>
                    <span className={`truncate text-lg font-semibold tabular-nums ${empty ? "text-text-muted" : "text-text"}`} title={money(stage.value)}>{empty ? "—" : money(stage.value, true)}</span>
                    <span className="flex items-center justify-between gap-2 text-xs text-text-muted">
                      <span>{empty ? "No deals" : `${stage.total} ${stage.total === 1 ? "deal" : "deals"}`}</span>
                      {!empty && total > 0 && <span className="tabular-nums">{share}%</span>}
                    </span>
                    <span className="mt-auto h-1 overflow-hidden rounded-full bg-surface-muted" aria-hidden="true">
                      <span className="block h-full rounded-full bg-brand" style={{ width: `${share}%`, opacity: shade(index) }} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
          {deals === 0 && (
            <p className="text-sm text-text-secondary">
              Deals appear here by stage as you create them. <Link href="/crm/opportunities/new" className="font-medium text-brand hover:underline">Create a deal</Link>
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

// What just happened, newest first, grouped by day: one sentence per change ("Atharva Chavan created the lead Ayush"), the change itself
// beneath when there is more to say, and the time of day. The record opens from its name.
const dayLabel = (value: string) => {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Today";
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" });
};
const timeOfDay = (value: string) => new Date(value).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
const initials = (name: string | null) => (name ?? "").split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
// A steady colour per person, so the same person reads the same everywhere.
const AVATAR = ["bg-brand-soft text-brand", "bg-success-soft text-success", "bg-warning-soft text-warning", "bg-danger-soft text-danger"];
const avatarTone = (name: string | null) => AVATAR[[...(name ?? "")].reduce((total, char) => total + char.charCodeAt(0), 0) % AVATAR.length];
// The verb of the change, from its summary; the summary stays as the detail unless the verb says it all.
function describe(summary: string) {
  const text = readableHistory(summary);
  if (/\bcreated\b/i.test(text)) return { verb: "created", detail: null };
  if (/^owner\b/i.test(text)) return { verb: "reassigned", detail: text.replace(/^owner:\s*/i, "Owner ") };
  if (/^(stage|status)\b/i.test(text)) return { verb: "moved", detail: text };
  if (/\b(won|lost)\b/i.test(text)) return { verb: "closed", detail: text };
  if (/\bconverted\b/i.test(text)) return { verb: "converted", detail: null };
  return { verb: "updated", detail: text };
}

function ActivityPanel({ home }: { home: CrmHome }) {
  const groups: Array<{ label: string; entries: CrmHome["recentActivity"] }> = [];
  for (const entry of home.recentActivity) {
    const label = dayLabel(entry.at);
    const group = groups[groups.length - 1];
    if (group?.label === label) group.entries.push(entry); else groups.push({ label, entries: [entry] });
  }
  return (
    <Panel title="Recent activity" description="The latest changes on leads and deals you can see">
      {home.recentActivity.length === 0 ? <p className="text-sm text-text-muted">Nothing has happened in the last 30 days.</p> : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => (
            <section key={group.label} aria-label={group.label} className="flex flex-col gap-2">
              <h3 className="flex items-center gap-3 text-xs font-medium text-text-muted">
                {group.label}<span className="h-px flex-1 bg-border" aria-hidden="true" />
              </h3>
              <ol className="flex flex-col">
                {group.entries.map((entry, index) => {
                  const lead = entry.recordType === "lead";
                  const { verb, detail } = describe(entry.summary);
                  return (
                    <li key={entry.id} className="relative flex gap-3 pb-4 last:pb-0">
                      {index < group.entries.length - 1 && <span className="absolute top-8 bottom-0 left-[13px] w-px bg-border" aria-hidden="true" />}
                      <span className={`relative flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${avatarTone(entry.actorName)}`} title={entry.actorName ?? "System"} aria-hidden="true">
                        {entry.actorName ? initials(entry.actorName) : <Clock className="size-3.5" />}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
                        <div className="flex min-w-0 flex-col gap-0.5">
                          <p className="text-sm leading-6 text-text-secondary">
                            <span className="font-medium text-text">{entry.actorName ?? "Someone"}</span>
                            {` ${verb} the ${lead ? "lead" : "deal"} `}
                            <Link href={`/crm/${lead ? "leads" : "opportunities"}/${entry.recordId}`} className="font-medium text-text hover:text-brand hover:underline">{entry.recordName}</Link>
                          </p>
                          {detail && <p className="text-xs text-text-muted">{detail}</p>}
                        </div>
                        <time dateTime={entry.at} title={new Date(entry.at).toLocaleString("en-IN")} className="shrink-0 text-xs leading-6 text-text-muted tabular-nums">{timeOfDay(entry.at)}</time>
                      </div>
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
      )}
    </Panel>
  );
}
