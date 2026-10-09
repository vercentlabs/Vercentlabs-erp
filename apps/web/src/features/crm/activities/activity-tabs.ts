// The CRM Activities tabs — plain data shared by the server page (which validates ?tab=) and the client screen (which renders the tab
// bar). Kept out of the "use client" module: a server component cannot call a function exported from a client module.
export const ACTIVITY_TABS = [
  { id: "today", label: "Today" },
  { id: "tasks", label: "Tasks" },
  { id: "follow-ups", label: "Follow-ups" },
  { id: "calls", label: "Calls" },
  { id: "meetings", label: "Meetings" },
  { id: "notes-files", label: "Notes & Files" },
  { id: "inbox", label: "Inbox" },
] as const;

export type ActivityTab = (typeof ACTIVITY_TABS)[number]["id"];

export function isActivityTab(value: unknown): value is ActivityTab {
  return ACTIVITY_TABS.some((tab) => tab.id === value);
}
