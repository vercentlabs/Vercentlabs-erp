"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import AppIcon from "@/shared/components/app-icon";
import { requestJson } from "@/shared/http/client-request";
import { useOutsideDismiss } from "@/shared/use-outside-dismiss";

type NotificationPreview = {
  id: string;
  title: string;
  message: string;
  href: string | null;
  readAt: string | null;
  createdAt: string;
};

// Part 16/40 — a compact preview backed entirely by existing, already-
// authorized infrastructure: GET /api/notifications (added this prompt,
// same query shape and (organization_id,user_id) scope as the existing
// /notifications page) for the list, and the existing PATCH endpoint for
// mark-read. No new notification engine, no WebSockets/polling — the
// preview is fetched lazily on open. If a notification's href points to a
// record the user has since lost access to, this component does nothing
// special: the existing page/API guard at the destination is the one and
// only authority, exactly as for any other link (Part 40).
export default function NotificationsControl({ initialUnreadCount }: { initialUnreadCount: number }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(initialUnreadCount);
  const [notifications, setNotifications] = useState<NotificationPreview[] | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const containerRef = useRef<HTMLDivElement>(null);
  useOutsideDismiss(containerRef, open, () => setOpen(false));

  async function loadPreview() {
    setStatus("loading");
    try {
      const response = await fetch("/api/notifications", { headers: { Accept: "application/json" } });
      if (!response.ok) {
        setStatus("error");
        return;
      }
      const body: { notifications?: NotificationPreview[] } = await response.json();
      setNotifications(body.notifications ?? []);
      setStatus("idle");
    } catch {
      setStatus("error");
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && notifications === null) void loadPreview();
  }

  async function markAllRead() {
    const result = await requestJson("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "read-all" }),
    });
    if (result.ok) {
      setUnreadCount(0);
      setNotifications((current) => current?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? current);
    }
  }

  async function openNotification(notification: NotificationPreview) {
    if (!notification.readAt) {
      await requestJson("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: notification.id }),
      });
      setUnreadCount((count) => Math.max(0, count - 1));
    }
    setOpen(false);
    if (notification.href) router.push(notification.href);
  }

  return (
    <div className="topbar-menu" ref={containerRef}>
      <button
        type="button"
        className="topbar-icon-button"
        title="Notifications"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${unreadCount} unread notification${unreadCount === 1 ? "" : "s"}`}
        onClick={toggle}
      >
        <AppIcon name="notifications" size={19} />
        {unreadCount ? (
          <span className="topbar-count" aria-hidden="true">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="topbar-popover topbar-popover-wide" role="menu" aria-label="Notifications">
          <div className="topbar-popover-heading">
            <strong>Notifications</strong>
            {unreadCount ? (
              <button type="button" className="text-button" onClick={markAllRead}>
                Mark all read
              </button>
            ) : null}
          </div>
          {status === "loading" && !notifications ? (
            <p className="topbar-popover-empty">Loading…</p>
          ) : status === "error" ? (
            <p className="topbar-popover-empty">Notifications are temporarily unavailable.</p>
          ) : notifications && notifications.length > 0 ? (
            <ul className="topbar-notification-list">
              {notifications.map((notification) => (
                <li key={notification.id}>
                  <button
                    type="button"
                    className={`topbar-notification-item${notification.readAt ? "" : " unread"}`}
                    onClick={() => openNotification(notification)}
                  >
                    <strong>{notification.title}</strong>
                    <small>{notification.message}</small>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="topbar-popover-empty">You&rsquo;re all caught up.</p>
          )}
          <Link className="topbar-popover-footer" href="/notifications" onClick={() => setOpen(false)}>
            View all
          </Link>
        </div>
      ) : null}
    </div>
  );
}
