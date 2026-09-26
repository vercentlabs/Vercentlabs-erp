"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { Button, EmptyState, ErrorState, PageHeader, Tab, TabList, Tabs } from "@vercentlabs/design-system";

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

const formatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

// Throw on a non-ok response so TanStack Query runs onError (a 403/404 must
// never look like a successful "mark read").
async function send(url: string, fallback: string) {
  const response = await fetch(url, { method: "PATCH" });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(payload.message || fallback);
  }
}

export function NotificationsScreen() {
  const workspace = useWorkspaceContext();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>("all");
  const baseKey = scopedQueryKey(workspace, "notifications");
  const query = useQuery({
    queryKey: [...baseKey, tab],
    queryFn: async () => {
      const response = await fetch(`/api/notifications?status=${tab}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.ok === false) throw new Error(payload.message || "Could not load notifications.");
      return payload as { notifications: Notification[]; unreadCount: number };
    },
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: baseKey });
  const markRead = useMutation({ mutationFn: (id: string) => send(`/api/notifications/${id}/read`, "Could not mark this notification as read."), onSuccess: refresh });
  const markAllRead = useMutation({ mutationFn: () => send("/api/notifications", "Could not mark all notifications as read."), onSuccess: refresh });

  const notifications = query.data?.notifications ?? [];
  const unreadCount = query.data?.unreadCount ?? 0;
  const failure = (markRead.error as Error | null)?.message || (markAllRead.error as Error | null)?.message;

  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader
        title="Notifications"
        description={!query.data ? undefined : unreadCount > 0 ? `${unreadCount} unread` : "You're all caught up."}
        primaryAction={
          unreadCount > 0 ? (
            <Button variant="secondary" onPress={() => markAllRead.mutate()} isLoading={markAllRead.isPending}>
              <CheckCheck aria-hidden="true" className="size-4" />
              Mark all read
            </Button>
          ) : undefined
        }
        secondaryActions={
          <Link href="/settings/notification-preferences" className="text-sm font-medium text-brand hover:underline">
            Notification preferences
          </Link>
        }
      />
      {failure && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}
      <Tabs selectedKey={tab} onSelectionChange={(key) => setTab(key as TabKey)}>
        <TabList aria-label="Notification filter">
          {TABS.map((entry) => (
            <Tab key={entry.key} id={entry.key}>
              {entry.label}
            </Tab>
          ))}
        </TabList>
      </Tabs>
      {query.isLoading ? (
        <p className="text-sm text-text-secondary">Loading notifications…</p>
      ) : query.isError ? (
        <ErrorState title="Could not load notifications" description="Something went wrong." action={{ label: "Retry", onPress: () => query.refetch() }} />
      ) : notifications.length === 0 ? (
        <EmptyState title={tab === "unread" ? "No unread notifications" : "No notifications"} description="Assignments, reminders and escalations for you appear here." />
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface" aria-label="Notifications">
          {notifications.map((notification) => {
            const unread = !notification.read_at;
            const content = (
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium text-text">{notification.title}</span>
                <span className="text-sm text-text-secondary">{notification.message}</span>
                <span className="text-xs text-text-muted">{formatter.format(new Date(notification.created_at))}</span>
              </div>
            );
            return (
              <li key={notification.id} className={["flex items-start gap-3 px-4 py-3", unread ? "bg-brand-soft/40" : ""].join(" ")}>
                <span aria-hidden="true" className={["mt-1.5 size-2 shrink-0 rounded-full", unread ? "bg-brand" : ""].join(" ")} />
                {notification.href ? (
                  <Link href={notification.href} className="flex min-w-0 flex-1" onClick={() => unread && markRead.mutate(notification.id)}>
                    {content}
                  </Link>
                ) : (
                  content
                )}
                {unread && (
                  <Button variant="ghost" size="compact" onPress={() => markRead.mutate(notification.id)} aria-label={`Mark "${notification.title}" read`}>
                    Mark read
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
