"use client";

import Link from "next/link";

import { FollowUpListScreen } from "@/features/crm/follow-ups/screens/FollowUpListScreen";
import { CommunicationListScreen } from "@/features/crm/inbox/communications/screens/CommunicationListScreen";
import { NotesFilesScreen } from "@/features/crm/notes/screens/NotesFilesScreen";
import { TaskListScreen } from "@/features/crm/tasks/screens/TaskListScreen";
import { CallListScreen } from "@/features/crm/work/calls/screens/CallListScreen";
import { MeetingListScreen } from "@/features/crm/work/meetings/screens/MeetingListScreen";
import { TodayWorkView } from "@/features/crm/work/screens/TodayWorkView";

import { ACTIVITY_TABS, type ActivityTab } from "./activity-tabs";

// CRM Activities: one workspace for every activity — the day's work, tasks, follow-ups, calls, meetings, notes and files, and the inbox.
// Each tab is the existing screen, unchanged (same API clients, permissions and actions); only the selected tab is mounted, so nothing
// else fetches. The tab is in the URL (/crm/activities?tab=tasks), so it survives refresh, back/forward and sharing; /crm/tasks,
// /crm/follow-ups, /crm/calls, /crm/meetings, /crm/notes-files, /crm/communications and /crm/work redirect here with their query intact.
function TabContent({ tab }: { tab: ActivityTab }) {
  switch (tab) {
    case "tasks":
      return <TaskListScreen />;
    case "follow-ups":
      return <FollowUpListScreen />;
    case "calls":
      return <CallListScreen />;
    case "meetings":
      return <MeetingListScreen />;
    case "notes-files":
      return <NotesFilesScreen />;
    case "inbox":
      return <CommunicationListScreen />;
    default:
      return <TodayWorkView />;
  }
}

export function ActivitiesScreen({ tab }: { tab: ActivityTab }) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <nav aria-label="Activities" className="-mb-1 overflow-x-auto">
        <ul className="flex min-w-max gap-1 border-b border-border">
          {ACTIVITY_TABS.map((item) => {
            const current = item.id === tab;
            return (
              <li key={item.id}>
                <Link
                  href={`/crm/activities?tab=${item.id}`}
                  aria-current={current ? "page" : undefined}
                  className={[
                    "-mb-px flex border-b-2 px-3 py-2 text-sm font-medium transition-colors outline-none",
                    "focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
                    current ? "border-brand text-text" : "border-transparent text-text-secondary hover:text-text",
                  ].join(" ")}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <TabContent tab={tab} />
    </div>
  );
}
