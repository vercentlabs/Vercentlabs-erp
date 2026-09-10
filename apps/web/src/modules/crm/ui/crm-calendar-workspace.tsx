import Link from "next/link";

import { ActionLink, PageHeader, StatePanel, StatusBadge, Surface, Tabs } from "@/shared/design";

type Row = Record<string, unknown>;

function dateKey(value: unknown) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "Unscheduled" : date.toISOString().slice(0, 10);
}

function dateLabel(value: string, locale?: string) {
  if (value === "Unscheduled") return value;
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date);
}

function timeLabel(value: unknown, locale?: string) {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime()) ? "Time not set" : new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(date);
}

export default function CrmCalendarWorkspace({
  meetings,
  due,
  locale,
  canManage,
}: {
  meetings: Row[];
  due: "all" | "today" | "upcoming" | "overdue";
  locale?: string;
  canManage: boolean;
}) {
  const grouped = new Map<string, Row[]>();
  for (const meeting of meetings) {
    const key = dateKey(meeting.startedAt || meeting.plannedStartAt || meeting.startAt || meeting.dueAt);
    grouped.set(key, [...(grouped.get(key) || []), meeting]);
  }
  const days = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="crm-calendar-page">
      <PageHeader
        eyebrow="CRM · Work"
        title="Calendar"
        description="A responsive agenda for customer meetings. Use it to see what is happening next, then open the meeting or its related CRM record without losing context."
        context={<StatusBadge tone="neutral">{meetings.length} meeting{meetings.length === 1 ? "" : "s"}</StatusBadge>}
        actions={canManage ? <ActionLink tone="primary" href="/crm/meetings?create=1">Schedule meeting</ActionLink> : null}
      />

      <Tabs
        label="Calendar range"
        items={[
          { href: "/crm/calendar", label: "All", current: due === "all" },
          { href: "/crm/calendar?due=today", label: "Today", current: due === "today" },
          { href: "/crm/calendar?due=upcoming", label: "Upcoming", current: due === "upcoming" },
          { href: "/crm/calendar?due=overdue", label: "Overdue", current: due === "overdue" },
        ]}
      />

      {days.length ? (
        <div className="crm-calendar-agenda" aria-label="Meeting agenda">
          {days.map(([day, rows]) => (
            <section className="crm-calendar-day" key={day} aria-labelledby={`crm-calendar-${day}`}>
              <header>
                <div>
                  <span>{day === "Unscheduled" ? "—" : new Date(`${day}T12:00:00Z`).getUTCDate()}</span>
                  <div>
                    <small>{day === "Unscheduled" ? "Schedule" : new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`))}</small>
                    <h2 id={`crm-calendar-${day}`}>{dateLabel(day, locale)}</h2>
                  </div>
                </div>
                <StatusBadge tone="neutral">{rows.length}</StatusBadge>
              </header>
              <Surface padding="none" className="crm-calendar-day__surface">
                <div className="crm-calendar-events">
                  {rows.map((meeting, index) => {
                    const id = String(meeting.id || "");
                    const subject = String(meeting.subject || meeting.title || "Customer meeting");
                    const related = String(meeting.leadName || meeting.contactName || meeting.accountName || meeting.entityName || "CRM meeting");
                    const start = meeting.startedAt || meeting.plannedStartAt || meeting.startAt || meeting.dueAt;
                    return (
                      <article className="crm-calendar-event" key={id || `${day}-${index}`}>
                        <time dateTime={String(start || "")}>{timeLabel(start, locale)}</time>
                        <div>
                          <strong>{subject}</strong>
                          <span>{related}</span>
                          <small>{String(meeting.status || "scheduled").replaceAll("_", " ")}</small>
                        </div>
                        <Link href={id ? `/crm/meetings?edit=${encodeURIComponent(id)}` : "/crm/meetings"}>Open <span className="sr-only">{subject}</span></Link>
                      </article>
                    );
                  })}
                </div>
              </Surface>
            </section>
          ))}
        </div>
      ) : (
        <StatePanel
          title="No meetings in this view"
          description="Change the calendar range or schedule the next customer meeting."
          action={canManage ? <ActionLink href="/crm/meetings?create=1">Schedule meeting</ActionLink> : <ActionLink href="/crm/meetings">Open meetings</ActionLink>}
        />
      )}
    </div>
  );
}
