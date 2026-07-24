"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { requestJson } from "@/lib/client-request";

function safeWorkspaceHref(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

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
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");

  async function mark(id?: string) {
    if (pending) return;

    setPending(id || "all");
    setMessage("");
    const result = await requestJson("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: id ? "read" : "read-all", id }),
    });
    setPending("");
    setMessage(
      result.message ||
        (result.ok ? "Notifications updated." : "Request not completed."),
    );
    if (result.ok) router.refresh();
  }

  async function openNotification(
    id: string,
    href: string,
    alreadyRead: boolean,
  ) {
    if (pending) return;
    setPending(id);
    setMessage("");

    if (!alreadyRead) {
      const result = await requestJson("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "read", id }),
      });
      if (!result.ok) {
        setMessage(result.message || "The notification could not be marked read.");
      }
    }

    setPending("");
    router.push(href);
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
          onClick={() => void mark()}
          disabled={Boolean(pending) || !notifications.some((item) => !item.readAt)}
        >
          {pending === "all" ? "Updating…" : "Mark all read"}
        </button>
      </div>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      <div className="notification-list">
        {notifications.map((item) => {
          const href = safeWorkspaceHref(item.href);
          return (
            <article
              key={item.id}
              className={item.readAt ? "notification read" : "notification"}
            >
              <div>
                <strong>{item.title}</strong>
                <p>{item.message}</p>
                <small>{new Date(item.createdAt).toLocaleString()}</small>
              </div>
              <div className="action-row">
                {href ? (
                  <button
                    className="link-button"
                    disabled={Boolean(pending)}
                    onClick={() =>
                      void openNotification(item.id, href, Boolean(item.readAt))
                    }
                    type="button"
                  >
                    {pending === item.id ? "Opening…" : "Open"}
                  </button>
                ) : null}
                {!item.readAt ? (
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => void mark(item.id)}
                    disabled={Boolean(pending)}
                  >
                    Mark read
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
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
