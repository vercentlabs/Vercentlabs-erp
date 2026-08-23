// Prompt 8 (Shared Workspace Foundation) — the normalized shape every
// cross-module aggregation adapter (Tasks, Follow-ups & Reminders,
// Exceptions, Approvals, Notifications) maps its source rows into. Deliberately
// minimal — only what's safe to surface in a shared list (title/subtitle/
// due date/priority/href), never a full record payload. See
// docs/implementation/ERP_SHARED_WORKSPACE_008.md Section 6.
import type { ModuleId } from "@/core/navigation/types";

export type WorkItemKind =
  | "task"
  | "follow_up"
  | "approval"
  | "exception"
  | "notification";

export type WorkItemUrgency = "overdue" | "due_today" | "upcoming" | "none";

export type WorkItem = {
  id: string;
  kind: WorkItemKind;
  moduleId?: ModuleId;
  source: string;
  title: string;
  subtitle?: string;
  dueAt?: string;
  urgency: WorkItemUrgency;
  priority?: string;
  status?: string;
  href: string;
};

// The offset (in minutes) that must be ADDED to a UTC instant to read the
// wall-clock time `date` shows in `timeZone` — i.e. localTime = date +
// offset. Computed by asking Intl what wall-clock reading `date` (a real
// UTC instant) produces in that zone, then diffing against date itself.
// Standard technique; correct for real IANA zone identifiers including
// DST, accurate as of `date` (the same instant "due at" is being compared
// against — the classifier never needs an offset for any other moment).
function timezoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return (asUtc - date.getTime()) / 60_000;
}

// Part 13 (Prompt 10) — apps/web/src/core/auth.ts's getSessionContext()
// already resolves a real, authoritative session.timezone (user
// preference -> organization default -> "UTC"), previously only consumed
// for display formatting (approvals/CRM pages). This is the fix: every
// caller now threads that same value through so "is this due today"
// means "today in the user's own timezone," not the server process's
// local clock. `timeZone` is optional and falls back to the server's own
// local calendar day (the prior behavior) if omitted or invalid — never
// throws on a bad/unknown IANA identifier.
export function classifyDueAt(
  dueAt: Date | string | null | undefined,
  timeZone?: string | null,
  /** Injectable "current time" — defaults to the real clock; only ever overridden by tests, so classification logic can be verified deterministically regardless of when the test suite runs. */
  now: Date = new Date(),
): WorkItemUrgency {
  if (!dueAt) return "none";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "none";

  let startOfToday: Date;
  let startOfTomorrow: Date;
  try {
    if (timeZone) {
      const offsetMinutes = timezoneOffsetMinutes(now, timeZone);
      const localNow = new Date(now.getTime() + offsetMinutes * 60_000);
      const startOfTodayLocalAsUtc = Date.UTC(
        localNow.getUTCFullYear(),
        localNow.getUTCMonth(),
        localNow.getUTCDate(),
      );
      startOfToday = new Date(startOfTodayLocalAsUtc - offsetMinutes * 60_000);
      startOfTomorrow = new Date(startOfToday.getTime() + 24 * 60 * 60_000);
    } else {
      throw new Error("no timezone supplied");
    }
  } catch {
    // Falls back to the server process's own local calendar day — the
    // pre-Prompt-10 behavior — whenever no timezone is supplied or the
    // identifier is invalid, never throwing up into a caller.
    startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    startOfTomorrow = new Date(startOfToday);
    startOfTomorrow.setDate(startOfTomorrow.getDate() + 1);
  }

  if (due < now) return "overdue";
  if (due >= startOfToday && due < startOfTomorrow) return "due_today";
  return "upcoming";
}
