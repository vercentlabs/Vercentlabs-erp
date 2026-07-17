const workspaceDateTimeFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Kolkata",
});

const workspaceDateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeZone: "Asia/Kolkata",
});

export function formatWorkspaceDateTime(value: string | Date) {
  return workspaceDateTimeFormatter.format(new Date(value));
}

export function formatWorkspaceDate(value: string | Date) {
  return workspaceDateFormatter.format(new Date(value));
}
