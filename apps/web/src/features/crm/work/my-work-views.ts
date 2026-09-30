// My Work views — plain data shared by the server page (which validates
// ?view=) and the client screen (which renders the view bar). Kept out of
// the "use client" screen module: a server component cannot call a
// function exported from a client module.
export const MY_WORK_VIEWS = [
  { id: "today", label: "Today" },
  { id: "tasks", label: "Tasks" },
  { id: "calls", label: "Calls" },
  { id: "meetings", label: "Meetings" },
  { id: "follow-ups", label: "Follow-ups" },
  { id: "inbox", label: "Inbox" },
] as const;

export type MyWorkView = (typeof MY_WORK_VIEWS)[number]["id"];

export function isMyWorkView(value: unknown): value is MyWorkView {
  return MY_WORK_VIEWS.some((view) => view.id === value);
}
