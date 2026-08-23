import Link from "next/link";

import AppIcon from "@/components/app-icon";
import WorkItemList from "@/components/work-item-list";
import { requireWorkspace } from "@/lib/auth";
import { getMyWorkSummary } from "@/lib/my-work/aggregate";

export const metadata = { title: "My work" };
export const dynamic = "force-dynamic";

export default async function MyWorkPage() {
  const session = await requireWorkspace();
  const summary = await getMyWorkSummary(session, 5);

  const metrics = [
    {
      label: "Tasks overdue or due today",
      value: summary.counts.tasksOverdue,
      href: "/tasks",
      icon: "approvals" as const,
    },
    {
      label: "Follow-ups due today",
      value: summary.counts.followUpsDueToday,
      href: "/follow-ups",
      icon: "notifications" as const,
    },
    {
      label: "Open exceptions",
      value: summary.counts.exceptionsOpen,
      href: "/exceptions",
      icon: "security" as const,
    },
    {
      label: "Pending approvals",
      value: summary.counts.approvalsPending,
      href: "/approvals",
      icon: "approvals" as const,
    },
    {
      label: "Unread notifications",
      value: summary.unreadNotifications,
      href: "/notifications",
      icon: "notifications" as const,
    },
  ];

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">My work</p>
          <h1>Everything assigned or waiting on you</h1>
          <p>
            Tasks, follow-ups, exceptions and approvals you already have access
            to — collected in one place, nothing new granted here.
          </p>
        </div>
      </section>

      <section className="metric-grid" aria-label="Requires attention">
        {metrics.map((metric) => (
          <Link
            className={`metric-card${metric.value ? " attention" : ""}`}
            href={metric.href}
            key={metric.label}
          >
            <span className="metric-icon" aria-hidden="true">
              <AppIcon name={metric.icon} size={21} />
            </span>
            <span className="metric-copy">
              <small>{metric.label}</small>
              <strong>{metric.value}</strong>
            </span>
            <AppIcon className="metric-arrow" name="arrow-right" size={17} />
          </Link>
        ))}
      </section>

      <section className="content-grid dashboard-panels">
        <article className="panel activity-panel">
          <div className="card-title-row">
            <div>
              <p className="eyebrow">Requires attention</p>
              <h2>My tasks</h2>
            </div>
            <Link href="/tasks">
              View all <AppIcon name="arrow-right" size={16} />
            </Link>
          </div>
          <WorkItemList
            items={summary.tasks}
            emptyTitle="No open tasks"
            emptyDescription="Work assigned to you across CRM and Projects will appear here."
          />
        </article>

        <article className="panel activity-panel">
          <div className="card-title-row">
            <div>
              <p className="eyebrow">Requires attention</p>
              <h2>Follow-ups &amp; reminders</h2>
            </div>
            <Link href="/follow-ups">
              View all <AppIcon name="arrow-right" size={16} />
            </Link>
          </div>
          <WorkItemList
            items={summary.followUps}
            emptyTitle="No follow-ups due"
            emptyDescription="Leads you own with a scheduled follow-up will appear here."
          />
        </article>

        <article className="panel activity-panel">
          <div className="card-title-row">
            <div>
              <p className="eyebrow">Requires attention</p>
              <h2>Exceptions</h2>
            </div>
            <Link href="/exceptions">
              View all <AppIcon name="arrow-right" size={16} />
            </Link>
          </div>
          <WorkItemList
            items={summary.exceptions}
            emptyTitle="No open exceptions"
            emptyDescription="Governance exceptions you have permission to see will appear here."
          />
        </article>

        <article className="panel activity-panel">
          <div className="card-title-row">
            <div>
              <p className="eyebrow">Requires attention</p>
              <h2>Approvals</h2>
            </div>
            <Link href="/approvals">
              View all <AppIcon name="arrow-right" size={16} />
            </Link>
          </div>
          <WorkItemList
            items={summary.approvals}
            emptyTitle="Nothing pending"
            emptyDescription="Approval requests assigned to you will appear here."
          />
        </article>
      </section>

    </>
  );
}
