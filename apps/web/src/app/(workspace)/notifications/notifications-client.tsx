"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "@vercentlabs/design-system";

type Notification = {
  id: string;
  type: string;
  title: string;
  message: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
};

async function fetchNotifications(): Promise<Notification[]> {
  const response = await fetch("/api/notifications");
  const payload = (await response.json()) as {
    ok: boolean;
    notifications?: Notification[];
    message?: string;
  };
  if (!response.ok || !payload.ok)
    throw new Error(payload.message || "Could not load notifications.");
  return payload.notifications ?? [];
}

const dateFormatter = new Intl.DateTimeFormat("en-IN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export function NotificationsClient() {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["notifications"],
    queryFn: fetchNotifications,
  });

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await fetch(`/api/notifications/${id}/read`, { method: "PATCH" });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications", { method: "PATCH" });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["notifications"] }),
  });

  if (query.isLoading) {
    return (
      <p className="px-8 py-10 text-sm text-text-secondary">
        Loading notifications…
      </p>
    );
  }
  if (query.isError) {
    return (
      <p className="px-8 py-10 text-sm text-danger">
        Could not load notifications. Try again.
      </p>
    );
  }

  const notifications = query.data ?? [];
  const unreadCount = notifications.filter((n) => !n.read_at).length;

  return (
    <div className="flex flex-1 flex-col gap-6 px-8 py-10">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">Notifications</h1>
        {unreadCount > 0 ? (
          <Button
            variant="secondary"
            size="compact"
            onPress={() => markAllRead.mutate()}
            isLoading={markAllRead.isPending}
          >
            <CheckCheck aria-hidden="true" className="size-4" />
            Mark all read
          </Button>
        ) : null}
      </div>

      {notifications.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-16 text-center">
          <Bell aria-hidden="true" className="size-8 text-text-muted" />
          <p className="text-sm text-text-secondary">
            You have no notifications.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border rounded-[var(--radius-panel)] border border-border">
          {notifications.map((notification) => {
            const content = (
              <div className="flex flex-1 flex-col gap-0.5">
                <p className="text-sm font-medium text-text">
                  {notification.title}
                </p>
                <p className="text-sm text-text-secondary">
                  {notification.message}
                </p>
                <p className="text-xs text-text-muted">
                  {dateFormatter.format(new Date(notification.created_at))}
                </p>
              </div>
            );
            return (
              <li
                key={notification.id}
                className={[
                  "flex items-start gap-3 px-4 py-3",
                  notification.read_at ? "bg-surface" : "bg-brand-soft/40",
                ].join(" ")}
              >
                {!notification.read_at ? (
                  <span
                    aria-hidden="true"
                    className="mt-1.5 size-2 shrink-0 rounded-full bg-brand"
                  />
                ) : (
                  <span aria-hidden="true" className="mt-1.5 size-2 shrink-0" />
                )}
                {notification.href ? (
                  <Link
                    href={notification.href}
                    className="flex-1"
                    onClick={() =>
                      !notification.read_at && markRead.mutate(notification.id)
                    }
                  >
                    {content}
                  </Link>
                ) : (
                  content
                )}
                {!notification.read_at ? (
                  <Button
                    variant="ghost"
                    size="compact"
                    onPress={() => markRead.mutate(notification.id)}
                  >
                    Mark read
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
