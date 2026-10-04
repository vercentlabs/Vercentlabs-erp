"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import {
  Button,
  Menu,
  MenuItem,
  MenuTrigger,
  MetricCard,
  PageHeader,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { getTaskSummary } from "@/features/crm/tasks/api/tasks-api";
import { getFollowUpSummary } from "@/features/crm/follow-ups/api/follow-ups-api";
import { CrmDashboardScreen } from "@/features/crm/home/dashboard/screens/CrmDashboardScreen";

const CREATE_LINKS = [
  { label: "Lead", href: "/crm/leads/new" },
  { label: "Account", href: "/crm/accounts/new" },
  { label: "Contact", href: "/crm/contacts/new" },
  { label: "Opportunity", href: "/crm/opportunities/new" },
  { label: "Call", href: "/crm/calls/new" },
  { label: "Meeting", href: "/crm/meetings/new" },
  { label: "Follow-up", href: "/crm/follow-ups/new" },
  { label: "Task", href: "/crm/tasks/new" },
];

// CRM Home is the command centre and the only CRM overview: the canonical
// pipeline dashboard (F024 — every figure a permission-safe aggregate that
// opens the records behind it) under a personal header. /crm/dashboard
// redirects here, so there is one set of KPIs, not two copies. Workspaces
// are reached from the CRM sidebar, not repeated here as tiles.
export function CrmHomeScreen() {
  const router = useRouter();
  const workspace = useWorkspaceContext();
  return (
    <div className="flex flex-1 flex-col gap-6">
      <PageHeader
        title={`Welcome back, ${workspace.fullName.split(" ")[0] || workspace.fullName}`}
        description="What changed, what needs attention, and what to do next. Every number opens the records behind it."
        primaryAction={
          <MenuTrigger>
            <Button variant="primary">
              <Plus className="size-4" aria-hidden="true" />
              Create
            </Button>
            <Menu onAction={(key) => router.push(String(key))}>
              {CREATE_LINKS.map((link) => (
                <MenuItem key={link.href} id={link.href}>
                  {link.label}
                </MenuItem>
              ))}
            </Menu>
          </MenuTrigger>
        }
      />
      <MyFollowUpsStrip />
      <MyTasksStrip />
      <CrmDashboardScreen embedded />
    </div>
  );
}

// The salesperson's own work, before the pipeline: what is overdue, due today and high priority.
function MyTasksStrip() {
  const workspace = useWorkspaceContext();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "tasks", "summary"), queryFn: getTaskSummary, retry: false, refetchOnWindowFocus: true });
  if (!summary.data) return null;
  const cards = [
    { label: "My tasks due today", value: summary.data.dueToday, href: "/crm/tasks?view=due_today" },
    { label: "My overdue tasks", value: summary.data.overdue, href: "/crm/tasks?view=overdue" },
    { label: "My high-priority tasks", value: summary.data.highPriority, href: "/crm/tasks?view=high_priority" },
    ...(summary.data.teamOverdue === null ? [] : [{ label: "Team overdue tasks", value: summary.data.teamOverdue, href: "/crm/tasks?view=team&status=overdue" }]),
  ];
  return (
    <section aria-label="My tasks" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((card) => (
        <Link key={card.href} href={card.href} className="rounded-[var(--radius-card)] outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand">
          <MetricCard label={card.label} value={card.value} />
        </Link>
      ))}
    </section>
  );
}

// Who to contact today, and who was missed: the follow-ups waiting for the caller (and a manager's team).
function MyFollowUpsStrip() {
  const workspace = useWorkspaceContext();
  const summary = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "follow-ups", "summary"), queryFn: getFollowUpSummary, retry: false, refetchOnWindowFocus: true });
  if (!summary.data) return null;
  const cards = [
    { label: "Follow-ups due today", value: summary.data.dueToday, href: "/crm/follow-ups?view=due_today" },
    { label: "Overdue follow-ups", value: summary.data.overdue, href: "/crm/follow-ups?view=overdue" },
    { label: "Upcoming follow-ups", value: summary.data.upcoming, href: "/crm/follow-ups?view=upcoming" },
    ...(summary.data.teamOverdue === null ? [] : [{ label: "Team overdue follow-ups", value: summary.data.teamOverdue, href: "/crm/follow-ups?view=team&status=overdue" }]),
  ];
  return (
    <section aria-label="My follow-ups" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {cards.map((card) => (
        <Link key={card.href} href={card.href} className="rounded-[var(--radius-card)] outline-none transition-shadow hover:shadow-md focus-visible:ring-2 focus-visible:ring-brand">
          <MetricCard label={card.label} value={card.value} />
        </Link>
      ))}
    </section>
  );
}
