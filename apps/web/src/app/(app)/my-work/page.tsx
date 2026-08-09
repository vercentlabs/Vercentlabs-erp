import Link from "next/link";

import AppIcon from "@/components/app-icon";
import WorkItemList from "@/components/work-item-list";
import { requireWorkspace } from "@/lib/auth";
import { getMyWorkSummary } from "@/lib/my-work/aggregate";
import { listFavourites } from "@/lib/favourites";
import { listRecentRecords } from "@/lib/recent-records";

export const metadata = { title: "My work" };
export const dynamic = "force-dynamic";

export default async function MyWorkPage() {
  const session = await requireWorkspace();
  const [summary, favourites, recent] = await Promise.all([
    getMyWorkSummary(session, 5),
    listFavourites(session, 5),
    listRecentRecords(session, 5),
  ]);

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

      <section className="content-grid dashboard-panels">
        <article className="panel activity-panel">
          <div className="card-title-row">
            <div>
              <p className="eyebrow">Continue where you left off</p>
              <h2>Recent records</h2>
            </div>
            <Link href="/recent">
              View all <AppIcon name="arrow-right" size={16} />
            </Link>
          </div>
          <div className="stack-list">
            {recent.map((item) => (
              <Link href={item.href} key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.moduleKey || item.targetType}</span>
                </div>
              </Link>
            ))}
            {!recent.length ? (
              <div className="empty-state compact">
                <span className="empty-state-icon" aria-hidden="true">
                  <AppIcon name="check" size={20} />
                </span>
                <div>
                  <strong>Nothing viewed yet</strong>
                  <p>Records you open will be listed here.</p>
                </div>
              </div>
            ) : null}
          </div>
        </article>

        <article className="panel activity-panel">
          <div className="card-title-row">
            <div>
              <p className="eyebrow">Saved by you</p>
              <h2>Favourites</h2>
            </div>
            <Link href="/favourites">
              View all <AppIcon name="arrow-right" size={16} />
            </Link>
          </div>
          <div className="stack-list">
            {favourites.map((item) => (
              <Link href={item.href} key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <span>{item.moduleKey || item.targetType}</span>
                </div>
              </Link>
            ))}
            {!favourites.length ? (
              <div className="empty-state compact">
                <span className="empty-state-icon" aria-hidden="true">
                  <AppIcon name="check" size={20} />
                </span>
                <div>
                  <strong>No favourites yet</strong>
                  <p>Star a record from its page to pin it here.</p>
                </div>
              </div>
            ) : null}
          </div>
        </article>
      </section>
    </>
  );
}
