"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { formatWorkspaceDateTime } from "@/lib/date-format";

export default function NotificationList({
  notifications,
}: {
  notifications: Array<{
    id: string;
    title: string;
    message: string;
    href: string | null;
    readAt: string | null;
    createdAt: string;
  }>;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function mark(id?: string) {
    setPending(true);
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: id ? "read" : "read-all", id }),
    });
    setPending(false);
    router.refresh();
  }
  return (
    <section className="panel">
      <div className="card-title-row">
        <div>
          <p className="eyebrow">Inbox</p>
          <h2>Workspace notifications</h2>
        </div>
        <button
          type="button"
          className="secondary-button"
          onClick={() => mark()}
          disabled={pending}
        >
          Mark all read
        </button>
      </div>
      <div className="notification-list">
        {notifications.map((item) => (
          <article
            key={item.id}
            className={item.readAt ? "notification read" : "notification"}
          >
            <div>
              <strong>{item.title}</strong>
              <p>{item.message}</p>
              <small>{formatWorkspaceDateTime(item.createdAt)}</small>
            </div>
            <div className="action-row">
              {item.href ? <a href={item.href}>Open</a> : null}
              {!item.readAt ? (
                <button
                  type="button"
                  className="link-button"
                  onClick={() => mark(item.id)}
                >
                  Mark read
                </button>
              ) : null}
            </div>
          </article>
        ))}
        {!notifications.length ? (
          <div className="empty-state">
            <strong>No notifications</strong>
            <p>Business alerts and assigned actions will appear here.</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}
