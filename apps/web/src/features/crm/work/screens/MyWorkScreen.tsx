"use client";

import Link from "next/link";

import { TaskListScreen } from "@/features/crm/tasks/screens/TaskListScreen";
import { CallListScreen } from "@/features/crm/work/calls/screens/CallListScreen";
import { MeetingListScreen } from "@/features/crm/work/meetings/screens/MeetingListScreen";
import { FollowUpListScreen } from "@/features/crm/work/follow-ups/screens/FollowUpListScreen";
import { CommunicationListScreen } from "@/features/crm/inbox/communications/screens/CommunicationListScreen";

import { MY_WORK_VIEWS, type MyWorkView } from "../my-work-views";
import { TodayWorkView } from "./TodayWorkView";

// My Work: one CRM workspace for the day's activity work. Each view is the
// existing screen, unchanged (same API clients, permissions and actions);
// only the selected view is mounted, so nothing else fetches. The view is in
// the URL (/crm/work?view=tasks), so it survives refresh, back/forward and
// sharing; /crm/tasks, /crm/calls, /crm/meetings, /crm/follow-ups and
// /crm/communications redirect here with their query intact.
function ViewContent({ view }: { view: MyWorkView }) {
  switch (view) {
    case "tasks":
      return <TaskListScreen />;
    case "calls":
      return <CallListScreen />;
    case "meetings":
      return <MeetingListScreen />;
    case "follow-ups":
      return <FollowUpListScreen />;
    case "inbox":
      return <CommunicationListScreen />;
    default:
      return <TodayWorkView />;
  }
}

export function MyWorkScreen({ view }: { view: MyWorkView }) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <nav aria-label="My Work" className="-mb-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-border">
          {MY_WORK_VIEWS.map((item) => {
            const current = item.id === view;
            return (
              <li key={item.id}>
                <Link
                  href={`/crm/work?view=${item.id}`}
                  aria-current={current ? "page" : undefined}
                  className={[
                    "-mb-px flex border-b-2 px-3 py-2 text-sm font-medium transition-colors outline-none",
                    "focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
                    current
                      ? "border-brand text-text"
                      : "border-transparent text-text-secondary hover:text-text",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <ViewContent view={view} />
    </div>
  );
}
