// The single composition point for My Work / Home's "Attention" section
// (Prompt 8, Parts 3 and 12-14). Bounded parallel adapters via
// Promise.allSettled — a failing source is omitted, never allowed to fail
// the whole page or fall back to unscoped data (Part 67). No "attention
// score": plain counts and category buckets only, nothing invented.
import type { WorkspaceSessionContext } from "@/core/auth";
import {
  listMyApprovals,
  pendingApprovalsAsWorkItems,
} from "@/core/work/approvals";
import { listMyExceptions } from "@/core/work/exceptions";
import { listMyFollowUps } from "@/core/work/follow-ups";
import { countUnreadNotifications } from "@/core/work/notifications";
import { listMyTasks } from "@/core/work/tasks";
import type { WorkItem } from "@/core/work/types";

export type MyWorkSummary = {
  tasks: WorkItem[];
  followUps: WorkItem[];
  exceptions: WorkItem[];
  approvals: WorkItem[];
  unreadNotifications: number;
  counts: {
    tasksOverdue: number;
    followUpsDueToday: number;
    exceptionsOpen: number;
    approvalsPending: number;
  };
};

function countUrgent(items: WorkItem[]) {
  return items.filter(
    (item) => item.urgency === "overdue" || item.urgency === "due_today",
  ).length;
}

export async function getMyWorkSummary(
  session: WorkspaceSessionContext,
  perSourceLimit = 5,
): Promise<MyWorkSummary> {
  const [tasks, followUps, exceptions, approvalRows, unreadNotifications] =
    await Promise.allSettled([
      listMyTasks(session, 50),
      listMyFollowUps(session, 50),
      listMyExceptions(session, 50),
      listMyApprovals(session, 100),
      countUnreadNotifications(session),
    ]);

  const tasksList = tasks.status === "fulfilled" ? tasks.value : [];
  const followUpsList = followUps.status === "fulfilled" ? followUps.value : [];
  const exceptionsList =
    exceptions.status === "fulfilled" ? exceptions.value : [];
  const approvalsList =
    approvalRows.status === "fulfilled"
      ? pendingApprovalsAsWorkItems(approvalRows.value, 50)
      : [];

  return {
    tasks: tasksList.slice(0, perSourceLimit),
    followUps: followUpsList.slice(0, perSourceLimit),
    exceptions: exceptionsList.slice(0, perSourceLimit),
    approvals: approvalsList.slice(0, perSourceLimit),
    unreadNotifications:
      unreadNotifications.status === "fulfilled" ? unreadNotifications.value : 0,
    counts: {
      tasksOverdue: countUrgent(tasksList),
      followUpsDueToday: countUrgent(followUpsList),
      exceptionsOpen: exceptionsList.length,
      approvalsPending: approvalsList.length,
    },
  };
}
