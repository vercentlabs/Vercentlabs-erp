"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCheck } from "lucide-react";
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Tab,
  TabList,
  Tabs,
} from "@vercentlabs/design-system";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";

// Shape of GET /api/notifications. Items the viewer can no longer open arrive
// already redacted by the server (neutral text, no link); they stay in the
// list so the unread count and the list always agree.
type Notification = {
  id: string;
  title: string;
  message: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
  redacted?: boolean;
};

const TABS = [
  { key: "all", label: "All" },
  { key: "unread", label: "Unread" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

const formatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

// Throw on a non-ok response so TanStack Query runs onError (a 403/404 must
// never look like a successful "mark read").
async function send(url: string, fallback: string) {
  const response = await fetch(url, { method: "PATCH" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      message?: string;
    };
    throw new Error(payload.message || fallback);
  }
}

// The list, its tab and the read actions — shared by this page and the top bar's bell panel (NotificationsPanel.tsx). Reading
// something also refreshes the server-rendered shell, so the bell's unread badge follows.
export function useNotifications() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("all");
  const baseKey = scopedQueryKey(workspace, "notifications");
  const query = useQuery({
    queryKey: [...baseKey, tab],
    queryFn: async () => {
      const response = await fetch(`/api/notifications?status=${tab}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false)
        throw new Error(payload.message || "Could not load notifications.");
      return payload as { notifications: Notification[]; unreadCount: number };
    },
  });
  const refresh = () => {
    router.refresh();
    return queryClient.invalidateQueries({ queryKey: baseKey });
  };
  const markRead = useMutation({
    mutationFn: (id: string) =>
      send(
        `/api/notifications/${id}/read`,
        "Could not mark this notification as read.",
      ),
    onSuccess: refresh,
  });
  const markAllRead = useMutation({
    mutationFn: () =>
      send("/api/notifications", "Could not mark all notifications as read."),
    onSuccess: refresh,
  });

  const notifications = query.data?.notifications ?? [];
  const unreadCount = query.data?.unreadCount ?? 0;
  const failure =
    (markRead.error as Error | null)?.message ||
    (markAllRead.error as Error | null)?.message;
  return { tab, setTab, query, notifications, unreadCount, markRead, markAllRead, failure };
}

export function NotificationsScreen() {
  const { tab, setTab, query, notifications, unreadCount, markRead, markAllRead, failure } = useNotifications();
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Notifications"
        description={
          !query.data
            ? undefined
            : unreadCount > 0
              ? `${unreadCount} unread`
              : "You're all caught up."
        }
        primaryAction={
          unreadCount > 0 ? (
            <Button
              variant="secondary"
              onPress={() => markAllRead.mutate()}
              isLoading={markAllRead.isPending}
            >
              <CheckCheck aria-hidden="true" className="size-4" />
              Mark all read
            </Button>
          ) : undefined
        }
        secondaryActions={
          <Link
            href="/settings/notification-preferences"
            className="text-sm font-medium text-brand hover:underline"
          >
            Notification preferences
          </Link>
        }
      />
      {failure && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}
      <Tabs
        selectedKey={tab}
        onSelectionChange={(key) => setTab(key as TabKey)}
      >
        <TabList aria-label="Notification filter">
          {TABS.map((entry) => (
            <Tab key={entry.key} id={entry.key}>
              {entry.label}
            </Tab>
          ))}
        </TabList>
      </Tabs>
      <NotificationItems tab={tab} query={query} notifications={notifications} markRead={markRead} />
    </div>
  );
}

// Loading / error / empty / the list. onOpen runs when a notification's link is followed (the panel closes itself).
export function NotificationItems({ tab, query, notifications, markRead, onOpen, compact = false }: Pick<ReturnType<typeof useNotifications>, "tab" | "query" | "notifications" | "markRead"> & {
  onOpen?: () => void;
  compact?: boolean;
}) {
  return (
    <>
      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading notifications…</p>
      ) : query.isError ? (
        <ErrorState
          title="Could not load notifications"
          description="Something went wrong."
          action={{ label: "Retry", onPress: () => query.refetch() }}
        />
      ) : notifications.length === 0 && compact ? (
        <p className="py-8 text-center text-sm text-text-secondary">
          {tab === "unread" ? "No unread notifications." : "You're all caught up."}
        </p>
      ) : notifications.length === 0 ? (
        <EmptyState
          title={
            tab === "unread" ? "No unread notifications" : "No notifications"
          }
          description="Assignments, reminders and escalations for you appear here."
        />
      ) : (
        <ul
          className={compact ? "flex flex-col divide-y divide-border" : "flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface"}
          aria-label="Notifications"
        >
          {notifications.map((notification) => {
            const unread = !notification.read_at;
            const content = (
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium text-text">
                  {notification.title}
                </span>
                <span className="text-sm text-text-secondary">
                  {notification.message}
                </span>
                <span className="text-xs text-text-muted">
                  {formatter.format(new Date(notification.created_at))}
                </span>
              </div>
            );
            return (
              <li
                key={notification.id}
                className={[
                  compact ? "flex items-start gap-3 px-2 py-2.5" : "flex items-start gap-3 px-4 py-3",
                  unread ? "bg-brand-soft/40" : "",
                ].join(" ")}
              >
                <span
                  aria-hidden="true"
                  className={[
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    unread ? "bg-brand" : "",
                  ].join(" ")}
                />
                {notification.href ? (
                  <Link
                    href={notification.href}
                    className="flex min-w-0 flex-1"
                    onClick={() => {
                      if (unread) markRead.mutate(notification.id);
                      onOpen?.();
                    }}
                  >
                    {content}
                  </Link>
                ) : (
                  content
                )}
                {unread && (
                  <Button
                    variant="ghost"
                    size="compact"
                    onPress={() => markRead.mutate(notification.id)}
                    aria-label={`Mark "${notification.title}" read`}
                  >
                    Mark read
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
